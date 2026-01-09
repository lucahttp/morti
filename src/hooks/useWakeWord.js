import { useState, useRef, useCallback } from 'react';
import { HeyBuddy } from '../lib/hey-buddy.js';

const REMOTE_ROOT = "https://huggingface.co/benjamin-paine/hey-buddy/resolve/main";

export const useWakeWord = (options = {}) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isMicActive, setIsMicActive] = useState(false);
    const [probabilities, setProbabilities] = useState({});
    const [activeDebug, setActiveDebug] = useState({});
    const [frameBudget, setFrameBudget] = useState(0);
    const [error, setError] = useState(null);

    const heyBuddyRef = useRef(null);

    const start = useCallback(async () => {
        try {
            if (!heyBuddyRef.current) {
                // Request microphone permission first
                await navigator.mediaDevices.getUserMedia({ audio: true });

                // Initialize HeyBuddy with mixed local/remote models
                const instance = new HeyBuddy({
                    ...options,
                    // Use local wake word models
                    modelPath: options.modelPath || ["hey-buddy", "buddy", "hi-buddy", "sup-buddy", "yo-buddy", "okay-buddy", "hello-buddy"].map(w => `/models/${w}.onnx`),
                    // Use remote pretrained models for VAD/Spectrogram/Embedding
                    vadModelPath: options.vadModelPath || `${REMOTE_ROOT}/pretrained/silero-vad.onnx`,
                    spectrogramModelPath: options.spectrogramModelPath || `${REMOTE_ROOT}/pretrained/mel-spectrogram.onnx`,
                    embeddingModelPath: options.embeddingModelPath || `${REMOTE_ROOT}/pretrained/speech-embedding.onnx`,
                });

                // Set up callback
                instance.onProcessed((result) => {
                    setIsListening(result.listening);
                    setIsRecording(result.recording);

                    const probs = {
                        speech: result.speech.probability || 0.0,
                    };
                    const active = {
                        speech: result.speech.active,
                    }

                    if (result.wakeWords) {
                        for (let name in result.wakeWords) {
                            // Normalize name (remove extension if present, though result.wakeWords keys are usually clean)
                            const cleanName = name.replace('-', ' ');
                            probs[cleanName] = result.wakeWords[name].probability || 0.0;
                            active[cleanName] = result.wakeWords[name].active;
                        }
                    }

                    setProbabilities(probs);
                    setActiveDebug(active);
                    setFrameBudget(instance.frameTimeEma);
                });

                instance.onRecording((buffer) => {
                    if (options.onRecordingComplete) {
                        options.onRecordingComplete(buffer);
                    }
                });

                heyBuddyRef.current = instance;
                setIsMicActive(true);
            }
        } catch (err) {
            console.error("Failed to start HeyBuddy:", err);
            setError(err.message || "Microphone access denied or initialization failed.");
        }
    }, [options]);

    return {
        start,
        isListening,
        isRecording,
        probabilities,
        active: activeDebug,
        frameBudget,
        error,
        isMicActive
    };
};
