import React, { useEffect, useRef } from 'react';

interface CanvasWaveformProps {
  waveform: number[];
  progress: number; // 0 to 1
  isMine?: boolean;
  onSeek?: (ratio: number) => void;
}

export function CanvasWaveform({ waveform, progress, isMine, onSeek }: CanvasWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 220;
    const height = canvas.clientHeight || 36;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const bars = waveform && waveform.length > 0 ? waveform : Array(28).fill(0.35);
    const barWidth = width / bars.length;
    const gap = 2;
    const effectiveBarWidth = Math.max(2, barWidth - gap);

    bars.forEach((val, i) => {
      const x = i * barWidth;
      const barHeight = Math.max(4, Math.round(val * (height - 4)));
      const y = (height - barHeight) / 2;

      const ratio = (i + 0.5) / bars.length;
      const isPlayed = ratio <= progress;

      if (isPlayed) {
        ctx.fillStyle = isMine ? '#22d3ee' : '#7c5cf6';
      } else {
        ctx.fillStyle = isMine ? 'rgba(255, 255, 255, 0.4)' : 'rgba(124, 92, 246, 0.25)';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, effectiveBarWidth, barHeight, [4]);
      ctx.fill();
    });
  }, [waveform, progress, isMine]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, clickX / rect.width));
    onSeek(ratio);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      aria-label="Audio waveform graphic"
      className="w-full h-9 cursor-pointer touch-none block"
      style={{ width: '100%', height: '36px' }}
    />
  );
}
