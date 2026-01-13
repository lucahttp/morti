import { useState, useEffect } from 'react';
import { useWakeWord } from './hooks/useWakeWord';
import { useAssistant } from './hooks/useAssistant'; // Import our new hook
import { AudioVisualizer } from './components/AudioVisualizer';

function App() {
  const [lastRecording, setLastRecording] = useState(null);

  // Initialize Assistant Hook
  const {
    status: assistantStatus,
    transcript,
    response,
    progress,
    processAudio,
    logs
  } = useAssistant();

  const {
    start,
    stopListening,
    resumeListening,
    isListening,
    isRecording,
    probabilities,
    active,
    frameBudget,
    error
  } = useWakeWord({
    debug: false,
    onRecordingComplete: (buffer) => {
      // Logic handled in useEffect now to avoid state closure issues? 
      // No, direct call is fine.
      const wavUrl = samplesToWavUrl(buffer);
      setLastRecording(wavUrl);
      processAudio(buffer);
    }
  });

  // Manage Wake Word State based on Assistant Status
  useEffect(() => {
    if (assistantStatus === 'idle') {
      // Only resume if we have started at least once (mic active)
      // We can check isListening? No, isListening toggles with VAD?
      // We just call resumeListening, which checks if instance exists.
      resumeListening();
    } else {
      stopListening();
    }
  }, [assistantStatus, stopListening, resumeListening]);

  // Auto-start listening on mount or button click (User might prefer auto-start for an "Assistant" feel, 
  // but browsers block audio context without interaction. We'll keep the button for now but style it.)

  // Auto-pause wake word detection when assistant is busy
  // Logic is now inside the main useWakeWord call below via useEffect triggering stopListening/resumeListening


  return (
    <div className="flex flex-col h-screen w-screen bg-brand-dark text-white overflow-hidden relative selection:bg-brand-teal selection:text-black">
      {/* Ambient Background */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className={`absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-brand-blue/10 rounded-full blur-[120px] transition-all duration-1000 ${assistantStatus === 'thinking' ? 'bg-brand-purple/20 animate-pulse' : ''}`}></div>
        <div className={`absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-brand-purple/10 rounded-full blur-[120px] transition-all duration-1000 ${assistantStatus === 'speaking' ? 'bg-brand-green/20 animate-pulse' : ''}`} style={{ animationDelay: '1.5s' }}></div>
      </div>

      {/* Supertonic-style Global Loading Bar */}
      {(() => {
        const loadingItems = Object.values(progress).filter(p => p.status !== 'done');
        const isGlobalLoading = loadingItems.length > 0;

        if (!isGlobalLoading) return null;

        // Calculate aggregate or just show the primary one
        const currentItem = loadingItems[0];
        const percent = currentItem.progress || 0;
        const totalMB = currentItem.total ? (currentItem.total / 1024 / 1024).toFixed(1) : '?';
        const loadedMB = currentItem.loaded ? (currentItem.loaded / 1024 / 1024).toFixed(1) : '0';

        return (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-6 animate-fade-in-down">
            <div className="bg-[#1a1500] border border-amber-900/30 rounded-lg shadow-2xl overflow-hidden relative">
              {/* Progress Fill */}
              <div
                className="absolute top-0 left-0 h-full bg-amber-600/20 transition-all duration-200 ease-out"
                style={{ width: `${percent}%` }}
              ></div>

              {/* Moving Gradient Sheen */}
              <div
                className="absolute top-0 left-0 h-full w-full bg-gradient-to-r from-transparent via-amber-500/10 to-transparent -skew-x-12 animate-shimmer"
                style={{ transform: `translateX(${percent - 100}%)` }}
              ></div>

              {/* Content */}
              <div className="relative p-4 flex items-center justify-between font-mono text-amber-500/90 text-sm">
                <div className="flex items-center gap-3">
                  {/* Spinner */}
                  <svg className="animate-spin h-4 w-4 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="font-bold tracking-wide">
                    LOADING {currentItem.source?.toUpperCase()} MODELS IS RUNNING...
                  </span>
                  <span className="opacity-70 text-xs">
                    ({currentItem.file})
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs opacity-60">WebGPU Detected</span>
                  <span className="font-bold">{percent.toFixed(1)}%</span>
                </div>
              </div>

              {/* Bottom Progress Line */}
              <div className="h-1 w-full bg-amber-900/50">
                <div
                  className="h-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)] transition-all duration-300"
                  style={{ width: `${percent}%` }}
                ></div>
              </div>
            </div>
            <div className="text-center mt-2 text-amber-500/40 text-[10px] uppercase tracking-widest font-mono">
              {loadedMB}MB / {totalMB}MB • keeping browser active
            </div>
          </div>
        );
      })()}

      {/* Header / Top Bar */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5 border-b border-white/5 bg-brand-dark/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Hey Buddy" className="h-10 w-10 object-contain drop-shadow-[0_0_10px_rgba(22,200,206,0.5)]" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Hey Buddy <span className="text-brand-teal text-opacity-80 font-mono text-sm ml-2">v0.2.0-AI</span></h1>
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
                    ACTIVATE SYSTEM
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
            <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-white/10 font-mono text-xs p-2">
              {/* Active Process Indicators */}
              {assistantStatus === 'transcribing' && (() => {
                const sttDownloads = Object.values(progress).filter(p => p.source === 'stt' && p.status !== 'done');
                const isDownloading = sttDownloads.length > 0;
                const percent = isDownloading ? sttDownloads[0].progress : 0;

                return (
                  <div className="flex flex-col gap-1 bg-white/5 p-2 rounded-l border-l-2 border-brand-blue mb-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-brand-blue font-bold">[STT] {isDownloading ? 'Downloading Model...' : 'Transcribing Audio...'}</span>
                      {isDownloading && <span className="text-white/50">{percent.toFixed(0)}%</span>}
                    </div>
                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full ${isDownloading ? 'bg-brand-blue transition-all duration-300' : 'bg-brand-blue animate-indeterminate'}`} style={{ width: isDownloading ? `${percent}%` : '100%' }}></div>
                    </div>
                  </div>
                );
              })()}

              {assistantStatus === 'thinking' && (() => {
                const llmDownloads = Object.values(progress).filter(p => p.source === 'llm' && p.status !== 'done');
                const isDownloading = llmDownloads.length > 0;
                const percent = isDownloading ? llmDownloads[0].progress : 0;

                return (
                  <div className="flex flex-col gap-1 bg-white/5 p-2 rounded-l border-l-2 border-brand-purple mb-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-brand-purple font-bold">[LLM] {isDownloading ? 'Loading Model...' : 'Generating Response...'}</span>
                      {isDownloading && <span className="text-white/50">{percent.toFixed(0)}%</span>}
                    </div>
                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full ${isDownloading ? 'bg-brand-purple transition-all duration-300' : 'bg-brand-purple animate-indeterminate'}`} style={{ width: isDownloading ? `${percent}%` : '100%' }}></div>
                    </div>
                  </div>
                );
              })()}

              {assistantStatus === 'speaking' && (() => {
                const ttsDownloads = Object.values(progress).filter(p => p.source === 'tts' && p.status !== 'done');
                const isDownloading = ttsDownloads.length > 0;
                const percent = isDownloading ? ttsDownloads[0].progress : 0;

                return (
                  <div className="flex flex-col gap-1 bg-white/5 p-2 rounded-l border-l-2 border-brand-green mb-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-brand-green font-bold">[TTS] {isDownloading ? 'Loading Voice...' : 'Synthesizing Speech...'}</span>
                      {isDownloading && <span className="text-white/50">{percent.toFixed(0)}%</span>}
                    </div>
                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full ${isDownloading ? 'bg-brand-green transition-all duration-300' : 'bg-brand-green animate-indeterminate'}`} style={{ width: isDownloading ? `${percent}%` : '100%' }}></div>
                    </div>
                  </div>
                );
              })()}

              <div className="opacity-50">[SYSTEM] Initializing models...</div>
              {isListening && <div className="text-brand-green">[SUCCESS] Audio stream active. Listening for wake words...</div>}
              {isRecording && <div className="text-brand-orange animate-pulse">[EVENT] Wake word detected! Recording audio clip...</div>}

              {/* Historical Logs */}
              {logs.map((log, index) => (
                <div key={index} className="text-white/70 break-all">
                  <span className={`font-bold mr-2 ${log.source === 'stt' ? 'text-brand-blue' :
                    log.source === 'llm' ? 'text-brand-purple' :
                      log.source === 'tts' ? 'text-brand-green' : 'text-white/50'
                    }`}>[{log.source?.toUpperCase()}]</span>
                  <span>{log.message}</span>
                </div>
              ))}

              {/* Current Transcript/Response Context */}
              {transcript && <div className="text-white pl-2 border-l-2 border-white/20 my-1">User: "{transcript}"</div>}
              {response && <div className="text-brand-teal pl-2 border-l-2 border-brand-teal my-1">Assistant: "{response}"</div>}
              {error && <div className="text-red-500">[ERROR] {error}</div>}

              {/* Invisible element to auto-scroll to bottom */}
              <div ref={el => el?.scrollIntoView({ behavior: 'smooth' })} />
            </div>
          </section>
        </div>

        {/* Right Col: Assistant Placeholder / Stats */}
        <div className="flex-1 flex flex-col gap-6 min-w-[300px] max-w-[400px]">

          {/* Assistant Status Card */}
          <div className="glass-panel items-center justify-center flex flex-col gap-4 py-10 relative overflow-hidden border-t border-brand-purple/30">
            <div className={`w-32 h-32 rounded-full border-2 flex items-center justify-center transition-all duration-700 relative
                        ${assistantStatus === 'speaking' ? 'border-brand-green shadow-[0_0_50px_#33e38a] scale-105' :
                assistantStatus === 'thinking' ? 'border-brand-purple shadow-[0_0_40px_#cc33d9] scale-105' :
                  assistantStatus === 'transcribing' ? 'border-brand-blue shadow-[0_0_30px_#0077bb] scale-100' :
                    'border-white/10 grayscale opacity-80'}`}>

              <div className={`absolute inset-0 rounded-full bg-current opacity-10 blur-xl animate-pulse`}></div>
              <img src="/logo.png" className={`w-20 h-20 object-contain transition-transform duration-300 ${assistantStatus !== 'idle' ? 'animate-bounce' : ''}`} />
            </div>

            <div className="text-center z-10">
              <h2 className="text-2xl font-bold tracking-tight">
                {assistantStatus === 'idle' ? 'Ready' :
                  assistantStatus === 'transcribing' ? 'Listening...' :
                    assistantStatus === 'thinking' ? 'Thinking...' :
                      assistantStatus === 'speaking' ? 'Speaking...' : ''}
              </h2>
              <p className="text-white/40 text-sm mt-1 max-w-[200px] mx-auto truncate">
                {transcript || "Waiting for command..."}
              </p>
            </div>
          </div>

          {/* Future Features / Stats */}
          <div className="glass-panel flex-1 flex flex-col gap-4 max-h-[400px]">
            <h3 className="font-mono text-xs text-white/40 uppercase tracking-widest">Pipeline Status</h3>

            {/* Active Downloads List - Scrollable Fixed Height */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar-thin scrollbar-thumb-white/10">
              {Object.keys(progress).length > 0 && Object.entries(progress)
                .sort(([, a], [, b]) => {
                  // Prioritize non-done items first, then by timestamp descending
                  if (a.status !== 'done' && b.status === 'done') return -1;
                  if (a.status === 'done' && b.status !== 'done') return 1;
                  return (b.timestamp || 0) - (a.timestamp || 0);
                })
                .map(([file, data]) => {
                  // Determine if we should show it (optional: filter extremely old done ones?)
                  // For now show all, sorted.

                  return (
                    <div key={file} className={`flex flex-col gap-1 bg-white/5 p-2 rounded border border-white/5 transition-opacity ${data.status === 'done' ? 'opacity-40' : 'opacity-100'}`}>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-white/90 truncate max-w-[150px]" title={file}>{file}</span>
                        <span className="text-white/50 font-mono text-[10px]">{data.source?.toUpperCase() || (data.status === 'done' ? 'DONE' : '...')}</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${data.progress || 0}%` }}
                          className={`h-full rounded-full transition-all duration-300 ${data.source === 'stt' ? 'bg-brand-blue' :
                              data.source === 'llm' ? 'bg-brand-purple' :
                                data.status === 'done' ? 'bg-brand-green/50' : 'bg-brand-green'
                            }`}
                        ></div>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-white/40 font-mono">
                        <span>{data.status}</span>
                        <span>{data.loaded ? (data.loaded / 1024 / 1024).toFixed(1) : 0}MB / {data.total ? (data.total / 1024 / 1024).toFixed(1) : '?'}MB</span>
                      </div>
                    </div>
                  );
                })}
              {Object.keys(progress).length === 0 && (
                <div className="text-xs text-center text-white/20 py-2 italic">Models ready or idle</div>
              )}
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
      {/* Debug / Injection Panel */}
      <div className="absolute bottom-4 right-4 z-50 flex flex-col gap-2">
        <div className="bg-black/80 backdrop-blur text-white p-4 rounded-lg border border-white/10 shadow-xl max-w-sm">
          <h4 className="text-xs font-bold mb-2 text-brand-teal uppercase tracking-wider">Debug: Audio Injection</h4>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const inject = async (file) => {
                  let audioContext = null;
                  try {
                    console.log(`[Debug] Fetching ${file}...`);
                    const response = await fetch(file);
                    const arrayBuffer = await response.arrayBuffer();
                    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    const channelData = audioBuffer.getChannelData(0);
                    console.log(`[Debug] Audio decoded. Sample rate: ${audioBuffer.sampleRate}, Length: ${channelData.length}`);
                    processAudio(channelData);
                  } catch (e) {
                    console.error("Injection failed:", e);
                  } finally {
                    if (audioContext) audioContext.close();
                  }
                };
                inject('/clip.wav');
              }}
              className="px-3 py-1 bg-white/10 hover:bg-brand-blue/50 text-xs rounded transition-colors"
            >
              Inject clip.wav
            </button>
            <button
              onClick={() => {
                const inject = async (file) => {
                  let audioContext = null;
                  try {
                    console.log(`[Debug] Fetching ${file}...`);
                    const response = await fetch(file);
                    const arrayBuffer = await response.arrayBuffer();
                    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    const channelData = audioBuffer.getChannelData(0);
                    console.log(`[Debug] Audio decoded. Sample rate: ${audioBuffer.sampleRate}, Length: ${channelData.length}`);
                    processAudio(channelData);
                  } catch (e) {
                    console.error("Injection failed:", e);
                  } finally {
                    if (audioContext) audioContext.close();
                  }
                };
                inject('/clip (1).wav');
              }}
              className="px-3 py-1 bg-white/10 hover:bg-brand-purple/50 text-xs rounded transition-colors"
            >
              Inject clip (1).wav
            </button>
          </div>
        </div>
      </div>

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
