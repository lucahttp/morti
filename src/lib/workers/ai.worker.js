import { env, AutoTokenizer, AutoProcessor, WhisperForConditionalGeneration, TextStreamer, WhisperTextStreamer, AutoModelForCausalLM, InterruptableStoppingCriteria, pipeline } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';

import {
    loadCfgs,
    loadOnnxAll,
    loadProcessors,
    loadStyleEmbeddings,
    generateSupertonicSpeech
} from './tts.utils.js';

// --- Configuration & Optimization ---
// Force gc if available (usually requires flags, but good intent)
if (globalThis.gc) {
    try { globalThis.gc(); } catch (e) { /* ignore */ }
}

// 1. WASM & Threading Optimization
// Point to the root where vite-plugin-static-copy puts the files
env.backends.onnx.wasm.wasmPaths = '/';
env.backends.onnx.wasm.proxy = false; // Disable proxy to keep logic simple in worker
env.backends.onnx.wasm.simd = true;   // Enable SIMD (critical for speed)
env.backends.onnx.wasm.numThreads = 1; // Strict limit to prevent OOM
// Note: 'Unknown CPU vendor' is often benign log noise from emscripten/cpuinfo.

// 2. Memory & Cache
env.allowLocalModels = false;
env.useBrowserCache = true;
// env.backends.onnx.logLevel = 'warning'; // Reduce noise

// --- Helper: Aggressive Memory Recovery ---
async function flushMemory() {
    try {
        if (globalThis.gc) globalThis.gc();
    } catch (e) { }
}

// --- Constants ---
// Use Turbo model as per whisper-web example for best performance/accuracy balance
const WHISPER_MODEL_ID = 'onnx-community/whisper-large-v3-turbo';
const CHAT_MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
const CHAT_TOKENIZER_ID = "onnx-community/Qwen3-0.6B-ONNX";
// Use absolute URL to avoid fetch issues in workers.
// IMPORTANT: Pointing to the official Supertone/supertonic-2 repo on Hugging Face
const TTS_CDN_URL = "https://huggingface.co/Supertone/supertonic-2/resolve/main";

const BASE_URL = self.location.origin;
// If CDN is present, models are in /onnx/
const TTS_BASE_PATH = TTS_CDN_URL ? `${TTS_CDN_URL}/onnx` : `${BASE_URL}/assets/onnx`;
// Voice styles are in /voice_styles/
const TTS_STYLE_BASE = TTS_CDN_URL ? `${TTS_CDN_URL}/voice_styles` : `${BASE_URL}/assets/voice_styles`;

// --- Advanced Recognition Settings ---
const WHISPER_GEN_CONFIG = {
    top_k: 0,
    do_sample: false,
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    force_full_sequences: false,
};

// --- Senior Pre-flight Check ---
function checkSystemRequirements() {
    // Force HF Hub (disable local model checks to avoid 404s if files missing)
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
        console.warn("[System] Low memory detected (<4GB). Models may crash.");
    }
    if (!navigator.gpu) {
        console.warn("[System] WebGPU not supported. Falling back to WASM (slow).");
    }
}
checkSystemRequirements();

// --- Singleton Model Manager (Per Worker) ---
class ModelManager {
    constructor() {
        this.currentPipeline = null;
        this.currentType = null;
    }

