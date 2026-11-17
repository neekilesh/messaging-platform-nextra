import React, { useEffect, useRef } from 'react';
import { useVisualPrefs } from '../../lib/theme';

interface StarParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  twinklePhase: number;
  hueIndex: 0 | 1 | 2;
  glow: boolean;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  life: number;
  maxLife: number;
}

export function CosmicBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { themeMeta, effectiveReducedMotion } = useVisualPrefs();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isMobile = window.innerWidth < 768;
    const isFinePointer = window.matchMedia('(pointer: fine)').matches;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const targetCount = isMobile
      ? Math.min(20, Math.max(12, Math.floor((width * height) / 42000)))
      : Math.min(44, Math.max(22, Math.floor((width * height) / 34000)));

    const stars: StarParticle[] = Array.from({ length: targetCount }, (_, idx) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
      radius: idx % 5 === 0 ? Math.random() * 1.6 + 1.1 : Math.random() * 1.1 + 0.5,
      alpha: Math.random() * 0.45 + 0.16,
      twinklePhase: Math.random() * Math.PI * 2,
      hueIndex: (idx % 3) as 0 | 1 | 2,
      glow: idx % 5 === 0,
    }));

    const shootingStars: ShootingStar[] = [];
    let nextMeteorAt = performance.now() + 4500 + Math.random() * 5000;

    // Interactive desktop mouse light tracking
    let mouseX = -9999;
    let mouseY = -9999;
    let smoothX = -9999;
    let smoothY = -9999;
    let mouseActive = false;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isFinePointer || effectiveReducedMotion) return;
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!mouseActive) {
        smoothX = mouseX;
        smoothY = mouseY;
        mouseActive = true;
      }
    };

    const handleMouseLeave = () => {
      mouseActive = false;
    };

    if (isFinePointer && !effectiveReducedMotion) {
      window.addEventListener('mousemove', handleMouseMove, { passive: true });
      window.addEventListener('mouseleave', handleMouseLeave);
    }

    let rafId = 0;
    const render = (now: number) => {
      ctx.clearRect(0, 0, width, height);

      // Subtle desktop mouse nebula glow
      if (mouseActive && !effectiveReducedMotion && isFinePointer) {
        smoothX += (mouseX - smoothX) * 0.08;
        smoothY += (mouseY - smoothY) * 0.08;
        const grad = ctx.createRadialGradient(smoothX, smoothY, 0, smoothX, smoothY, 210);
        grad.addColorStop(0, `rgba(${themeMeta.cursorRgb}, 0.085)`);
        grad.addColorStop(0.55, `rgba(${themeMeta.cursorRgb}, 0.03)`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // Stars and floating glowing particles
      for (const s of stars) {
        if (!effectiveReducedMotion) {
          s.x += s.vx;
          s.y += s.vy;
          s.twinklePhase += 0.018;
          if (s.x < 0) s.x = width;
          if (s.x > width) s.x = 0;
          if (s.y < 0) s.y = height;
          if (s.y > height) s.y = 0;
        }

        const twinkle = effectiveReducedMotion ? 1 : 0.75 + 0.25 * Math.sin(s.twinklePhase);
        const colorRgb = themeMeta.particleRgb[s.hueIndex];

        if (s.glow && !effectiveReducedMotion) {
          const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius * 5);
          halo.addColorStop(0, `rgba(${colorRgb}, ${(s.alpha * twinkle * 0.45).toFixed(3)})`);
          halo.addColorStop(1, `rgba(${colorRgb}, 0)`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius * 5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colorRgb}, ${(s.alpha * twinkle).toFixed(3)})`;
        ctx.fill();
      }

      // Occasional shooting stars (desktop & non-reduced motion only)
      if (!effectiveReducedMotion && !isMobile) {
        if (now > nextMeteorAt && shootingStars.length < 2) {
          const startX = Math.random() * width * 0.8 + width * 0.1;
          const startY = Math.random() * height * 0.35;
          shootingStars.push({
            x: startX,
            y: startY,
            vx: (Math.random() > 0.35 ? 1 : -1) * (5.5 + Math.random() * 2.5),
            vy: 2.8 + Math.random() * 1.8,
            length: 70 + Math.random() * 55,
            life: 0,
            maxLife: 42 + Math.random() * 18,
          });
          nextMeteorAt = now + 7000 + Math.random() * 9000;
        }

        for (let i = shootingStars.length - 1; i >= 0; i--) {
          const m = shootingStars[i];
          m.x += m.vx;
          m.y += m.vy;
          m.life += 1;

          const progress = m.life / m.maxLife;
          const opacity = Math.sin(progress * Math.PI) * 0.65;
          if (opacity > 0.01) {
            const norm = Math.hypot(m.vx, m.vy) || 1;
            const tailX = m.x - (m.vx / norm) * m.length;
            const tailY = m.y - (m.vy / norm) * m.length;
            const trail = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
            trail.addColorStop(0, `rgba(255, 255, 255, ${opacity.toFixed(3)})`);
            trail.addColorStop(0.4, `rgba(${themeMeta.particleRgb[1]}, ${(opacity * 0.6).toFixed(3)})`);
            trail.addColorStop(1, 'rgba(0, 0, 0, 0)');

            ctx.strokeStyle = trail;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(tailX, tailY);
            ctx.stroke();
          }

          if (m.life >= m.maxLife) {
            shootingStars.splice(i, 1);
          }
        }
      }

      if (!effectiveReducedMotion) {
        rafId = requestAnimationFrame(render);
      }
    };

    rafId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [themeMeta, effectiveReducedMotion]);

  return (
    <div aria-hidden="true" className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Subtle drifting nebula / aurora layers */}
      {!effectiveReducedMotion && (
        <>
          <div
            className="nexora-nebula-blob absolute -top-28 -left-24 w-[420px] h-[420px] rounded-full blur-3xl opacity-35"
            style={{
              background: `radial-gradient(circle, rgba(${themeMeta.particleRgb[0]}, 0.24), transparent 70%)`,
            }}
          />
          <div
            className="nexora-nebula-blob absolute -bottom-32 -right-24 w-[460px] h-[460px] rounded-full blur-3xl opacity-30"
            style={{
              animationDelay: '-7s',
              background: `radial-gradient(circle, rgba(${themeMeta.particleRgb[1]}, 0.20), transparent 70%)`,
            }}
          />
        </>
      )}
      <canvas ref={canvasRef} className="w-full h-full opacity-85" />
    </div>
  );
}
