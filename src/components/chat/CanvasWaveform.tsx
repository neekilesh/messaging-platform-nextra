import React, { useEffect, useRef, useState } from 'react';

interface CanvasWaveformProps {
  waveform: number[];
  progress: number; // 0 to 1
  isMine?: boolean;
  isLightBubble?: boolean;
  onSeek?: (ratio: number) => void;
  className?: string;
}

export function CanvasWaveform({
  waveform,
  progress,
  isMine,
  isLightBubble = false,
  onSeek,
  className = '',
}: CanvasWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) setCanvasWidth(w);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvasWidth || 220;
    const height = canvas.clientHeight || 36;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    const bars = waveform && waveform.length > 0 ? waveform : Array(28).fill(0.35);
    const barWidth = width / bars.length;
    const gap = Math.min(2.5, barWidth * 0.3);
    const effectiveBarWidth = Math.max(2, barWidth - gap);

    bars.forEach((rawVal, i) => {
      const val = Math.min(1, Math.max(0.08, Number.isFinite(rawVal) ? rawVal : 0.2));
      const x = i * barWidth;
      const barHeight = Math.max(4, Math.round(val * (height - 4)));
      const y = (height - barHeight) / 2;

      const ratio = (i + 0.5) / bars.length;
      const isPlayed = progress > 0 && ratio <= progress;

      if (isPlayed) {
        ctx.fillStyle = isMine ? (isLightBubble ? '#3730a3' : '#22d3ee') : '#7c5cf6';
      } else {
        ctx.fillStyle = isMine
          ? isLightBubble
            ? 'rgba(15, 23, 42, 0.26)'
            : 'rgba(255, 255, 255, 0.44)'
          : 'rgba(124, 92, 246, 0.32)';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, effectiveBarWidth, barHeight, [4]);
      ctx.fill();
    });
  }, [waveform, progress, isMine, isLightBubble, canvasWidth]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = e.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, clickX / rect.width));
    onSeek(ratio);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      aria-label="Audio waveform graphic"
      className={`w-full h-9 block touch-none ${onSeek ? 'cursor-pointer' : ''} ${className}`}
      style={{ width: '100%', height: '36px' }}
    />
  );
}