    async switchPipeline(type, setupFn) {
        // Pre-flight check before heavy allocation
        checkSystemRequirements();

        if (this.currentType === type && this.currentPipeline) {
            return this.currentPipeline;
        }

        // Robust Cleanup
        if (this.currentPipeline) {
            console.log(`[Worker] Releasing previous ${this.currentType} pipeline...`);
            try {
                if (this.currentPipeline.dispose) {
                    await this.currentPipeline.dispose();
                } else if (this.currentPipeline.model && this.currentPipeline.model.dispose) {
                    await this.currentPipeline.model.dispose();
                }
            } catch (e) {
                console.warn("Cleanup warning:", e);
            }
            this.currentPipeline = null;
            this.currentType = null;

            // Trigger GC hint
            if (globalThis.gc) globalThis.gc();
        }

        // Initialize
        console.log(`[Worker] Initializing ${type}...`);
        self.postMessage({ status: 'debug', message: `Initializing ${type}...` });

        try {
            this.currentPipeline = await setupFn();
            this.currentType = type;
            return this.currentPipeline;
        } catch (err) {
            // Map common errors to friendly messages
            if (err.name === 'RangeError' || err.message.includes('allocation')) {
                throw new Error("Out of Memory: Failed to allocate model buffers. Try closing other tabs.");
            }
            throw err;
        }
    }
}

const manager = new ModelManager();
const stopping_criteria = new InterruptableStoppingCriteria();
// Cache for previous conversation turns (optional, simpler to omit for clean state each time for now, or add later)
let past_key_values_cache = null;

// --- Pipelines with Explicit Disposal ---

// Refactored WhisperPipeline using high-level pipeline() for robustness

// Refactored WhisperPipeline using high-level pipeline() for robustness
class WhisperPipeline {
    static async create(modelId = WHISPER_MODEL_ID, progress_callback) {
        // Use 'automatic-speech-recognition' pipeline
        // This handles pre-processing, chunking, striding, and decoding automatically.
        const transcriber = await pipeline('automatic-speech-recognition', modelId, {
            dtype: {
                encoder_model: modelId.includes('turbo') ? 'fp16' : 'fp32',
                decoder_model_merged: 'q4', // or 'fp32' ('fp16' is often buggy on decoders)
            },
            device: 'webgpu',
            progress_callback,
        });

        return {
            transcriber,
            dispose: async () => {
                // Pipelines dispose via .dispose() if available in newer versions, 
                // or we rely on them checking `model.dispose`
                if (transcriber.dispose) await transcriber.dispose();
                else if (transcriber.model && transcriber.model.dispose) await transcriber.model.dispose();
            }
        };
    }
}


class ChatPipeline {
    static async create(modelId = CHAT_MODEL_ID, progress_callback) {
        const tokenizer = await AutoTokenizer.from_pretrained(CHAT_TOKENIZER_ID, { progress_callback });
        const model = await AutoModelForCausalLM.from_pretrained(modelId, {
            dtype: 'q4f16',
            device: 'webgpu',
            progress_callback,
        });
        return {
            tokenizer, model,
            dispose: async () => { await model.dispose(); }
        };
    }
}

class TtsPipeline {
    static async create(progress_callback, basePath = TTS_BASE_PATH) {
        console.log("[TTS] Loading configs...");
        const cfgs = await loadCfgs(basePath);

        console.log("[TTS] Loading ONNX models...");
        const models = await loadOnnxAll(basePath, {
            executionProviders: ['webgpu'],
            graphOptimizationLevel: 'all',
            executionMode: 'sequential',
            logSeverityLevel: 3,
        }, (name, curr, total) => {
            if (progress_callback) progress_callback({ status: 'progress', file: name, progress: (curr / total) * 100 });
        });

        console.log("[TTS] Loading processors...");
        const processors = await loadProcessors(basePath);

        console.log("[TTS] Pipeline ready.");
        return {
            models, cfgs, processors,
            dispose: async () => {
                for (const key of Object.keys(models)) {
                    const session = models[key];
                    if (session && typeof session.release === 'function') {
                        try { await session.release(); } catch (e) { }
                    }
                }
            }
        };
    }
}

// --- Main Message Listener ---

