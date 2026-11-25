import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Pause, Play } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { useVisualPrefs } from '../../lib/theme';
import { analyzeAudioBlobToWaveform, analyzeAudioUrlToWaveform } from '../../lib/waveform';
import { CanvasWaveform } from './CanvasWaveform';

interface VoicePlayerProps {
  audioUrl: string;
  audioBlob?: Blob | null;
  durationMs?: number | null;
  waveform?: number[] | null;
  isMine?: boolean;
  isLightBubble?: boolean;
}

const SPEEDS = [1, 1.5, 2] as const;

export function VoicePlayer({
  audioUrl,
  audioBlob,
  durationMs,
  waveform,
  isMine,
  isLightBubble = false,
}: VoicePlayerProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec, setTotalSec] = useState(durationMs ? Math.round(durationMs / 1000) : 0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [resolvedWaveform, setResolvedWaveform] = useState<number[]>(
    waveform && waveform.length > 0 ? waveform : Array(32).fill(0.28)
  );

  useEffect(() => {
    const hasCustomWaveform =
      Boolean(waveform && waveform.length > 0) &&
      !waveform!.every((v) => Math.abs(v - waveform![0]) < 0.01);
    if (hasCustomWaveform && waveform) {
      setResolvedWaveform(waveform);
      return;
    }

    let active = true;
    const decodePromise = audioBlob
      ? analyzeAudioBlobToWaveform(audioBlob, 32)
      : analyzeAudioUrlToWaveform(audioUrl, 32);

    decodePromise.then((analyzed) => {
      if (active && analyzed && analyzed.length > 0) {
        setResolvedWaveform(analyzed);
      }
    });
    return () => {
      active = false;
    };
  }, [audioUrl, audioBlob, waveform]);

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
      audioManager.play('voice.play_end');
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
      audioManager.play('voice.play_start');
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

  const seekToRatio = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (durationMs || 1000) / 1000;
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
              ? isLightBubble
                ? 'bg-slate-900/12 hover:bg-slate-900/20 text-slate-900'
                : 'bg-white/25 hover:bg-white/35 text-white'
              : 'bg-violet-600/20 hover:bg-violet-600/35 dark:bg-violet-600/35 dark:hover:bg-violet-600/55 text-violet-700 dark:text-cyan-200'
          }`}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </motion.button>
      </div>

      <div className="flex-1 space-y-1">
        <CanvasWaveform
          waveform={resolvedWaveform}
          progress={progress}
          isMine={isMine}
          isLightBubble={isLightBubble}
          onSeek={seekToRatio}
        />
        <div className="flex items-center justify-between text-[11px] font-mono-tabular opacity-85">
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
