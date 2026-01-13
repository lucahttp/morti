
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
        if (!workerRef.current) {
            const worker = new AiWorker();

            const handleMessage = (e) => {
                const data = e.data;

                if (data.status === 'progress') {
                    setProgress(prev => ({
                        ...prev,
                        [data.file || 'model']: { ...data, source: (data.file?.includes('whisper') || data.source === 'stt') ? 'stt' : (data.file?.includes('qwen') || data.source === 'llm') ? 'llm' : 'tts' }
                    }));
                } else if (data.status === 'debug') {
                    console.log("[Worker Debug]", data.message);
                } else if (data.status === 'error') {
                    console.error("[Worker Error]", data.error);
                    addLog('error', data.error);
                }
            };

            worker.addEventListener('message', handleMessage);
            workerRef.current = worker;

            // Optional: Start preloading immediately
            worker.postMessage({ action: 'preload' });
        }

        return () => {
            // We keep it alive for the session, but could terminate on unmount
            // workerRef.current?.terminate();
        };
    }, [addLog]);

    const processAudio = useCallback(async (audioData) => {
        if (mutex.current.isLocked()) return;
        await mutex.current.lock();

        try {
            setStatus('transcribing');
            setTranscript('');
            setResponse('');
            addLog('system', 'Processing audio...');

            // 1. Audio Prep (Resampling & Mono Conversion)
            // Whisper expects 16kHz mono.
            const targetRate = 16000;

            // Average channels if stereo (matching whisper-web reference)
            let monoAudio;
            if (audioData instanceof AudioBuffer) {
                if (audioData.numberOfChannels > 1) {
                    const SCALING_FACTOR = Math.sqrt(2);
                    const left = audioData.getChannelData(0);
                    const right = audioData.getChannelData(1);
                    monoAudio = new Float32Array(left.length);
                    for (let i = 0; i < left.length; ++i) {
                        monoAudio[i] = (SCALING_FACTOR * (left[i] + right[i])) / 2;
                    }
                } else {
                    monoAudio = audioData.getChannelData(0);
                }
            } else {
                // Already a Float32Array from wake word recorder
                monoAudio = audioData;
            }

            // At this point we assume 'monoAudio' is 16kHz because useWakeWord/HeyBuddy 
            // should already be providing 16kHz batches. Let's verify.
            addLog('stt', `Input: ${monoAudio.length} samples`);

            // 2. Transcription (Persistent Worker)
            const worker = workerRef.current;
            let transcription = '';

            const sttPromise = new Promise((resolve, reject) => {
                const listener = (e) => {
                    const data = e.data;
                    if (data.status === 'update') {
                        const text = data.data?.text || '';
                        setTranscript(text);
                        transcription = text;
                    } else if (data.status === 'complete' && (data.text || data.chunks)) {
                        worker.removeEventListener('message', listener);
                        transcription = data.text;
                        setTranscript(data.text);
                        addLog('stt', `Complete: ${data.text}`);
                        resolve(data.text);
                    } else if (data.status === 'error' && data.action === 'transcribe') {
                        worker.removeEventListener('message', listener);
                        reject(new Error(data.error));
                    }
                };
                worker.addEventListener('message', listener);
                worker.postMessage({ action: 'transcribe', data: { audio: monoAudio, language: 'en' } });
            });

            const finalTranscript = await sttPromise;
            if (!finalTranscript.trim()) throw new Error("No speech detected.");

            // Update Conversation
            setConversation(prev => [...prev, { role: 'user', content: finalTranscript }]);

            // 3. Chat
            setStatus('thinking');
            addLog('llm', 'Thinking...');
            let assistantReply = '';

            const chatPromise = new Promise((resolve) => {
                const listener = (e) => {
                    const data = e.data;
                    if (data.status === 'update' && !data.data) { // Standard update
                        setResponse(prev => prev + data.output);
                        assistantReply += data.output;
                    } else if (data.status === 'complete' && !data.text) { // Chat complete
                        worker.removeEventListener('message', listener);
                        addLog('llm', `Complete. Length: ${assistantReply.length}`);
                        resolve(assistantReply);
                    }
                };
                worker.addEventListener('message', listener);
                worker.postMessage({ action: 'chat', data: { messages: [...conversation, { role: 'user', content: finalTranscript }] } });
            });

            const finalReply = await chatPromise;
            setConversation(prev => [...prev, { role: 'assistant', content: finalReply }]);

            // 4. TTS
            setStatus('speaking');
            addLog('tts', 'Synthesizing...');

            const ttsPromise = new Promise((resolve) => {
                const listener = (e) => {
                    const data = e.data;
                    if (data.status === 'audio_chunk') {
                        if (!audioPlayerRef.current) audioPlayerRef.current = new AudioQueuePlayer(data.sampleRate);
                        audioPlayerRef.current.scheduleChunk(data.audio);
                    } else if (data.status === 'complete' && !data.text) { // TTS complete
                        worker.removeEventListener('message', listener);
                        addLog('tts', 'Playback complete.');
                        resolve();
                    }
                };
                worker.addEventListener('message', listener);
                worker.postMessage({ action: 'speak', data: { text: finalReply } });
            });

            await ttsPromise;

            setTimeout(() => {
                setStatus('idle');
                mutex.current.unlock();
                addLog('system', 'Ready.');
            }, 1000);

        } catch (err) {
            console.error(err);
            addLog('error', err.message || err);
            setStatus('error');
            mutex.current.unlock();
            setTimeout(() => setStatus('idle'), 3000);
        }
    }, [conversation, addLog]);

    return {
        status,
        transcript,
        response,
        progress,
        processAudio,
        logs
    };
};