self.addEventListener('message', async (e) => {
    const { action, type, data } = e.data;
    const cmd = action || type;

    try {
        switch (cmd) {
            case 'transcribe': await handleTranscribe(data || e.data); break;
            case 'chat': await handleChat(data || e.data); break;
            case 'speak': await handleSpeak(data || e.data); break;
            case 'preload': await handlePreload(); break;
            case 'interrupt': stopping_criteria.interrupt(); break;
            case 'reset':
                stopping_criteria.reset();
                past_key_values_cache = null;
                break;
            default: console.warn('Unknown command:', cmd);
        }
    } catch (err) {
        self.postMessage({ status: 'error', error: err.message || err });
        console.error(err);
    }
});

// --- Handlers ---

async function handlePreload() {
    try {
        self.postMessage({ status: 'progress', file: 'stt_check', progress: 0 });
        const stt = await WhisperPipeline.create(WHISPER_MODEL_ID, (p) => self.postMessage({ status: 'progress', ...p }));
        await stt.dispose();
    } catch (e) { console.error("STT Preload failed", e); }

    try {
        self.postMessage({ status: 'progress', file: 'chat_check', progress: 0 });
        const chat = await ChatPipeline.create(CHAT_MODEL_ID, (p) => self.postMessage({ status: 'progress', ...p }));
        await chat.dispose();
    } catch (e) { console.error("Chat Preload failed", e); }

    try {
        self.postMessage({ status: 'progress', file: 'tts_check', progress: 0 });
        const tts = await TtsPipeline.create((p) => self.postMessage({ status: 'progress', ...p }), TTS_BASE_PATH);
        await tts.dispose();
    } catch (e) { console.error("TTS Preload failed", e); }

    self.postMessage({ status: 'complete', message: 'All models preloaded' });
}

async function handleTranscribe({ audio, language, model_id }) {
    console.log('[Worker] handleTranscribe called. Audio length:', audio?.length);

    // Diagnostic: Check audio levels
    let maxAmp = 0;
    for (let i = 0; i < audio.length; i++) {
        const abs = Math.abs(audio[i]);
        if (abs > maxAmp) maxAmp = abs;
    }
    console.log(`[Worker] Audio Diagnostics: Max Amplitude = ${maxAmp.toFixed(4)}`);
    self.postMessage({ status: 'debug', message: `Worker starting transcription. Signal: ${maxAmp.toFixed(2)}` });

    try {
        // Switch to STT pipeline
        const { transcriber } = await manager.switchPipeline('stt', () =>
            WhisperPipeline.create(model_id, (p) => self.postMessage({ status: 'progress', ...p }))
        );

        console.log('[Worker] Pipeline ready. Running generation...');

        // Calculate time precision (matching whisper-web-temp)
        const time_precision =
            transcriber.processor.feature_extractor.config.chunk_length /
            transcriber.model.config.max_source_positions;

        const chunks = [];
        let chunk_count = 0;
        let start_time;
        let num_tokens = 0;
        let tps;

        const streamer = new WhisperTextStreamer(transcriber.tokenizer, {
            time_precision,
            on_chunk_start: (x) => {
                const offset = (WHISPER_GEN_CONFIG.chunk_length_s - WHISPER_GEN_CONFIG.stride_length_s) * chunk_count;
                chunks.push({
                    text: "",
                    timestamp: [offset + x, null],
                    finalised: false,
                    offset,
                });
            },
            token_callback_function: (x) => {
                start_time ??= performance.now();
                if (num_tokens++ > 0) {
                    tps = (num_tokens / (performance.now() - start_time)) * 1000;
                }
            },
            callback_function: (x) => {
                if (chunks.length === 0) return;
                chunks.at(-1).text += x;

                self.postMessage({
                    status: "update",
                    data: {
                        text: chunks.map(c => c.text).join(""),
                        chunks,
                        tps,
                    },
                });
            },
            on_chunk_end: (x) => {
                const current = chunks.at(-1);
                current.timestamp[1] = x + current.offset;
                current.finalised = true;
            },
            on_finalize: () => {
                start_time = null;
                num_tokens = 0;
                ++chunk_count;
            },
        });

        // Actually run transcription
        const output = await transcriber(audio, {
            ...WHISPER_GEN_CONFIG,
            language: language || 'english',
            task: 'transcribe',
            streamer,
        });

        const outputText = output.text.trim();

        // Hallucination filter
        const isHallucination = /^\s*\(.*\)\s*$/.test(outputText) || outputText.length < 2;

        if (isHallucination) {
            console.warn("[Worker] Ignored hallucination/noise:", outputText);
            self.postMessage({ status: 'error', error: 'No meaningful speech detected.' });
            return;
        }

        self.postMessage({ status: 'complete', text: outputText, chunks: chunks });

        // CLEANUP: Immediately nullify large audio buffer to free memory
        audio = null;
        await flushMemory();
    } catch (e) {
        console.error("[Worker] Transcribe Error:", e);
        self.postMessage({ status: 'error', error: e.message || e });
    }
}

