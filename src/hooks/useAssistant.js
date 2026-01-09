
import { useState, useEffect, useRef, useCallback } from 'react';
import SttWorker from '../lib/workers/stt.worker.js?worker';
import LlmWorker from '../lib/workers/llm.worker.js?worker';
import TtsWorker from '../lib/workers/tts.worker.js?worker';
import { Mutex } from '../lib/mutex';

export const useAssistant = () => {
    // Workers
    const sttWorker = useRef(null);
    const llmWorker = useRef(null);
    const ttsWorker = useRef(null);

    // Pipeline Lock
    const mutex = useRef(new Mutex());

    // State
    const [status, setStatus] = useState('idle'); // idle, listening, transcribing, thinking, speaking
    const [transcript, setTranscript] = useState('');
    const [response, setResponse] = useState('');

    // Detailed Loading State for UI (File downloads)
    const [loadingStatus, setLoadingStatus] = useState({}); // { [filename]: { status, progress, loaded, total, source: 'stt'|'llm'|'tts' } }

    // Inference Progress (simple percent mostly for LLM generation if we hooked it up, or just keeping legacy)
    // We'll keep 'progress' for legacy props but map it to mostly loading or inference if available.
    const [progress, setProgress] = useState({ stt: 0, llm: 0, tts: 0 });

    const [conversation, setConversation] = useState([]);
    const [logs, setLogs] = useState([]);

    const addLog = useCallback((source, message) => {
        console.log(`[${source}] ${message}`);
        setLogs(prev => [...prev, { source, message, timestamp: Date.now() }].slice(-50));
    }, []);

    // Helper to update loading status
    const updateLoading = useCallback((source, data) => {
        if (!data || !data.file) return; // Ignore non-file progress
        setLoadingStatus(prev => ({
            ...prev,
            [data.file]: { ...data, source }
        }));
    }, []);

    // Initialize Workers Lazily
    useEffect(() => {
        // Init STT
        if (!sttWorker.current) {
            sttWorker.current = new SttWorker();
            sttWorker.current.onerror = (err) => {
                console.error("[Assistant] STT Worker startup error:", err);
                setStatus('error'); // Unlock just in case
                mutex.current.unlock();
            };
            sttWorker.current.onmessage = (e) => {
                const { status, data, text, output, message, error } = e.data;
                console.log(`[Assistant] STT Worker Message: ${status}`, e.data); // RAW LOGGING

                if (status === 'debug') {
                    addLog('stt', message);
                }
                if (status === 'progress') {
                    updateLoading('stt', data);
                    if (data.progress) setProgress(p => ({ ...p, stt: data.progress }));
                }
                if (status === 'update') {
                    setTranscript(prev => prev + output);
                }
                if (status === 'complete') {
                    setTranscript(text);
                    setStatus('thinking');

                    ensureLlmWorker().then(worker => {
                        const messages = [
                            { role: 'system', content: 'You are Hey Buddy, a helpful and witty AI assistant.' },
                            ...conversation,
                            { role: 'user', content: text }
                        ];
                        setConversation(prev => [...prev, { role: 'user', content: text }]);
                        worker.postMessage({ action: 'generate', messages });
                    });
                }
                if (status === 'error') {
                    console.error("STT Error:", error);
                    setStatus('error');
                    mutex.current.unlock();
                }
            };
            sttWorker.current.postMessage({ action: 'init' });
        }

        // Preload LLM
        if (!llmWorker.current) {
            const worker = new LlmWorker();
            worker.onmessage = (e) => {
                const { status, data, text, error } = e.data;
                if (status === 'progress') {
                    updateLoading('llm', data);
                    if (data.progress) setProgress(p => ({ ...p, llm: data.progress }));
                }
                if (status === 'complete') {
                    setResponse(text);
                    setStatus('speaking');
                    setConversation(prev => [...prev, { role: 'assistant', content: text }]);
                    ensureTtsWorker().then(tts => {
                        tts.postMessage({ action: 'speak', text });
                    });
                }
                if (status === 'error') {
                    console.error("LLM Error:", error);
                    setStatus('error');
                    mutex.current.unlock();
                }
            };
            worker.postMessage({ action: 'init' });
            llmWorker.current = worker;
        }

        // Preload TTS
        if (!ttsWorker.current) {
            const worker = new TtsWorker();
            worker.onmessage = (e) => {
                const { status, data, audio, sampling_rate, error } = e.data;
                if (status === 'progress') {
                    updateLoading('tts', data);
                    if (data.progress) setProgress(p => ({ ...p, tts: data.progress }));
                }
                if (status === 'complete') playAudio(audio, sampling_rate);
                if (status === 'error') {
                    console.error("TTS Error:", error);
                    setStatus('error');
                    mutex.current.unlock();
                }
            };
            worker.postMessage({ action: 'init' });
            ttsWorker.current = worker;
        }

        return () => {
            sttWorker.current?.terminate();
            llmWorker.current?.terminate();
            ttsWorker.current?.terminate();
        };
    }, [conversation, updateLoading]);

    // Helper to lazy init LLM (Just returns current since we preloaded)
    const ensureLlmWorker = async () => {
        if (llmWorker.current) return llmWorker.current;
        // Fallback if effect didn't run for some reason
        const worker = new LlmWorker();
        worker.onmessage = (e) => {
            const { status, data, text, error } = e.data;
            if (status === 'progress') {
                updateLoading('llm', data);
                if (data.progress) setProgress(p => ({ ...p, llm: data.progress }));
            }
            if (status === 'complete') {
                setResponse(text);
                setStatus('speaking');
                setConversation(prev => [...prev, { role: 'assistant', content: text }]);
                ensureTtsWorker().then(tts => {
                    tts.postMessage({ action: 'speak', text });
                });
            }
            if (status === 'error') {
                console.error("LLM Error:", error);
                setStatus('error');
                mutex.current.unlock();
            }
        };
        llmWorker.current = worker;
        return worker;
    };

    // Helper to lazy init TTS
    const ensureTtsWorker = async () => {
        if (ttsWorker.current) return ttsWorker.current;
        const worker = new TtsWorker();
        worker.onmessage = (e) => {
            const { status, data, audio, sampling_rate, error } = e.data;
            if (status === 'progress') {
                updateLoading('tts', data);
                if (data.progress) setProgress(p => ({ ...p, tts: data.progress }));
            }
            if (status === 'complete') {
                playAudio(audio, sampling_rate);
            }
            if (status === 'error') {
                console.error("TTS Error:", error);
                setStatus('error');
                mutex.current.unlock();
            }
        };
        ttsWorker.current = worker;
        return worker;
    };

    // We'll wrap the "Start" in a mutex check
    const processAudio = useCallback(async (audioBuffer) => {
        // If already busy, ignore new audio (Debounce/Lock)
        if (status !== 'idle' && status !== 'listening') {
            console.warn("Pipeline busy, ignoring audio.");
            return;
        }

        // Lock pipeline
        await mutex.current.lock();

        setStatus('transcribing');
        try {
            sttWorker.current.postMessage({ action: 'transcribe', audio: audioBuffer });
        } catch (e) {
            mutex.current.unlock(); // Release if fail
        }
    }, [status]);

    const playAudio = (audioData, sampleRate) => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
        const buffer = audioContext.createBuffer(1, audioData.length, sampleRate);
        buffer.getChannelData(0).set(audioData);

        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.onended = () => {
            setStatus('idle');
            mutex.current.unlock(); // <--- RELEASE MUTEX HERE
            console.log("Pipeline cycle complete, mutex released.");
        };
        source.start(0);
    };

    return {
        status,
        transcript,
        response,
        progress: loadingStatus,
        processAudio,
        logs
    };
};
