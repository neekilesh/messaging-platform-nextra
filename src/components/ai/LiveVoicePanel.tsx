import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, Send, Sparkles, Volume2 } from 'lucide-react';
import { apiUrl, getStoredToken } from '../../lib/api';

type VoiceName = 'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';

interface TranscriptEntry {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: string;
}

const VOICE_OPTIONS: Array<{ id: VoiceName; tone: string }> = [
  { id: 'Zephyr', tone: 'Bright & clear' },
  { id: 'Kore', tone: 'Warm & calm' },
  { id: 'Puck', tone: 'Upbeat & crisp' },
  { id: 'Charon', tone: 'Deep & steady' },
  { id: 'Fenrir', tone: 'Bold & resonant' },
];

function float32ToInt16Base64(float32: Float32Array): { base64: string; rms: number } {
  const int16 = new Int16Array(float32.length);
  let sumSq = 0;
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    sumSq += s * s;
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return {
    base64: btoa(binary),
    rms: Math.sqrt(sumSq / Math.max(1, float32.length)),
  };
}

function base64Int16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export function LiveVoicePanel() {
  const [voice, setVoice] = useState<VoiceName>('Zephyr');
  const [instruction, setInstruction] = useState(
    'You are NEXORA Live, a friendly, concise real-time voice companion. Keep responses natural and conversational.'
  );
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const appendTranscript = useCallback((role: 'user' | 'model' | 'system', text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && role !== 'system') {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: `${last.text} ${clean}`.replace(/\s+/g, ' ').trim(),
        };
        return updated;
      }
      return [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role,
          text: clean,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ];
    });
  }, []);

  const stopPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore stopped source
      }
    }
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  }, []);

  const playPcm24k = useCallback((base64Audio: string) => {
    let outCtx = outputCtxRef.current;
    if (!outCtx || outCtx.state === 'closed') {
      outCtx = new AudioContext({ sampleRate: 24000 });
      outputCtxRef.current = outCtx;
      nextStartTimeRef.current = outCtx.currentTime;
    }
    if (outCtx.state === 'suspended') {
      outCtx.resume().catch(() => {});
    }

    const float32 = base64Int16ToFloat32(base64Audio);
    const audioBuffer = outCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32 as unknown as Float32Array<ArrayBuffer>, 0);

    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);

    const startTime = Math.max(outCtx.currentTime, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + audioBuffer.duration;
    activeSourcesRef.current.push(source);

    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
    };
  }, []);

  const disconnectSession = useCallback(() => {
    stopPlayback();
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (inputCtxRef.current && inputCtxRef.current.state !== 'closed') {
      inputCtxRef.current.close().catch(() => {});
    }
    inputCtxRef.current = null;
    if (outputCtxRef.current && outputCtxRef.current.state !== 'closed') {
      outputCtxRef.current.close().catch(() => {});
    }
    outputCtxRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setMicLevel(0);
    setStatus('idle');
  }, [stopPlayback]);

  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  const startSession = async () => {
    disconnectSession();
    setErrorMsg(null);
    setStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;
      const outCtx = new AudioContext({ sampleRate: 24000 });
      outputCtxRef.current = outCtx;
      nextStartTimeRef.current = outCtx.currentTime;

      const token = getStoredToken() || '';
      const resolvedHttp = apiUrl('/ws/live');
      let wsUrl: string;
      if (resolvedHttp.startsWith('http://') || resolvedHttp.startsWith('https://')) {
        wsUrl = resolvedHttp.replace(/^http/, 'ws');
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${proto}//${window.location.host}${resolvedHttp}`;
      }
      const params = new URLSearchParams({
        token,
        voice,
        instruction,
      });

      const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            audio?: string;
            text?: string;
            error?: string;
            voiceName?: string;
          };
          if (msg.type === 'ready') {
            setStatus('connected');
            appendTranscript('system', `Connected to Gemini Live (${msg.voiceName || voice})`);
          } else if (msg.type === 'audio' && msg.audio) {
            playPcm24k(msg.audio);
          } else if (msg.type === 'inputTranscript' && msg.text) {
            appendTranscript('user', msg.text);
          } else if (msg.type === 'outputTranscript' && msg.text) {
            appendTranscript('model', msg.text);
          } else if (msg.type === 'interrupted') {
            stopPlayback();
          } else if (msg.type === 'error') {
            setErrorMsg(msg.error || 'Voice session error.');
            setStatus('error');
          } else if (msg.type === 'closed') {
            setStatus('idle');
          }
        } catch {
          // ignore malformed payload
        }
      };

      ws.onerror = () => {
        setErrorMsg('WebSocket connection failed. Verify server and API key configuration.');
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
      };

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        if (mutedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          setMicLevel(0);
          return;
        }
        const pcm = ev.inputBuffer.getChannelData(0);
        const { base64, rms } = float32ToInt16Base64(pcm);
        setMicLevel(Math.min(1, rms * 6));
        wsRef.current.send(JSON.stringify({ audio: base64 }));
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);
    } catch (err) {
      disconnectSession();
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Microphone access denied or unavailable.'
      );
      setStatus('error');
    }
  };

  const sendLiveText = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: clean }));
    appendTranscript('user', clean);
    setTextInput('');
  };

  const activeBars = 12;

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 md:p-6 gap-5 overflow-y-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 min-h-0">
        {/* Left Voice Controls */}
        <div className="nexora-surface rounded-2xl p-5 flex flex-col gap-4 border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-display font-semibold text-white flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-cyan-400" />
                Live Voice Session
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Bidirectional real-time audio via <span className="font-mono-tabular text-cyan-300">gemini-3.8-live</span>
              </p>
            </div>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${
                status === 'connected'
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : status === 'connecting'
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    : status === 'error'
                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                      : 'border-white/10 bg-white/5 text-slate-400'
              }`}
            >
              {status === 'connected'
                ? 'Live Audio'
                : status === 'connecting'
                  ? 'Connecting...'
                  : status === 'error'
                    ? 'Disconnected'
                    : 'Standby'}
            </span>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300 block">Voice Persona</label>
            <div className="grid grid-cols-1 gap-1.5">
              {VOICE_OPTIONS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={status === 'connected' || status === 'connecting'}
                  onClick={() => setVoice(v.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl border text-left text-xs transition-colors cursor-pointer disabled:opacity-60 ${
                    voice === v.id
                      ? 'border-cyan-400/50 bg-cyan-500/15 text-white'
                      : 'border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <span className="font-medium">{v.id}</span>
                  <span className="text-slate-400">{v.tone}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">System Instruction</label>
            <textarea
              rows={3}
              disabled={status === 'connected' || status === 'connecting'}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              className="w-full rounded-xl bg-[#090d1c] border border-white/10 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-400/60 disabled:opacity-60"
            />
          </div>

          {/* Live Mic Meter */}
          <div className="rounded-xl bg-[#090d1c] border border-white/10 p-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-400">Input Level</span>
            <div className="flex items-end gap-1 h-5">
              {Array.from({ length: activeBars }).map((_, idx) => {
                const threshold = (idx + 1) / activeBars;
                const lit = status === 'connected' && !muted && micLevel >= threshold * 0.7;
                return (
                  <span
                    key={idx}
                    className={`w-1.5 rounded-sm transition-all duration-75 ${
                      lit ? 'bg-cyan-400 h-5' : 'bg-white/10 h-2'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}

          <div className="mt-auto flex items-center gap-2.5 pt-2">
            {status === 'connected' || status === 'connecting' ? (
              <>
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  className={`flex-1 h-10 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                    muted
                      ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                      : 'border-white/15 bg-white/5 text-white hover:bg-white/10'
                  }`}
                >
                  {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  {muted ? 'Unmute Mic' : 'Mute Mic'}
                </button>
                <button
                  type="button"
                  onClick={disconnectSession}
                  className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <PhoneOff className="w-4 h-4" />
                  End Call
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startSession}
                className="w-full h-10 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_20px_rgba(34,211,238,0.28)] transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                Start Live Voice Call
              </button>
            )}
          </div>
        </div>

        {/* Live Transcript Feed */}
        <div className="lg:col-span-2 nexora-surface rounded-2xl border border-white/10 flex flex-col min-h-[380px]">
          <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-medium text-white">Real-Time Transcript</h3>
            </div>
            {transcripts.length > 0 && (
              <button
                type="button"
                onClick={() => setTranscripts([])}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {transcripts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-12">
                <Volume2 className="w-9 h-9 text-cyan-400/70 mb-3" />
                <p className="text-sm font-medium text-slate-200">
                  Ready for natural voice conversation
                </p>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Click Start Live Voice Call and speak naturally. You can interrupt Gemini anytime mid-sentence, or type a prompt below to steer the conversation.
                </p>
              </div>
            ) : (
              transcripts.map((item) => (
                <div
                  key={item.id}
                  className={`flex ${
                    item.role === 'user'
                      ? 'justify-end'
                      : item.role === 'system'
                        ? 'justify-center'
                        : 'justify-start'
                  }`}
                >
                  {item.role === 'system' ? (
                    <span className="text-[11px] text-slate-400 bg-white/5 border border-white/10 px-3 py-1 rounded-md">
                      {item.text}
                    </span>
                  ) : (
                    <div
                      className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        item.role === 'user'
                          ? 'bg-violet-600/25 border border-violet-500/40 text-white'
                          : 'bg-[#090d1c] border border-white/10 text-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <span className="text-[11px] font-medium text-cyan-300">
                          {item.role === 'user' ? 'You' : `Gemini (${voice})`}
                        </span>
                        <span className="text-[10px] font-mono-tabular text-slate-500">
                          {item.timestamp}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{item.text}</p>
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={scrollEndRef} />
          </div>

          <form
            onSubmit={sendLiveText}
            className="p-3.5 border-t border-white/10 flex items-center gap-2.5"
          >
            <input
              type="text"
              value={textInput}
              disabled={status !== 'connected'}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={
                status === 'connected'
                  ? 'Send a text hint into the live voice session...'
                  : 'Connect voice session to send live cues...'
              }
              className="flex-1 h-10 rounded-xl bg-[#090d1c] border border-white/10 px-3.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={status !== 'connected' || !textInput.trim()}
              className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
