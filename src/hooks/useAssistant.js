
import { useState, useEffect, useRef, useCallback } from 'react';
import AiWorker from '../lib/workers/ai.worker.js?worker';
import { Mutex } from '../lib/mutex';

// Simple Audio Queue Player for gapless playback
class AudioQueuePlayer {
    constructor(sampleRate = 24000) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
        this.nextStartTime = 0;
        this.isPlaying = false;
        this.onComplete = null;
    }

    reset() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.nextStartTime = this.ctx.currentTime;
        this.isPlaying = false;
    }

    scheduleChunk(chunk) {
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const buffer = this.ctx.createBuffer(1, chunk.length, this.ctx.sampleRate);
        buffer.getChannelData(0).set(chunk);

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);

        // Schedule
        // If nextStartTime is in the past, reset to now
        if (this.nextStartTime < this.ctx.currentTime) {
            this.nextStartTime = this.ctx.currentTime + 0.05; // small buffer
        }

        source.start(this.nextStartTime);
        this.nextStartTime += buffer.duration;
        this.isPlaying = true;

        // Verify end? 
        // We can't easily know when *sequence* ends without a specific signal.
        // But for visualizer, we might just assume playing while queue not empty.
    }
}

export const useAssistant = () => {
    // Worker
    const workerRef = useRef(null);
    const audioPlayerRef = useRef(null);
    const mutex = useRef(new Mutex());

    // State
    const [status, setStatus] = useState('idle'); // idle, listening, transcribing, thinking, speaking
    const [transcript, setTranscript] = useState('');
    const [response, setResponse] = useState('');
    const [loadingStatus, setLoadingStatus] = useState({});

    // Legacy support for progress API
    const [progress, setProgress] = useState({ stt: 0, llm: 0, tts: 0 });

    const [conversation, setConversation] = useState([]);
    const [logs, setLogs] = useState([]);

    // --- Helpers (Hoisted manually by placing at top) ---

    // WAV Encoder helper for resampling
    const floatToWav = (samples, sampleRate) => {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
        };

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true); // block align
        view.setUint16(34, 16, true); // bits per sample
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return buffer;
    };

    // Unified Logger
    const addLog = useCallback((source, message) => {
        let textStr = '';
        if (typeof message === 'string') {
            textStr = message;
        } else if (message instanceof Error) {
            textStr = message.message;
        } else if (typeof message === 'object') {
            // Handle Event objects or other non-Error objects
            textStr = message.message || JSON.stringify(message, null, 2) || 'Unknown Object';
        } else {
            textStr = String(message);
        }
        setLogs(prev => [...prev.slice(-49), { source, message: textStr, timestamp: Date.now() }]);
    }, [setLogs]);

    // Progress Handler
    const handleProgress = useCallback((data) => {
        // { status: 'progress', file, progress, ... }
        if (!data.file) return;
        let source = 'unknown';
        if (data.file.includes('whisper')) source = 'stt';
        else if (data.file.includes('SmolLM') || data.file.includes('Llama')) source = 'llm';
        else if (data.file.includes('duration') || data.file.includes('vocoder') || data.file.includes('encoder') || data.file.includes('cfgs')) source = 'tts';

        if (source !== 'unknown') {
            setLoadingStatus(prev => ({ ...prev, [data.file]: { ...data, source } }));
            setProgress(p => ({ ...p, [source]: data.progress }));
        }
    }, [setLoadingStatus, setProgress]);

    // Ephemeral Worker Factory
    const runWorkerTask = useCallback(async (taskType, payload, onMessage) => {
        return new Promise((resolve, reject) => {
            const worker = new AiWorker();

            worker.onmessage = (e) => {
                const { status, error } = e.data;

                // Forward all messages to the handler
                if (onMessage) onMessage(e.data);

                if (status === 'complete') {
                    // Slight delay to allow final cleanup or buffer flushes if needed
                    setTimeout(() => {
                        worker.terminate();
                        resolve(e.data);
                    }, 500);
                } else if (status === 'error') {
                    worker.terminate();
                    reject(new Error(error));
                }
            };

            worker.onerror = (err) => {
                worker.terminate();
                reject(err);
            };

            worker.postMessage({ type: taskType, ...payload });
        });
    }, []);

    // --- Effects ---

    useEffect(() => {
        // Trigger Preload on Mount
        // We use a fire-and-forget pattern with the ephemeral worker.
        // Check if already preloaded? For now, we rely on browser cache check which is fast.
        const doPreload = async () => {
            try {
                await runWorkerTask('preload', {}, (data) => {
                    if (data.status === 'progress') handleProgress(data);
                });
                addLog('system', 'All models cached/ready.');
            } catch (e) {
                console.warn("Preload warning:", e);
            }
        };

        // Delay slightly to not block UI paint
        setTimeout(doPreload, 1000);
    }, [runWorkerTask, handleProgress, addLog]);

    const processAudio = useCallback(async (audioBuffer) => {
        if (mutex.current.isLocked()) return;

        await mutex.current.lock();
        addLog('system', 'Starting pipeline...');
        setStatus('transcribing');
        setTranscript('');
        setResponse('');
        const currentId = Date.now();

        try {
            // --- 0. Audio Preprocessing (Resample to 16kHz) ---
            // Whisper expects 16kHz audio. If input is 44.1/48k, it produces gibberish.
            // We assume audioBuffer is Float32Array. 
            // Ideally we need the source sample rate. 
            // If unknown, we might be guessing, but standard Web Audio is 44.1/48k.
            // Since we don't have the source rate here easily (useWakeWord just passes buffer),
            // Fix: We will assume the input is NOT 16kHz and trust the worker to use an AudioProcessor?
            // No, transformers.js worker expects 16k if we pass raw floats.


            // --- 0. Audio Preprocessing (Native AudioContext Resampling) ---
            // Whisper requires 16000Hz. We use the browser's native resampler for quality w/ anti-aliasing.

            const targetRate = 16000;
            const sourceRate = window.AudioContext ? new window.AudioContext().sampleRate : 48000;
            let processedAudio = audioBuffer;

            addLog('system', `Input Audio: ${audioBuffer.length} samples @ ${sourceRate}Hz`);

            if (sourceRate !== targetRate) {
                try {
                    // 1. Pack into WAV container with correctly tagged logic
                    const wavBuffer = floatToWav(audioBuffer, sourceRate);

                    // 2. Decode using a 16kHz context (triggers native resampling)
                    const offlineCtx = new OfflineAudioContext(1, 1, targetRate); // Dummy context to get 16k env? 
                    // Actually, OfflineAudioContext(1, length, 16000) is better but we don't know length.
                    // We can use a standard AudioContext with sampleRate: 16000 option (supported in modern browsers).
                    const resampleCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: targetRate });

                    const decoded = await resampleCtx.decodeAudioData(wavBuffer);
                    processedAudio = decoded.getChannelData(0);

                    // Close context to free resources
                    resampleCtx.close();

                    addLog('system', `Resampled: ${processedAudio.length} samples (Native)`);
                } catch (e) {
                    console.error("Resample failed", e);
                    addLog('error', `Resample Logic Failed: ${e.message}`);
                    // Fallback to raw (might fail)
                }
            } else {
                addLog('system', `Rate match (16kHz). No resample needed.`);
            }

            // --- 1. STT ---
            addLog('stt', 'Initializing worker...');
            let transcription = '';

            await runWorkerTask('transcribe', { audio: processedAudio, language: 'en' }, (data) => {
                if (data.status === 'progress') handleProgress(data);
                if (data.status === 'update') {
                    // Whisper streamer provides { text, chunks, tps } in data
                    const text = data.data?.text || '';
                    setTranscript(text);
                    transcription = text;
                }
                if (data.status === 'complete') {
                    transcription = data.text;
                    setTranscript(data.text);
                    addLog('stt', `Complete: ${data.text}`);
                    setConversation(prev => [...prev, { role: 'user', content: data.text }]);
                }
            });

            if (!transcription.trim()) {
                throw new Error("No transcription received");
            }

            // --- 2. Chat ---
            setStatus('thinking');
            addLog('llm', 'Initializing worker...');
            let assistantReply = '';

            // Build Context
            // Note: conversation state might be stale in this closure, but we appended user msg above conceptually.
            // We'll use the functional state updater or a ref if precise history is needed. 
            // For safety, let's just use the current transcription + simple history or just transcription.
            // To do it right: use a Ref for history tracking across the pipeline function scope.

            const prompt = conversation.length > 0
                ? [...conversation, { role: 'user', content: transcription }]
                : [{ role: 'user', content: transcription }];

            await runWorkerTask('chat', { messages: prompt }, (data) => {
                if (data.status === 'progress') handleProgress(data);
                if (data.status === 'update') {
                    setResponse(prev => prev + data.output);
                    assistantReply += data.output;
                }
            });

            addLog('llm', `Complete. Length: ${assistantReply.length}`);
            setConversation(prev => [...prev, { role: 'assistant', content: assistantReply }]);

            // --- 3. TTS ---
            setStatus('speaking');
            addLog('tts', 'Initializing worker...');

            await runWorkerTask('speak', { text: assistantReply }, (data) => {
                if (data.status === 'progress') handleProgress(data);
                if (data.status === 'audio_chunk') {
                    if (!audioPlayerRef.current) audioPlayerRef.current = new AudioQueuePlayer(data.sampleRate);
                    audioPlayerRef.current.scheduleChunk(data.audio);
                }
            });

            addLog('tts', 'Playback queued.');

            // Wait for queue to finish?
            // The worker is done, but audio might still be playing.
            // We can release mutex now or wait. Let's wait a bit.
            setTimeout(() => {
                setStatus('idle');
                mutex.current.unlock();
                addLog('system', 'Pipeline finished.');
            }, 3000);

        } catch (error) {
            console.error(error);
            addLog('error', error.message || error);
            setStatus('error');
            mutex.current.unlock();
        }
    }, [runWorkerTask, conversation, addLog, handleProgress]);

    return {
        status,
        transcript,
        response,
        progress: loadingStatus,
        processAudio,
        logs
    };
};
