import * as ort from 'onnxruntime-web';
import { sleep } from "./helpers.js";

/**
 * Wrapper for ONNX Runtime Web API.
 */
export class ONNX {
    /**
     * Wait for the ONNX Runtime Web API to be initialized.
     * With npm import, this is immediate.
     */
    static async waitForInitialization() {
        return Promise.resolve();
    }

    /**
     * Create a new tensor.
     * @param {string} dtype The data type of the tensor.
     * @param {Array<number>} data The data of the tensor.
     * @param {Array<number>} dims The dimensions of the tensor.
     * @returns {Promise<import('onnxruntime-web').Tensor>} A promise that resolves to a new tensor.
     */
    static async createTensor(dtype, data, dims) {
        return new ort.Tensor(dtype, data, dims);
    }

    /**
     * Create a new inference session.
     * @param {ArrayBuffer|string} model The model to load.
     * @param {Object} [options] The options for the inference session.
     * @returns {Promise<import('onnxruntime-web').InferenceSession>} A promise that resolves to a new inference session.
     */
    static async createInferenceSession(model, options = {}) {
        return await ort.InferenceSession.create(model, options);
    }
}
