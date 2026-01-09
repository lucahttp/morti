import { useState, useRef } from 'react';
import './index.css';
import { useWakeWord } from './hooks/useWakeWord';
import { AudioVisualizer } from './components/AudioVisualizer';

function App() {
  const [lastRecording, setLastRecording] = useState(null);

  const {
    start,
    isListening,
    isRecording,
    probabilities,
    active,
    frameBudget,
    error
  } = useWakeWord({
    debug: false,
    onRecordingComplete: (buffer) => {
      // Convert Float32Array to WAV Blob URL
      const wavUrl = samplesToWavUrl(buffer);
      setLastRecording(wavUrl);
    }
  });

  return (
    <div className="card">
      <section id="logo">
        <img src="/logo.png" alt="Hey Buddy!" />
      </section>

      <section id="headline">
        <p><strong><em>Hey Buddy!</em></strong> is a library for training wake word models (a.k.a audio keyword spotters) and deploying them to the browser for real-time use on CPU or GPU.</p>
        <p>Using a wake-word as a gating mechanism for voice-enabled web applications carries numerous benefits, including reduced power consumption, improved privacy, and enhanced performance in noisy environments over speech-to-text systems.</p>
        <p>This space serves as a demonstration of the JavaScript library for front-end applications. Say something like, <em>&ldquo;Hey buddy, how are you?&rdquo;</em> to see the wake word and voice activity detection in action. Your voice command will be isolated as an audio clip, which is then ready to be sent to your application's backend for further processing.</p>
      </section>

      <section id="links">
        <a href="https://github.com/painebenjamin/hey-buddy" target="_blank" rel="noreferrer">
          <img src="https://img.shields.io/static/v1?label=painebenjamin&message=hey-buddy&logo=github&color=0b1830" alt="painebenjamin - hey-buddy" />
        </a>
        <a href="https://huggingface.co/benjamin-paine/hey-buddy" target="_blank" rel="noreferrer">
          <img src="https://img.shields.io/static/v1?label=benjamin-paine&message=hey-buddy&logo=huggingface&color=0b1830" alt="painebenjamin - hey-buddy" />
        </a>
      </section>

      {!isListening && !error && (
        <button
          onClick={start}
          style={{
            display: 'block', margin: '20px auto', padding: '10px 20px',
            background: '#16c8ce', border: 'none', borderRadius: '5px',
            color: '#0b0f19', fontWeight: 'bold', cursor: 'pointer'
          }}
        >
          Start Listening
        </button>
      )}

      {error && (
        <div style={{ color: 'red', textAlign: 'center', margin: '10px' }}>
          {error}
        </div>
      )}

      {(isListening || isRecording) && (
        <AudioVisualizer
          probabilities={probabilities}
          active={active}
          frameBudget={frameBudget}
        />
      )}

      <section id="recording">
        <label>Recording</label>
        <div id="audio">
          {isRecording ? "Recording..." : (
            lastRecording ? (
              <audio controls src={lastRecording} />
            ) : "No recording yet"
          )}
        </div>
      </section>
    </div>
  );
}

// Helper to convert samples to WAV (Ported from legacy index.js)
function samplesToWavUrl(audioSamples, sampleRate = 16000, numChannels = 1) {
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  const floatTo16BitPCM = (output, offset, input) => {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  };
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const wavHeaderSize = 44;
  const dataLength = audioSamples.length * numChannels * 2;
  const buffer = new ArrayBuffer(wavHeaderSize + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  floatTo16BitPCM(view, wavHeaderSize, audioSamples);

  const blob = new Blob([view], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

export default App;
