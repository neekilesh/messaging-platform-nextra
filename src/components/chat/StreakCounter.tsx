import React from 'react';
import { motion } from 'motion/react';
import { Flame, Sparkles } from 'lucide-react';
import type { StreakInfo } from '../../types/nexora';
import { useVisualPrefs } from '../../lib/theme';

interface StreakCounterProps {
  streak: StreakInfo | null | undefined;
  variant?: 'avatar' | 'header';
  countdownText?: string | null;
}

export function StreakCounter({
  streak,
  variant = 'avatar',
  countdownText = null,
}: StreakCounterProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  if (!streak || !streak.isActive || streak.streakCount <= 0) {
    return null;
  }

  const isMilestone = Boolean(streak.milestoneReached);
  const label = streak.expiringSoon
    ? countdownText
      ? `${streak.streakCount}-day streak · Streak expiring in ${countdownText}`
      : `${streak.streakCount}-day streak · Expiring soon`
    : streak.milestoneReached
    ? `${streak.streakCount}-day streak milestone!`
    : `${streak.streakCount}-day friend streak`;

  if (variant === 'avatar') {
    return (
      <motion.div
        initial={effectiveReducedMotion ? false : { scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        title={label}
        aria-label={label}
        className={`relative inline-flex items-center gap-0.5 font-mono-tabular text-xs font-semibold shrink-0 ${
          isMilestone
            ? 'text-amber-600 dark:text-amber-300'
            : 'text-amber-600 dark:text-amber-400'
        }`}
      >
        <motion.span
          animate={
            effectiveReducedMotion
              ? undefined
              : {
                  scale: isMilestone ? [1, 1.2, 1] : [1, 1.12, 1],
                  opacity: streak.expiringSoon ? [0.65, 1, 0.65] : [0.9, 1, 0.9],
                }
          }
          transition={{
            duration: streak.expiringSoon ? 1.1 : isMilestone ? 1.6 : 2.4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="inline-flex items-center justify-center drop-shadow-[0_0_8px_rgba(245,158,11,0.45)]"
        >
          <Flame className="w-3.5 h-3.5 fill-amber-500/45 text-amber-500 dark:text-amber-300" />
        </motion.span>
        <span>{streak.streakCount}</span>
        {isMilestone && !effectiveReducedMotion && (
          <Sparkles className="w-2.5 h-2.5 text-amber-500 dark:text-amber-200 animate-pulse" />
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={effectiveReducedMotion ? false : { scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 text-xs font-mono-tabular font-semibold text-amber-600 dark:text-amber-300 shrink-0"
    >
      <motion.span
        animate={effectiveReducedMotion ? undefined : { scale: isMilestone ? [1, 1.22, 1] : [1, 1.14, 1] }}
        transition={{ duration: isMilestone ? 1.5 : 2.2, repeat: Infinity, ease: 'easeInOut' }}
        className="inline-flex drop-shadow-[0_0_10px_rgba(245,158,11,0.45)]"
      >
        <Flame className="w-4 h-4 fill-amber-500/45 text-amber-500 dark:text-amber-300" />
      </motion.span>
      <span>{streak.streakCount}</span>
      {isMilestone && (
        <span className="inline-flex items-center gap-0.5 text-[11px] font-sans font-medium text-amber-700 dark:text-amber-200">
          · Milestone!
        </span>
      )}
      {streak.expiringSoon && (
        <span className="text-[11px] font-sans font-normal text-amber-700/85 dark:text-amber-200/80">
          · {countdownText ? `Expiring in ${countdownText}` : 'Expiring soon'}
        </span>
      )}
    </motion.div>
  );
}
