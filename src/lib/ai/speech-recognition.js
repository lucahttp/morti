import {
    AutoTokenizer,
    AutoProcessor,
    WhisperForConditionalGeneration,
    TextStreamer,
    full,
    env
} from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = false; // Disable cache to rule out quota/corruption issues during debug

const MAX_NEW_TOKENS = 64;

// Module-level singleton state
// Switched to base model to prevent OOM on main thread
let pipeline_model_id = 'Xenova/whisper-base.en';
let pipeline_tokenizer = null;
let pipeline_processor = null;
let pipeline_model = null;

export class AutomaticSpeechRecognitionService {
    static async getInstance(progress_callback = null) {
        try {
            if (!pipeline_tokenizer) {
                console.log('[STT Service] Initializing Tokenizer...');
                pipeline_tokenizer = AutoTokenizer.from_pretrained(pipeline_model_id, {
                    progress_callback,
                });
            }

            if (!pipeline_processor) {
                console.log('[STT Service] Initializing Processor...');
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
                    console.warn("[STT Service] WebGPU not available, falling back to WASM.", e);
                }

                console.log(`[STT Service] Loading Model on device: ${device}...`);
                try {
                    pipeline_model = WhisperForConditionalGeneration.from_pretrained(pipeline_model_id, {
                        dtype: {
                            encoder_model: 'fp32',
                            decoder_model_merged: 'q4',
                        },
                        device,
                        progress_callback,
                    });
                } catch (loadError) {
                    if (loadError instanceof RangeError) {
                        console.error("[STT Service] OOM Error: Model too large for main thread?");
                    }
                    throw loadError;
                }
            }

            await Promise.all([pipeline_tokenizer, pipeline_processor, pipeline_model]);
            console.log('[STT Service] All Text-Generation models ready.');

            return {
                tokenizer: await pipeline_tokenizer,
                processor: await pipeline_processor,
                model: await pipeline_model
            };
        } catch (e) {
            console.error("[STT Service] Fatal Error during initialization:", e);
            throw e;
        }
    }



    static async transcribe(audio, language, progressCallback = null) {
        console.log(`[STT Service] Transcribe called. Audio Length: ${audio?.length}`);

        const { tokenizer, processor, model } = await this.getInstance(progressCallback);

        const inputs = await processor(audio);

        let startTime;
        let numTokens = 0;

        const streamer = new TextStreamer(tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (output) => {
                startTime ??= performance.now();
                // We can implement callback logic here if we want to stream text back to UI
                // For now, simpler to just wait? Or pass a callback argument?
                // Let's rely on the final output for simplicity first, or log it.
                // console.log("Streamer output:", output); 
            },
        });

        console.log('[STT Service] Starting generation...');
        const outputs = await model.generate({
            ...inputs,
            max_new_tokens: MAX_NEW_TOKENS,
            language: language || 'english',
            streamer,
        });

        const outputText = tokenizer.batch_decode(outputs, { skip_special_tokens: true });
        console.log(`[STT Service] Final Result: ${outputText[0]}`);

        return outputText[0];
    }
}
