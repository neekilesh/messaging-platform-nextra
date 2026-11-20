import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, Send, Trash2 } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { useVisualPrefs } from '../../lib/theme';

interface VoiceRecorderProps {
  onSendVoice: (blob: Blob, durationMs: number, waveform: number[]) => Promise<void>;
  disabled?: boolean;
}

export function VoiceRecorder({ onSendVoice, disabled }: VoiceRecorderProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  const [recording, setRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(24).fill(0.15));
  const [dragCancel, setDragCancel] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const waveformSamplesRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  const cancelFlagRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, []);

  const cleanupMedia = () => {
    audioManager.setVoiceRecordingActive(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
  };

  const startRecording = async (clientX?: number) => {
    if (disabled || recording) return;
    setErrorMsg(null);
    cancelFlagRef.current = false;
    setDragCancel(false);
    startXRef.current = clientX ?? 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      waveformSamplesRef.current = [];
      startTimeRef.current = Date.now();
      setDurationMs(0);

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i];
        const level = Math.min(1, Math.max(0.12, sum / (freqData.length * 160)));
        waveformSamplesRef.current.push(Number(level.toFixed(2)));
        setBars((prev) => [...prev.slice(1), level]);
        setDurationMs(Date.now() - startTimeRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        const elapsed = Date.now() - startTimeRef.current;
        const shouldCancel = cancelFlagRef.current || elapsed < 400;
        const samples = downsampleWaveform(waveformSamplesRef.current, 28);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        cleanupMedia();
        setRecording(false);
        setBars(Array(24).fill(0.15));

        if (!shouldCancel && blob.size > 0) {
          audioManager.play('voice.send');
          await onSendVoice(blob, elapsed, samples);
          setJustSent(true);
          window.setTimeout(() => setJustSent(false), 900);
        }
      };

      // Suppress ambient UI/notification audio while user records microphone voice message
      audioManager.setVoiceRecordingActive(true);
      recorder.start(100);
      setRecording(true);
      audioManager.play('voice.record_start');
    } catch {
      cleanupMedia();
      setErrorMsg('Microphone permission required for voice messages.');
      audioManager.play('message.failed');
    }
  };

  const stopAndSend = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;
    cancelFlagRef.current = false;
    audioManager.play('voice.record_stop');
    mediaRecorderRef.current.stop();
  };

  const cancelRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      cleanupMedia();
      setRecording(false);
      return;
    }
    cancelFlagRef.current = true;
    audioManager.play('voice.delete');
    mediaRecorderRef.current.stop();
  };

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  if (recording) {
    return (
      <motion.div
        initial={effectiveReducedMotion ? false : { opacity: 0.7, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        onPointerMove={(e) => {
          if (startXRef.current && startXRef.current - e.clientX > 70) {
            setDragCancel(true);
          }
        }}
        onPointerUp={() => {
          if (dragCancel) cancelRecording();
        }}
        className="flex items-center gap-3 flex-1 nexora-glass border border-violet-400/50 rounded-full px-3 py-1.5"
      >
        <button
          type="button"
          onClick={cancelRecording}
          aria-label="Cancel voice recording"
          className="p-2 text-rose-500 dark:text-rose-300 hover:bg-rose-500/15 rounded-full transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        <div className="relative flex items-center gap-2">
          <span className="relative flex items-center justify-center w-6 h-6">
            {!effectiveReducedMotion && (
              <motion.span
                animate={{ scale: [1, 1.55, 1], opacity: [0.65, 0, 0.65] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-0 rounded-full bg-sky-400/35"
              />
            )}
            <Mic className="w-3.5 h-3.5 text-sky-600 dark:text-cyan-300 relative z-10" />
          </span>
          <span className="font-mono-tabular text-xs text-sky-700 dark:text-cyan-300 min-w-[38px]">
            {formatDuration(durationMs)}
          </span>
        </div>

        <div className="flex items-center gap-0.5 flex-1 h-7 overflow-hidden">
          {bars.map((val, idx) => (
            <div
              key={idx}
              className="flex-1 bg-gradient-to-t from-violet-500 via-indigo-400 to-cyan-400 rounded-full transition-all duration-75"
              style={{ height: `${Math.round(val * 100)}%`, minHeight: '4px' }}
            />
          ))}
        </div>

        <span className="text-[11px] text-[var(--nx-text-secondary)] hidden sm:inline">
          {dragCancel ? 'Release to cancel' : 'Slide left or tap trash to cancel'}
        </span>

        <motion.button
          type="button"
          whileHover={effectiveReducedMotion ? undefined : { scale: 1.04 }}
          whileTap={effectiveReducedMotion ? undefined : { scale: 0.95 }}
          onClick={stopAndSend}
          aria-label="Send voice message"
          className="relative h-9 px-3.5 rounded-full bg-gradient-to-br from-[#7c5cf6] to-[#566ee6] text-white text-xs font-medium inline-flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </motion.button>
      </motion.div>
    );
  }

  return (
    <div className="relative flex items-center">
      {errorMsg && (
        <div className="absolute bottom-12 right-0 w-56 rounded-xl nexora-glass-elevated border border-rose-500/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-200 z-30">
          {errorMsg}
        </div>
      )}
      {justSent && !effectiveReducedMotion && (
        <motion.span
          initial={{ scale: 0.6, opacity: 0.85 }}
          animate={{ scale: 2.1, opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full border border-sky-400"
        />
      )}
      <motion.button
        type="button"
        disabled={disabled}
        data-sound-custom="true"
        whileHover={effectiveReducedMotion ? undefined : { scale: 1.04 }}
        whileTap={effectiveReducedMotion ? undefined : { scale: 0.93 }}
        onClick={(e) => startRecording(e.clientX)}
        title="Record voice message"
        aria-label="Record voice message"
        className="min-h-[40px] min-w-[40px] rounded-full bg-white/60 hover:bg-violet-500/20 dark:bg-white/[0.08] dark:hover:bg-violet-500/25 border border-white/75 dark:border-white/[0.14] text-[var(--nx-text-primary)] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40"
      >
        <Mic className="w-[18px] h-[18px]" />
      </motion.button>
    </div>
  );
}

function downsampleWaveform(samples: number[], targetLen: number): number[] {
  if (samples.length === 0) return Array(targetLen).fill(0.25);
  if (samples.length <= targetLen) {
    return [...samples, ...Array(targetLen - samples.length).fill(0.2)];
  }
  const out: number[] = [];
  const step = samples.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(samples.length, Math.floor((i + 1) * step));
    let avg = 0;
    for (let j = start; j < end; j++) avg += samples[j];
    out.push(Number((avg / Math.max(1, end - start)).toFixed(2)));
  }
  return out;
}
