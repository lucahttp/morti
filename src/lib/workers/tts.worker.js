
import { pipeline, env } from '@huggingface/transformers';

// Disable multi-threading and SIMD for stability
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.simd = false;

console.log("TTS Worker Config:", {
    numThreads: env.backends.onnx.wasm.numThreads,
    simd: env.backends.onnx.wasm.simd
});

env.allowLocalModels = false;
env.useBrowserCache = true;

class TTSWorker {
    static instance = null;
    static loadingPromise = null;

    static async getInstance(progress_callback = null) {
        if (this.instance) return this.instance;
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = (async () => {
            // Using WASM for stability (or switch to WebGPU if 'webgpu' requested in previous turns)
            // Keeping 'wasm' for TTS as it's often more stable for this specific model on some devices, 
            // but user asked for "everything" progress, implying everything should be standardized. 
            // Let's stick to current config (wasm for TTS?) No, user asked "are you using webgpu?". 
            // I should probably try WebGPU for everything if possible. 
            // But 'speecht5_tts' might not fully support webgpu yet or might be buggy. Stick to what was working.
            // Wait, previous config was "wasm". I will keep it as is unless requested to change.
            const pipe = await pipeline('text-to-speech', 'Xenova/speecht5_tts', {
                dtype: 'q8',
                device: 'wasm',
                progress_callback,
            });
            this.instance = pipe;
            return pipe;
        })();

        return this.loadingPromise;
    }
}

self.addEventListener('message', async (event) => {
    const { text, action } = event.data;

    if (action === 'init') {
        try {
            await TTSWorker.getInstance((data) => {
                self.postMessage({ status: 'progress', data });
            });
            self.postMessage({ status: 'ready' });
        } catch (error) {
            self.postMessage({ status: 'error', error: error.message });
        }
    }

    if (action === 'speak') {
        try {
            const synthesizer = await TTSWorker.getInstance((data) => {
                self.postMessage({ status: 'progress', data });
            });

            const audio = await synthesizer(text);

            // audio consists of { audio: Float32Array, sampling_rate: number }
            self.postMessage({ status: 'complete', audio: audio.audio, sampling_rate: audio.sampling_rate });
        } catch (error) {
            self.postMessage({ status: 'error', error: error.message });
        }
    }
});
