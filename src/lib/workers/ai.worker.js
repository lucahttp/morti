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
env.backends.onnx.wasm.numThreads = 1; // Unchecked CPU vendor fix: limit threads to 1 or 4. '1' often simpler for stability.
// Note: 'Unknown CPU vendor' is often benign log noise from emscripten/cpuinfo.

// 2. Memory & Cache
env.allowLocalModels = false;
env.useBrowserCache = true;
// env.backends.onnx.logLevel = 'warning'; // Reduce noise

// --- Constants ---
// Use Turbo model as per whisper-web example for best performance/accuracy balance
const WHISPER_MODEL_ID = 'onnx-community/whisper-large-v3-turbo';
const CHAT_MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
const CHAT_TOKENIZER_ID = "onnx-community/Qwen3-0.6B-ONNX";
// Use absolute URL to avoid fetch issues in workers
const BASE_URL = self.location.origin;
const TTS_BASE_PATH = `${BASE_URL}/assets/onnx`;

// --- Senior Pre-flight Check ---
function checkSystemRequirements() {
    // Check RAM (if available API)
    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
        console.warn("[System] Low memory detected (<4GB). Models may crash.");
    }
    // Check WebGPU
    if (!navigator.gpu) {
        console.warn("[System] WebGPU not supported. Falling back to WASM (slow).");
    }
}

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
    static async create(progress_callback) {
        console.log("[TTS] Loading configs...");
        const cfgs = await loadCfgs(TTS_BASE_PATH);

        console.log("[TTS] Loading ONNX models...");
        const models = await loadOnnxAll(TTS_BASE_PATH, {
            executionProviders: ['webgpu'],
            graphOptimizationLevel: 'all',
            executionMode: 'sequential',
            logSeverityLevel: 3,
        }, (name, curr, total) => {
            if (progress_callback) progress_callback({ status: 'progress', file: name, progress: (curr / total) * 100 });
        });

        console.log("[TTS] Loading processors...");
        const processors = await loadProcessors(TTS_BASE_PATH);

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
        const tts = await TtsPipeline.create((p) => self.postMessage({ status: 'progress', ...p }));
        await tts.dispose();
    } catch (e) { console.error("TTS Preload failed", e); }

    self.postMessage({ status: 'complete', message: 'All models preloaded' });
}

async function handleTranscribe({ audio, language, model_id }) {
    console.log('[Worker] handleTranscribe called. Audio length:', audio?.length);
    self.postMessage({ status: 'debug', message: `Worker starting transcription. Audio: ${audio?.length} samples` });

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
        const chunk_length_s = 30;
        const stride_length_s = 5;
        let chunk_count = 0;
        let start_time;
        let num_tokens = 0;
        let tps;

        const streamer = new WhisperTextStreamer(transcriber.tokenizer, {
            time_precision,
            on_chunk_start: (x) => {
                const offset = (chunk_length_s - stride_length_s) * chunk_count;
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
            top_k: 0,
            do_sample: false,
            chunk_length_s,
            stride_length_s,
            language: language || 'english',
            task: 'transcribe',
            return_timestamps: true,
            force_full_sequences: false,
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
    const inputs = tokenizer(prompt);

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

    self.postMessage({ status: 'complete' });
}


async function handleSpeak({ text, voice }) {
    // Sanitize text: Remove <think>...</think> tags and their content for TTS
    const sanitizedText = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    if (!sanitizedText) {
        self.postMessage({ status: 'complete', message: 'No speakable text after filtering.' });
        return;
    }

    const pipeline = await manager.switchPipeline('tts', () =>
        TtsPipeline.create((p) => self.postMessage({ status: 'progress', ...p }))
    );

    // We need to pass the pipeline components to the generator function
    // But verify `generateSupertonicSpeech` signature.
    // It relied on global `models`, `cfgs` in the original script.
    // We need to refactor tts.utils.js to accept these as args.

    // Assuming refactored utils:
    const result = await generateSupertonicSpeech(
        sanitizedText,
        pipeline.models,
        pipeline.cfgs,
        pipeline.processors,
        voice || 'M3', // default voice
        (audioChunk, sampleRate) => {
            self.postMessage({ status: 'audio_chunk', audio: audioChunk, sampleRate });
        }
    );

    self.postMessage({ status: 'complete' });
}