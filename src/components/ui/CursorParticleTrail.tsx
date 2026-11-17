import React, { useEffect, useRef, useState } from 'react';
import { useVisualPrefs } from '../../lib/theme';

interface TrailParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  life: number;
  maxLife: number;
  rgb: string;
}

const INTERACTIVE_SELECTOR =
  'button, a, [role="button"], input, textarea, select, [data-cursor-interactive="true"]';
const MAX_PARTICLES = 40;

export function CursorParticleTrail() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { themeMeta, effectiveReducedMotion } = useVisualPrefs();
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mqFine = window.matchMedia('(pointer: fine)');

    const checkEligibility = () => {
      setEligible(mqFine.matches && window.innerWidth >= 768 && !effectiveReducedMotion);
    };

    checkEligibility();
    mqFine.addEventListener('change', checkEligibility);
    window.addEventListener('resize', checkEligibility);

    return () => {
      mqFine.removeEventListener('change', checkEligibility);
      window.removeEventListener('resize', checkEligibility);
    };
  }, [effectiveReducedMotion]);

  useEffect(() => {
    if (!eligible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const particles: TrailParticle[] = [];
    let pointerInside = false;
    let isInteractive = false;
    let targetX = -999;
    let targetY = -999;
    let smoothX = -999;
    let smoothY = -999;
    let lastSpawnX = -999;
    let lastSpawnY = -999;
    let hoverBoost = 0;
    let colorIdx = 0;
    let rafId = 0;

    const spawnParticles = (x: number, y: number, dx: number, dy: number, interactive: boolean) => {
      const count = interactive ? 2 : 1;
      for (let i = 0; i < count; i++) {
        if (particles.length >= MAX_PARTICLES) {
          particles.shift();
        }
        const rgb = themeMeta.particleRgb[colorIdx % themeMeta.particleRgb.length];
        colorIdx += 1;

        const jitter = interactive ? 5.5 : 3.5;
        particles.push({
          x: x + (Math.random() - 0.5) * jitter,
          y: y + (Math.random() - 0.5) * jitter,
          vx: dx * 0.04 + (Math.random() - 0.5) * (interactive ? 0.55 : 0.35),
          vy: dy * 0.04 - 0.18 - Math.random() * (interactive ? 0.45 : 0.25),
          radius: interactive ? 1.5 + Math.random() * 1.4 : 1.0 + Math.random() * 1.0,
          alpha: interactive ? 0.34 + Math.random() * 0.22 : 0.2 + Math.random() * 0.16,
          life: 0,
          maxLife: interactive ? 26 + Math.random() * 12 : 20 + Math.random() * 10,
          rgb,
        });
      }
    };

    const startLoop = () => {
      if (!rafId) {
        rafId = requestAnimationFrame(render);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const nextX = e.clientX;
      const nextY = e.clientY;
      const target = e.target instanceof Element ? e.target : null;
      isInteractive = Boolean(target?.closest(INTERACTIVE_SELECTOR));

      if (!pointerInside) {
        pointerInside = true;
        smoothX = nextX;
        smoothY = nextY;
        lastSpawnX = nextX;
        lastSpawnY = nextY;
      }

      targetX = nextX;
      targetY = nextY;

      const dx = nextX - lastSpawnX;
      const dy = nextY - lastSpawnY;
      const dist = Math.hypot(dx, dy);
      const minStep = isInteractive ? 7 : 12;

      if (dist >= minStep) {
        spawnParticles(nextX, nextY, dx, dy, isInteractive);
        lastSpawnX = nextX;
        lastSpawnY = nextY;
      }

      startLoop();
    };

    const handleMouseLeave = () => {
      pointerInside = false;
      isInteractive = false;
      startLoop();
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!pointerInside) return;
      const target = e.target instanceof Element ? e.target : null;
      const interactive = Boolean(target?.closest(INTERACTIVE_SELECTOR));
      if (!interactive) return;

      // Subtle micro-sparkle when clicking an interactive element
      for (let i = 0; i < 4; i++) {
        if (particles.length >= MAX_PARTICLES) particles.shift();
        const angle = (Math.PI * 2 * i) / 4 + Math.random() * 0.5;
        const speed = 0.7 + Math.random() * 0.7;
        particles.push({
          x: e.clientX,
          y: e.clientY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 1.6 + Math.random() * 1.1,
          alpha: 0.48,
          life: 0,
          maxLife: 24,
          rgb: themeMeta.particleRgb[i % themeMeta.particleRgb.length],
        });
      }
      startLoop();
    };

    const render = () => {
      rafId = 0;
      ctx.clearRect(0, 0, width, height);

      const targetBoost = pointerInside && isInteractive ? 1 : 0;
      hoverBoost += (targetBoost - hoverBoost) * 0.16;

      if (pointerInside) {
        smoothX += (targetX - smoothX) * 0.24;
        smoothY += (targetY - smoothY) * 0.24;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        const haloRadius = 26 + hoverBoost * 18;
        const haloAlpha = 0.055 + hoverBoost * 0.075;
        const grad = ctx.createRadialGradient(smoothX, smoothY, 0, smoothX, smoothY, haloRadius);
        grad.addColorStop(0, `rgba(${themeMeta.cursorRgb}, ${haloAlpha.toFixed(3)})`);
        grad.addColorStop(0.5, `rgba(${themeMeta.particleRgb[1]}, ${(haloAlpha * 0.45).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(smoothX, smoothY, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        if (hoverBoost > 0.05) {
          ctx.beginPath();
          ctx.arc(smoothX, smoothY, 1.4 + hoverBoost * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${themeMeta.particleRgb[1]}, ${(0.24 * hoverBoost).toFixed(3)})`;
          ctx.fill();
        }
        ctx.restore();
      }

      if (particles.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.96;
          p.vy *= 0.96;
          p.life += 1;

          const progress = p.life / p.maxLife;
          if (progress >= 1) {
            particles.splice(i, 1);
            continue;
          }

          const currentAlpha = p.alpha * (1 - progress) * (1 - progress * 0.4);
          const currentRadius = p.radius * (1 - progress * 0.35);

          const glowRadius = currentRadius * (3.6 + hoverBoost * 1.1);
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius);
          halo.addColorStop(0, `rgba(${p.rgb}, ${currentAlpha.toFixed(3)})`);
          halo.addColorStop(0.55, `rgba(${p.rgb}, ${(currentAlpha * 0.32).toFixed(3)})`);
          halo.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${(currentAlpha * 0.65).toFixed(3)})`;
          ctx.fill();
        }

        ctx.restore();
      }

      // Keep animating while pointer is active, particles remain, or hover boost is settling
      if (pointerInside || particles.length > 0 || hoverBoost > 0.01) {
        rafId = requestAnimationFrame(render);
      }
    };

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('mousedown', handleMouseDown, { passive: true });

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('mousedown', handleMouseDown);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [eligible, themeMeta]);

  if (!eligible) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-[45]"
    />
  );
}
