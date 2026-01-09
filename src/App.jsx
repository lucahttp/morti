import { useState, useEffect } from 'react';
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
      const wavUrl = samplesToWavUrl(buffer);
      setLastRecording(wavUrl);
    }
  });

  // Auto-start listening on mount or button click (User might prefer auto-start for an "Assistant" feel, 
  // but browsers block audio context without interaction. We'll keep the button for now but style it.)

  const [assistantState, setAssistantState] = useState('idle'); // idle, listening, processing, speaking
  useEffect(() => {
    if (isRecording) setAssistantState('processing');
    else if (isListening) setAssistantState('listening');
    else setAssistantState('idle');
  }, [isListening, isRecording]);

  return (
    <div className="flex flex-col h-screen w-screen bg-brand-dark text-white overflow-hidden relative selection:bg-brand-teal selection:text-black">
      {/* Ambient Background */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-brand-blue/10 rounded-full blur-[120px] animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-brand-purple/10 rounded-full blur-[120px] animate-pulse-slow" style={{ animationDelay: '1.5s' }}></div>
      </div>

      {/* Header / Top Bar */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5 border-b border-white/5 bg-brand-dark/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Hey Buddy" className="h-10 w-10 object-contain drop-shadow-[0_0_10px_rgba(22,200,206,0.5)]" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Hey Buddy <span className="text-brand-teal text-opacity-80 font-mono text-sm ml-2">v0.1.2</span></h1>
            <div className="flex items-center gap-2 text-xs text-white/50 font-mono">
              <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-brand-green shadow-[0_0_8px_#33e38a]' : 'bg-red-500'}`}></span>
              {isListening ? "SYSTEM ACTIVE" : "SYSTEM OFFLINE"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 opacity-70 hover:opacity-100 transition-opacity">
          <a href="https://github.com/painebenjamin/hey-buddy" target="_blank" rel="noreferrer" className="hover:text-brand-teal transition-colors">
            <img src="https://img.shields.io/static/v1?label=painebenjamin&message=hey-buddy&logo=github&color=0b1830&style=flat-square" alt="GitHub" className="h-6" />
          </a>
        </div>
      </header>

      {/* Main Dashboard Layout */}
      <main className="relative z-10 flex-1 flex p-6 gap-6 overflow-hidden">

        {/* Left Col: Visualizer & Controls */}
        <div className="flex-[2] flex flex-col gap-6 min-w-0">
          {/* Visualizer Panel */}
          <section className="glass-panel flex-1 flex flex-col min-h-[300px] relative overflow-hidden p-0 border-brand-teal/20 shadow-[0_0_30px_rgba(0,0,0,0.3)]">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brand-teal to-transparent opacity-50"></div>
            <AudioVisualizer
              probabilities={probabilities}
              active={active}
              frameBudget={frameBudget}
            />

            {/* Overlay interaction hint */}
            {!isListening && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-20 transition-all duration-500">
                <button onClick={start} className="group relative">
                  <div className="absolute inset-0 bg-brand-teal rounded-full blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500 animate-pulse"></div>
                  <div className="relative btn-primary text-lg py-4 px-10 rounded-full flex items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    ACTIVATE LISTENING
                  </div>
                </button>
              </div>
            )}
          </section>

          {/* Status / Output Log */}
          <section className="glass-panel h-48 flex flex-col gap-2 overflow-hidden">
            <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
              <h3 className="font-mono text-sm text-brand-teal tracking-widest uppercase">System Log</h3>
              <span className="text-xs text-white/30 font-mono">buffer: 16khz (1ch)</span>
            </div>
            <div className="flex-1 font-mono text-xs text-white/70 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-white/10">
              <div className="opacity-50">[SYSTEM] Initializing models...</div>
              {isListening && <div className="text-brand-green">[SUCCESS] Audio stream active. Listening for wake words...</div>}
              {isRecording && <div className="text-brand-orange animate-pulse">[EVENT] Wake word detected! Recording audio clip...</div>}
              {lastRecording && <div className="text-brand-blue">[OUTPUT] Audio clip generated. Ready for STT processing.</div>}
              {error && <div className="text-red-500">[ERROR] {error}</div>}
            </div>
          </section>
        </div>

        {/* Right Col: Assistant Placeholder / Stats */}
        <div className="flex-1 flex flex-col gap-6 min-w-[300px] max-w-[400px]">

          {/* Assistant Status Card */}
          <div className="glass-panel items-center justify-center flex flex-col gap-4 py-10 relative overflow-hidden border-t border-brand-purple/30">
            <div className={`w-32 h-32 rounded-full border-2 flex items-center justify-center transition-all duration-700 relative
                        ${assistantState === 'listening' ? 'border-brand-teal shadow-[0_0_30px_#009988]' :
                assistantState === 'processing' ? 'border-brand-orange shadow-[0_0_40px_#ee7733] scale-110' :
                  'border-white/10 grayscale opacity-50'}`}>

              <div className={`absolute inset-0 rounded-full bg-current opacity-10 blur-xl animate-pulse`}></div>
              <img src="/logo.png" className={`w-20 h-20 object-contain transition-transform duration-300 ${assistantState === 'processing' ? 'animate-bounce' : ''}`} />
            </div>

            <div className="text-center z-10">
              <h2 className="text-2xl font-bold tracking-tight">
                {assistantState === 'listening' ? 'Listening...' :
                  assistantState === 'processing' ? 'Processing...' :
                    'Standby'}
              </h2>
              <p className="text-white/40 text-sm mt-1">
                {assistantState === 'listening' ? 'Say "Hey Buddy"' :
                  assistantState === 'processing' ? 'Analyzing audio...' :
                    'Waiting for activation'}
              </p>
            </div>
          </div>

          {/* Future Features / Stats */}
          <div className="glass-panel flex-1 flex flex-col gap-4">
            <h3 className="font-mono text-xs text-white/40 uppercase tracking-widest">Pipeline Status</h3>

            <div className="space-y-4">
              {/* Wake Word Item */}
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded flex items-center justify-center bg-brand-teal/20 text-brand-teal border border-brand-teal/30`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-white/90">Wake Word</div>
                  <div className="text-xs text-white/40">ONNX Runtime (WASM)</div>
                </div>
                <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-brand-green' : 'bg-white/20'}`}></div>
              </div>

              {/* STT Item (Placeholder) */}
              <div className="flex items-center gap-3 opacity-40">
                <div className="w-8 h-8 rounded flex items-center justify-center bg-white/5 border border-white/10">
                  <span className="font-mono text-xs">TXT</span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-white/90">Speech-to-Text</div>
                  <div className="text-xs text-white/40">Transformers.js (Waitlist)</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-white/20"></div>
              </div>

              {/* LLM Item (Placeholder) */}
              <div className="flex items-center gap-3 opacity-40">
                <div className="w-8 h-8 rounded flex items-center justify-center bg-white/5 border border-white/10">
                  <span className="font-mono text-xs">AI</span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-white/90">LLM Inference</div>
                  <div className="text-xs text-white/40">WebGPU (Waitlist)</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-white/20"></div>
              </div>
            </div>

            <div className="mt-auto p-3 bg-white/5 rounded-lg border border-white/5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-white/50 uppercase">Latest Audio Clip</span>
                {lastRecording && <a href={lastRecording} download="clip.wav" className="text-xs text-brand-teal hover:underline">Download</a>}
              </div>
              {lastRecording ? (
                <audio src={lastRecording} controls className="w-full h-8 opacity-80 hover:opacity-100" />
              ) : (
                <div className="text-xs text-center text-white/20 py-2 italic">No recordings yet</div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// Keep the updated samplesToWavUrl helper
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
