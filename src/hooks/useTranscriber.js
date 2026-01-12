import { useState, useCallback, useRef } from 'react';
import { AutomaticSpeechRecognitionService } from '../lib/ai/speech-recognition';

export const useTranscriber = () => {
    const [result, setResult] = useState(null);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState({}); // { [file]: { status, progress, ... } }

    const transcribe = useCallback(async (audioBuffer) => {
        setIsTranscribing(true);
        try {
            const output = await AutomaticSpeechRecognitionService.transcribe(audioBuffer, 'english', (data) => {
                // Progress callback from transformers.js
                // data format: { status: 'progress', file: '...', progress: 0-100, ... } OR { status: 'initiate', ... }
                // The service might bubble up raw events, or we need to adapt inside the service.
                // The service's getInstance passes this callback to .from_pretrained.

                if (data.status === 'progress' || data.status === 'initiate') {
                    setLoadingStatus(prev => ({
                        ...prev,
                        [data.file]: data
                    }));
                }
            });
            setResult(output);
            return output;
        } catch (error) {
            console.error("Transcriber Error:", error);
            throw error;
        } finally {
            setIsTranscribing(false);
        }
    }, []);

    return {
        transcribe,
        result,
        isTranscribing,
        loadingStatus
    };
};
