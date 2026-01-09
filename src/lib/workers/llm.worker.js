
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

class LLMWorker {
    static instance = null;
    static loadingPromise = null;

    static async getInstance(progress_callback = null) {
        if (this.instance) return this.instance;
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = (async () => {
            const pipe = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
                dtype: 'q4f16',
                device: 'webgpu',
                progress_callback,
            });
            this.instance = pipe;
            return pipe;
        })();

        return this.loadingPromise;
    }
}

self.addEventListener('message', async (event) => {
    const { text, messages, action } = event.data;

    if (action === 'init') {
        try {
            await LLMWorker.getInstance((data) => {
                self.postMessage({ status: 'progress', data });
            });
            self.postMessage({ status: 'ready' });
        } catch (error) {
            self.postMessage({ status: 'error', error: error.message });
        }
    }

    if (action === 'generate') {
        try {
            const generator = await LLMWorker.getInstance((data) => {
                self.postMessage({ status: 'progress', data });
            });

            // Construct prompt using chat template if messages provided, else raw text
            const inputs = messages || [{ role: 'user', content: text }];

            const output = await generator(inputs, {
                max_new_tokens: 128,
                do_sample: true,
                temperature: 0.7,
                top_k: 50,
                top_p: 0.9,
                return_full_text: false,
            });

            // Output is usually array of choices
            const generatedText = output[0].generated_text.at(-1).content; // Get last assistant message

            self.postMessage({ status: 'complete', text: generatedText });
        } catch (error) {
            self.postMessage({ status: 'error', error: error.message });
        }
    }
});