async function handleChat({ messages, model_id }) {
    const pipeline = await manager.switchPipeline('chat', () =>
        ChatPipeline.create(model_id, (p) => self.postMessage({ status: 'progress', ...p }))
    );
    const { model, tokenizer } = pipeline;

    stopping_criteria.reset();

    // Standardize Format: Ensure messages is an array of objects
    let conversation = messages;
    if (typeof messages === 'string') {
        conversation = [
            { role: 'system', content: 'You are a helpful AI assistant.' },
            { role: 'user', content: messages }
        ];
    } else if (Array.isArray(messages)) {
        // Ensure system prompt if missing
        const hasSystem = messages.some(m => m.role === 'system');
        if (!hasSystem) {
            conversation = [
                { role: 'system', content: 'You are a helpful AI assistant.' },
                ...messages
            ];
        }
    }

    // Use apply_chat_template (transformers.js v3+)
    // Qwen uses ChatML-like format: <|im_start|>system...<|im_end|>
    const prompt = tokenizer.apply_chat_template(conversation, {
        tokenize: false,
        add_generation_prompt: true,
    });

    // Tokenize
    let inputs = tokenizer(prompt);

    // Streamer
    const streamer = new TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (output) => {
            self.postMessage({ status: 'update', output });
        }
    });

    // Valid generation config for Qwen
    /*
       reasonEnabled logic from example omitted for simplicity,
       defaulting to standard chat parameters.
    */
    const { past_key_values, sequences } = await model.generate({
        ...inputs,
        // past_key_values: past_key_values_cache, // Enable if implementing multi-turn caching

        max_new_tokens: 512,
        streamer,
        stopping_criteria,

        do_sample: true,
        top_k: 20,
        temperature: 0.7, // 0.6 if 'reasoning', 0.7 standard

        return_dict_in_generate: true,
    });

    // past_key_values_cache = past_key_values; // Update cache if used

    // CLEANUP: Free tokenized inputs and sequences
    inputs = null;
    await flushMemory();

    self.postMessage({ status: 'complete' });
}


async function handleSpeak({ text, voice }) {
    // Sanitize text: Remove <think>...</think> tags and their content for TTS
    let sanitizedText = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    if (!sanitizedText) {
        self.postMessage({ status: 'complete', message: 'No speakable text after filtering.' });
        return;
    }

    const pipeline = await manager.switchPipeline('tts', () =>
        TtsPipeline.create((p) => self.postMessage({ status: 'progress', ...p }), TTS_BASE_PATH)
    );

    // Assuming refactored utils:
    let result = await generateSupertonicSpeech(
        sanitizedText,
        pipeline.models,
        pipeline.cfgs,
        pipeline.processors,
        voice || 'M3', // default voice
        (audioChunk, sampleRate) => {
            self.postMessage({ status: 'audio_chunk', audio: audioChunk, sampleRate });
        },
        TTS_STYLE_BASE
    );

    // CLEANUP: Immediately nullify large data to free memory
    text = null;
    sanitizedText = null;
    result = null;
    await flushMemory();

    self.postMessage({ status: 'complete' });
}