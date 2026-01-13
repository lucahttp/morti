# Implementation Plan - Unified AI Pipeline (STT, LLM, TTS)

We will implement a unified `ai.worker.js` that manages three distinct AI capabilities: Speech-to-Text (Whisper), Large Language Model (Chat), and Text-to-Speech (Supertonic-2). The core requirement is to run **only one model at a time** to conserve WebGPU resources, while keeping assets cached for fast switching.

## User Review Required
 > [!IMPORTANT]
 > **Singleton Execution**: Switching modes (e.g., from Chat to TTS) will incur a small delay as the old model is disposed from VRAM and the new one is re-initialized (from cache). This is necessary to prevent browser crashes.

## Proposed Changes

### Assets & Dependencies
#### [NEW] [Assets Copy]
- Copy `assets/` (containing ONNX models and voice styles) from `supertonic-temp` to `public/assets/`.
- Ensure `onnxruntime-web` and `@huggingface/transformers` are installed (already checked).

### AI Worker
#### [NEW] [ai.worker.js](file:///c:/Users/lucas/morti/src/lib/workers/ai.worker.js)
- **ModelManager (Singleton)**:
    - Maintains `currentPipeline`.
    - `switchPipeline(type, config)`: Calls `dispose()` on current pipeline, then initializes the new one.
- **Pipelines**:
    - `WhisperPipeline`: Wrapper around `transformers.js` Whisper.
    - `LlmPipeline`: Wrapper around `transformers.js` TextGenerationPipeline (Chat).
    - `TtsPipeline`: Port of `Supertonic-2` logic (loading ONNX models, preprocessing, inference).
- **Message Handling**:
    - `type: 'configure'` -> Sets language, voice, etc.
    - `type: 'transcribe'` -> Activates Whisper, returns text.
    - `type: 'chat'` -> Activates LLM, streams tokens.
    - `type: 'speak'` -> Activates TTS, streams audio chunks.

### Frontend Integration
#### [MODIFY] [stt.worker.js](file:///c:/Users/lucas/morti/src/lib/workers/stt.worker.js)
- **Deprecate/Replace**: We will eventually replace this with `ai.worker.js`, or refactor it to be the `ai.worker.js`. For now, I will create `ai.worker.js` and update the consumer to point to it.

#### [MODIFY] [App.jsx](file:///c:/Users/lucas/morti/src/App.jsx) (or relevant consumer)
- Update worker instantiation to use `ai.worker.js`.
- Handle new message types.

## Verification Plan

### Automated Tests
- None (WebGPU is hard to test in CI/headless).

### Manual Verification
1.  **STT**: Record audio -> Verify transcription.
2.  **Chat**: Send transcription to LLM -> Verify text response.
3.  **TTS**: Send text response to TTS -> Verify audio playback.
4.  **Switching**: Verify that the previous model is unloaded (check VRAM if possible, or console logs for "Disposing...") before the next one starts.
5.  **Performance**: Verify TTS chunks are streamed and playback starts quickly.
