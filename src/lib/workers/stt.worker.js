// Dynamic Import Pattern
let AutoTokenizer, AutoProcessor, WhisperForConditionalGeneration, TextStreamer, full, env;

// Global promise to track initialization
let initPromise = (async () => {
    try {
        console.log('[Worker] Starting dynamic import of transformers...');
        self.postMessage({ status: 'debug', message: 'Importing transformers...' });

        const m = await import('@huggingface/transformers');
        AutoTokenizer = m.AutoTokenizer;
        AutoProcessor = m.AutoProcessor;
        WhisperForConditionalGeneration = m.WhisperForConditionalGeneration;
        TextStreamer = m.TextStreamer;
        full = m.full;
        env = m.env;

        env.allowLocalModels = false;
        env.useBrowserCache = true;

        console.log('[Worker] Transformers imported successfully.');
        self.postMessage({ status: 'debug', message: 'Transformers imported.' });
    } catch (e) {
        console.error('[Worker] Import failed:', e);
        self.postMessage({ status: 'error', error: 'Failed to load libraries: ' + e.message });
        throw e;
    }
})();

const MAX_NEW_TOKENS = 64;

// Module-level singleton state
let pipeline_model_id = null;
let pipeline_tokenizer = null;
let pipeline_processor = null;
let pipeline_model = null;

class AutomaticSpeechRecognitionPipeline {
    static async getInstance(progress_callback = null) {
        await initPromise;
        // Use the turbo model as it is better quality/speed ratio than base, 
        // but use the architecture from the example.
        pipeline_model_id = 'onnx-community/whisper-large-v3-turbo';

        console.log('getInstance called. model_id: ' + pipeline_model_id);
        self.postMessage({ status: 'debug', message: `getInstance called. model_id: ${pipeline_model_id}` });

        // Initialize promises in parallel if not already initialized
        if (!pipeline_tokenizer) {
            self.postMessage({ status: 'debug', message: 'Initializing Tokenizer...' });
            pipeline_tokenizer = AutoTokenizer.from_pretrained(pipeline_model_id, {
                progress_callback,
            });
        }

        if (!pipeline_processor) {
            self.postMessage({ status: 'debug', message: 'Initializing Processor...' });
            pipeline_processor = AutoProcessor.from_pretrained(pipeline_model_id, {
                progress_callback,
            });
        }

        if (!pipeline_model) {
            let device = 'wasm';
            try {
                if (navigator.gpu) {
                    const adapter = await navigator.gpu.requestAdapter();
                    if (adapter) {
                        device = 'webgpu';
                    }
                }
            } catch (e) {
                console.warn("WebGPU not available, falling back to WASM.");
            }

            self.postMessage({ status: 'debug', message: `Loading Model (fp32/q4) on device: ${device}...` });

            pipeline_model = WhisperForConditionalGeneration.from_pretrained(pipeline_model_id, {
                dtype: {
                    encoder_model: 'fp32',
                    decoder_model_merged: 'q4',
                },
                device,
                progress_callback,
            });
        }

        // Wait for all promises to resolve
        self.postMessage({ status: 'debug', message: 'Waiting for model promises to resolve...' });
        const results = await Promise.all([pipeline_tokenizer, pipeline_processor, pipeline_model]);
        self.postMessage({ status: 'debug', message: 'All model promises resolved.' });
        return results;
    }
}

let processing = false;

async function generate({ audio, language }) {
    if (processing) {
        self.postMessage({ status: 'debug', message: 'Generate called but already processing. Ignoring.' });
        return;
    }
    processing = true;

    self.postMessage({ status: 'debug', message: `Generate started. Language: ${language || 'auto'}. Audio length: ${audio?.length}, Type: ${Object.prototype.toString.call(audio)}` });

    // Tell the main thread we are starting
    self.postMessage({ status: 'start' });

    try {
        self.postMessage({ status: 'debug', message: `Acquiring pipeline instance...` });
        // Retrieve the text-generation pipeline.
        const [tokenizer, processor, model] = await AutomaticSpeechRecognitionPipeline.getInstance();
        self.postMessage({ status: 'debug', message: `Pipeline instance acquired.` });

        self.postMessage({ status: 'debug', message: `Processing audio input details (size: ${audio.length})...` });

        let startTime;
        let numTokens = 0;
        const callback_function = (output) => {
            startTime ??= performance.now();

            self.postMessage({ status: 'debug', message: `Streamer callback: ${JSON.stringify(output)}` });

            let tps;
            if (numTokens++ > 0) {
                tps = numTokens / (performance.now() - startTime) * 1000;
            }
            // Stream partial results
            self.postMessage({
                status: 'update',
                output, tps, numTokens,
            });
        };

        const streamer = new TextStreamer(tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function,
        });

        self.postMessage({ status: 'debug', message: 'Running processor...' });
        const inputs = await processor(audio);
        self.postMessage({ status: 'debug', message: 'Processor finished. Inputs prepared.' });

        self.postMessage({ status: 'debug', message: 'Starting generation...' });
        const outputs = await model.generate({
            ...inputs,
            max_new_tokens: MAX_NEW_TOKENS,
            language: language || 'english',
            streamer,
        });
        self.postMessage({ status: 'debug', message: 'Generation finished.' });

        self.postMessage({ status: 'debug', message: 'Decoding final output...' });
        const outputText = tokenizer.batch_decode(outputs, { skip_special_tokens: true });
        self.postMessage({ status: 'debug', message: `Decoding finished. Result: ${outputText[0]}` });

        // Send the output back to the main thread
        self.postMessage({
            status: 'complete',
            text: outputText[0], // Note: example returned outputText (array) probably, let's check
        });
        self.postMessage({ status: 'debug', message: 'Generate complete. Message sent.' });

    } catch (e) {
        self.postMessage({ status: 'error', error: e.message, stack: e.stack });
    } finally {
        processing = false;
    }
}

async function load() {
    self.postMessage({ status: 'debug', message: 'Load function called.' });
    self.postMessage({
        status: 'loading',
        data: { file: 'warmup', progress: 0, status: 'init' } // Fake progress data structure to satisfy UI? 
        // Actually UI expects { file:..., progress:..., status:... } from 'progress' events.
        // The example sends raw 'x' to progress callback.
    });

    try {
        // Load the pipeline and save it for future use.
        const [tokenizer, processor, model] = await AutomaticSpeechRecognitionPipeline.getInstance(x => {
            // We also add a progress callback to the pipeline so that we can
            // track model loading.
            self.postMessage({ status: 'progress', data: x });
        });

        self.postMessage({
            status: 'loading',
            data: { file: 'shaders', progress: 0, status: 'compiling' }
        });

        // Run model with dummy input to compile shaders
        await model.generate({
            input_features: full([1, 80, 3000], 0.0),
            max_new_tokens: 1,
        });

        self.postMessage({ status: 'debug', message: 'Shader compilation/Warmup complete.' });

        self.postMessage({ status: 'ready' });
    } catch (e) {
        self.postMessage({ status: 'error', error: e.message });
    }
}

// Listen for messages from the main thread
self.addEventListener('message', async (e) => {
    const { action, audio, language } = e.data;

    // Support both 'action' (old) and 'type' (example) styles just in case, but code uses action
    const cmd = action || e.data.type;

    self.postMessage({ status: 'debug', message: `Worker received message: ${cmd}` });

    switch (cmd) {
        case 'init':
        case 'load':
            load();
            break;

        case 'transcribe':
        case 'generate':
            generate({ audio, language });
            break;
    }
});
