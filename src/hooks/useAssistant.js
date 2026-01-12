
import { useState, useEffect, useRef, useCallback } from 'react';
import LlmWorker from '../lib/workers/llm.worker.js?worker';
import TtsWorker from '../lib/workers/tts.worker.js?worker';
import { Mutex } from '../lib/mutex';
import { useTranscriber } from './useTranscriber';

export const useAssistant = () => {
    const { transcribe, isTranscribing, loadingStatus: sttLoadingStatus } = useTranscriber();

    // Workers (LLM & TTS still on workers for now)
    const llmWorker = useRef(null);
    const ttsWorker = useRef(null);

    // Pipeline Lock
    const mutex = useRef(new Mutex());

    // State
    const [status, setStatus] = useState('idle'); // idle, listening, transcribing, thinking, speaking
    const [transcript, setTranscript] = useState('');
    const [response, setResponse] = useState('');

    // Detailed Loading State for UI
    const [loadingStatus, setLoadingStatus] = useState({});

    // Sync STT loading status to main loading status
    useEffect(() => {
        if (Object.keys(sttLoadingStatus).length > 0) {
            setLoadingStatus(prev => ({ ...prev, ...sttLoadingStatus, source: 'stt' }));
        }
    }, [sttLoadingStatus]);

    // Inference Progress (legacy compat)
    const [progress, setProgress] = useState({ stt: 0, llm: 0, tts: 0 });

    const [conversation, setConversation] = useState([]);
    const [logs, setLogs] = useState([]);

    const addLog = useCallback((source, message) => {
        console.log(`[${source}] ${message}`);
        setLogs(prev => [...prev, { source, message, timestamp: Date.now() }].slice(-50));
    }, []);

    // Helper to update loading status (for LLM/TTS workers)
    const updateLoading = useCallback((source, data) => {
        if (!data || !data.file) return;
        setLoadingStatus(prev => ({
            ...prev,
            [data.file]: { ...data, source }
        }));
    }, []);

    // Initialize Workers Lazily (LLM & TTS)
    useEffect(() => {
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
        if (status !== 'idle' && status !== 'listening') {
            return;
        }

        await mutex.current.lock();
        setStatus('transcribing');

        try {
            const text = await transcribe(audioBuffer);

            if (text) {
                setTranscript(text);
                setStatus('thinking');

                // Trigger LLM
                const worker = await ensureLlmWorker();
                const messages = [
                    { role: 'system', content: 'You are Hey Buddy, a helpful and witty AI assistant.' },
                    ...conversation,
                    { role: 'user', content: text }
                ];
                setConversation(prev => [...prev, { role: 'user', content: text }]);
                worker.postMessage({ action: 'generate', messages });
            } else {
                console.warn("STT returned empty text");
                setStatus('idle');
                mutex.current.unlock();
            }
        } catch (e) {
            console.error("Pipeline breakdown:", e);
            setStatus('error');
            mutex.current.unlock();
        }
    }, [status, transcribe, conversation]);

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
