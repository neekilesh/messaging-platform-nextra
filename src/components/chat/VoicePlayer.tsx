import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Pause, Play } from 'lucide-react';
import { playSound } from '../../lib/sound';
import { useVisualPrefs } from '../../lib/theme';

interface VoicePlayerProps {
  audioUrl: string;
  durationMs?: number | null;
  waveform?: number[] | null;
  isMine?: boolean;
}

const SPEEDS = [1, 1.5, 2] as const;

export function VoicePlayer({ audioUrl, durationMs, waveform, isMine }: VoicePlayerProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec, setTotalSec] = useState(durationMs ? Math.round(durationMs / 1000) : 0);
  const [speedIdx, setSpeedIdx] = useState(0);

  const bars = waveform && waveform.length > 0 ? waveform : Array(24).fill(0.35);

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setTotalSec(Math.round(audio.duration));
      }
    };
    audio.ontimeupdate = () => {
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (durationMs || 1000) / 1000;
      setCurrentSec(Math.floor(audio.currentTime));
      setProgress(Math.min(1, audio.currentTime / Math.max(0.1, dur)));
    };
    audio.onended = () => {
      setPlaying(false);
      setProgress(0);
      setCurrentSec(0);
    };

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audioUrl, durationMs]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      playSound('voice.play_start');
      audio.playbackRate = SPEEDS[speedIdx];
      await audio.play();
      setPlaying(true);
    }
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEEDS[next];
    }
  };

  const seekToBar = (index: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (durationMs || 1000) / 1000;
    const ratio = (index + 0.5) / bars.length;
    audio.currentTime = ratio * dur;
    setProgress(ratio);
  };

  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-3 min-w-[220px] sm:min-w-[260px]">
      <div className="relative shrink-0">
        {playing && !effectiveReducedMotion && (
          <motion.span
            animate={{ scale: [1, 1.38, 1], opacity: [0.55, 0, 0.55] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden="true"
            className={`absolute inset-0 rounded-full ${
              isMine ? 'bg-cyan-300/35' : 'bg-violet-400/35'
            }`}
          />
        )}
        <motion.button
          type="button"
          data-sound-custom="true"
          whileTap={effectiveReducedMotion ? undefined : { scale: 0.92 }}
          onClick={togglePlay}
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
          className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            isMine
              ? 'bg-white/20 hover:bg-white/30 text-white'
              : 'bg-violet-600/35 hover:bg-violet-600/55 text-cyan-200'
          }`}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </motion.button>
      </div>

      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-0.5 h-6">
          {bars.map((val, idx) => {
            const active = idx / bars.length <= progress;
            return (
              <motion.button
                key={idx}
                type="button"
                animate={
                  playing && active && !effectiveReducedMotion
                    ? { scaleY: [1, 1.18, 0.92, 1] }
                    : { scaleY: 1 }
                }
                transition={
                  playing && active && !effectiveReducedMotion
                    ? { duration: 0.55, repeat: Infinity, delay: (idx % 4) * 0.08 }
                    : { duration: 0.15 }
                }
                onClick={() => seekToBar(idx)}
                aria-label={`Seek audio to ${Math.round((idx / bars.length) * 100)}%`}
                className={`flex-1 rounded-full transition-colors duration-150 cursor-pointer ${
                  active
                    ? isMine
                      ? 'bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.6)]'
                      : 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.55)]'
                    : isMine
                    ? 'bg-white/30'
                    : 'bg-slate-600/70'
                }`}
                style={{ height: `${Math.max(22, Math.round(val * 100))}%` }}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono-tabular opacity-80">
          <span>{playing ? fmt(currentSec) : fmt(totalSec)}</span>
          <button
            type="button"
            onClick={cycleSpeed}
            className="hover:underline cursor-pointer"
          >
            {SPEEDS[speedIdx]}x
          </button>
        </div>
      </div>
    </div>
  );
}
