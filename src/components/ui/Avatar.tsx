import React from 'react';
import { motion } from 'motion/react';
import { useVisualPrefs } from '../../lib/theme';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
  isGroup?: boolean;
  cosmicRing?: boolean;
}

const SIZE_MAP = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
};

export function Avatar({ src, name, size = 'md', isOnline, isGroup, cosmicRing }: AvatarProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || 'N';

  const showRing = (cosmicRing || isOnline) && !effectiveReducedMotion;

  return (
    <div className={`relative shrink-0 ${SIZE_MAP[size]}`}>
      {showRing && (
        <motion.span
          aria-hidden="true"
          animate={{ rotate: 360 }}
          transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
          className="pointer-events-none absolute -inset-[2px] rounded-full bg-[conic-gradient(from_0deg,rgba(139,92,246,0.65),rgba(34,211,238,0.6),rgba(99,102,241,0.2),rgba(139,92,246,0.65))] opacity-80"
        />
      )}
      {src ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          className="relative w-full h-full rounded-full object-cover border border-white/15 bg-[#0b0f1e]"
        />
      ) : (
        <div
          className={`relative w-full h-full rounded-full flex items-center justify-center font-display font-semibold text-white border border-white/15 ${
            isGroup
              ? 'bg-gradient-to-br from-indigo-600/90 to-cyan-600/80'
              : 'bg-gradient-to-br from-violet-600/90 to-indigo-700/85'
          }`}
        >
          {initials}
        </div>
      )}
      {isOnline && (
        <span
          title="Online"
          className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-cyan-400 ring-2 ring-[#0b0f1e] shadow-[0_0_8px_rgba(34,211,238,0.85)]"
        />
      )}
    </div>
  );
}
