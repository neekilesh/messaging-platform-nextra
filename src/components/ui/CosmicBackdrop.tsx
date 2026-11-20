import React from 'react';
import { useVisualPrefs } from '../../lib/theme';

export function CosmicBackdrop() {
  const { themeMeta, effectiveReducedMotion, isDark } = useVisualPrefs();

  return (
    <div aria-hidden="true" className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Static, soft ambient colour illumination layered behind Liquid Glass */}
      <div
        className={`absolute -top-36 -left-28 w-[480px] h-[480px] rounded-full transition-opacity duration-500 ${
          isDark ? 'opacity-28' : 'opacity-55'
        }`}
        style={{
          filter: effectiveReducedMotion ? 'blur(56px)' : 'blur(88px)',
          background: `radial-gradient(circle, rgba(${themeMeta.particleRgb[0]}, ${
            isDark ? 0.34 : 0.6
          }), transparent 72%)`,
        }}
      />
      <div
        className={`absolute top-1/4 -right-32 w-[440px] h-[440px] rounded-full transition-opacity duration-500 ${
          isDark ? 'opacity-22' : 'opacity-50'
        }`}
        style={{
          filter: effectiveReducedMotion ? 'blur(56px)' : 'blur(92px)',
          background: `radial-gradient(circle, rgba(${themeMeta.particleRgb[2]}, ${
            isDark ? 0.28 : 0.52
          }), transparent 72%)`,
        }}
      />
      <div
        className={`absolute -bottom-40 left-1/3 w-[460px] h-[460px] rounded-full transition-opacity duration-500 ${
          isDark ? 'opacity-18' : 'opacity-45'
        }`}
        style={{
          filter: effectiveReducedMotion ? 'blur(56px)' : 'blur(96px)',
          background: `radial-gradient(circle, rgba(${themeMeta.particleRgb[1]}, ${
            isDark ? 0.24 : 0.48
          }), transparent 74%)`,
        }}
      />
    </div>
  );
}

export function GradientBackground({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`nexora-cosmos relative ${className}`}>
      <CosmicBackdrop />
      <div className="relative z-10 w-full h-full flex flex-col md:flex-row">{children}</div>
    </div>
  );
}
