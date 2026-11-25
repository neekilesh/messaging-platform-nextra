import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Flame, Sparkles, Trophy } from 'lucide-react';
import { useVisualPrefs } from '../../lib/theme';
import type { DailyConnectionStreak } from '../../types/nexora';

interface StreakCounterProps {
  connectionStreak: DailyConnectionStreak;
  variant?: 'compact' | 'detailed';
  onClick?: () => void;
  className?: string;
}

const MILESTONE_THRESHOLDS = [3, 7, 14, 30, 50, 100, 180, 365];

function computeMilestoneProgress(streak: DailyConnectionStreak): {
  prevThreshold: number;
  nextThreshold: number | null;
  progressPct: number;
} {
  const nextThreshold =
    streak.nextMilestone ??
    MILESTONE_THRESHOLDS.find((m) => m > streak.currentStreak) ??
    null;
  if (!nextThreshold) {
    return { prevThreshold: 0, nextThreshold: null, progressPct: 100 };
  }
  const prevIdx = MILESTONE_THRESHOLDS.findIndex((m) => m >= nextThreshold) - 1;
  const prevThreshold = prevIdx >= 0 ? MILESTONE_THRESHOLDS[prevIdx] : 0;
  const span = Math.max(1, nextThreshold - prevThreshold);
  const clamped = Math.max(0, Math.min(span, streak.currentStreak - prevThreshold));
  return {
    prevThreshold,
    nextThreshold,
    progressPct: Math.round((clamped / span) * 100),
  };
}

export function StreakCounter({
  connectionStreak,
  variant = 'detailed',
  onClick,
  className = '',
}: StreakCounterProps) {
  const { effectiveReducedMotion: prefersReducedMotion } = useVisualPrefs();
  const hasStreak = connectionStreak.currentStreak > 0;
  const milestone = connectionStreak.milestoneReached;
  const { nextThreshold, progressPct } = computeMilestoneProgress(connectionStreak);

  if (variant === 'compact') {
    const Wrapper = onClick ? motion.button : motion.div;
    return (
      <Wrapper
        {...(onClick ? { type: 'button' as const, onClick } : {})}
        initial={prefersReducedMotion ? false : { opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={`w-full rounded-[16px] nexora-glass-subtle border ${
          milestone
            ? 'border-amber-400/45 dark:border-amber-300/40'
            : 'border-cyan-400/25 dark:border-violet-400/20'
        } px-3.5 py-2 flex items-center justify-between gap-3 text-left ${
          onClick ? 'hover:bg-[var(--nx-surface-hover)] transition-colors cursor-pointer' : ''
        } ${className}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500/25 via-sky-500/20 to-cyan-400/25 flex items-center justify-center shrink-0">
            {hasStreak && !prefersReducedMotion && (
              <motion.span
                aria-hidden="true"
                animate={{ scale: [1, 1.32, 1], opacity: [0.45, 0, 0.45] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-0 rounded-xl bg-cyan-400/30"
              />
            )}
            <Flame
              className={`w-3.5 h-3.5 relative z-10 ${
                milestone
                  ? 'text-amber-500 dark:text-amber-300'
                  : hasStreak
                  ? 'text-violet-600 dark:text-cyan-300'
                  : 'text-[var(--nx-text-muted)]'
              }`}
            />
          </div>

          <div className="flex items-center gap-1.5 min-w-0 flex-wrap text-xs">
            <motion.span
              key={`compact-streak-${connectionStreak.currentStreak}`}
              initial={prefersReducedMotion ? false : { scale: 0.85, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 24 }}
              className="font-display font-semibold font-mono-tabular tabular-nums text-[var(--nx-text-primary)] whitespace-nowrap"
            >
              {connectionStreak.currentStreak}-day streak
            </motion.span>
            <span aria-hidden="true" className="text-[var(--nx-text-muted)]">
              ·
            </span>
            <span className="text-[11px] font-mono-tabular tabular-nums text-[var(--nx-text-secondary)] whitespace-nowrap">
              Best {connectionStreak.longestStreak}d
            </span>
            {milestone ? (
              <>
                <span aria-hidden="true" className="text-[var(--nx-text-muted)]">
                  ·
                </span>
                <motion.span
                  initial={prefersReducedMotion ? false : { opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-300 whitespace-nowrap"
                >
                  <Trophy className="w-3 h-3 shrink-0" />
                  <span>{milestone}d milestone</span>
                </motion.span>
              </>
            ) : nextThreshold ? (
              <>
                <span aria-hidden="true" className="text-[var(--nx-text-muted)] hidden sm:inline">
                  ·
                </span>
                <span className="text-[11px] font-mono-tabular tabular-nums text-[var(--nx-text-muted)] whitespace-nowrap hidden sm:inline">
                  Next {nextThreshold}d
                </span>
              </>
            ) : null}
          </div>
        </div>

        <span className="text-[11px] font-medium text-violet-700 dark:text-cyan-300 whitespace-nowrap shrink-0">
          Daily Streak
        </span>
      </Wrapper>
    );
  }

  return (
    <div
      className={`relative rounded-[24px] nexora-glass border ${
        milestone
          ? 'border-amber-400/45 dark:border-amber-300/35'
          : 'border-cyan-400/30 dark:border-violet-400/25'
      } p-4 sm:p-5 shadow-[0_12px_34px_rgba(78,124,255,0.14)] overflow-hidden ${className}`}
    >
      <div className="relative z-10 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              animate={
                hasStreak && !prefersReducedMotion
                  ? { scale: [1, 1.07, 1], rotate: [0, -2, 2, 0] }
                  : undefined
              }
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              className={`relative w-11 h-11 rounded-2xl border border-white/50 dark:border-white/15 flex items-center justify-center shrink-0 ${
                milestone
                  ? 'bg-gradient-to-br from-amber-400/30 via-violet-500/25 to-cyan-400/25'
                  : 'bg-gradient-to-br from-violet-500/25 via-sky-500/20 to-cyan-400/25'
              }`}
            >
              <Flame
                className={`w-5 h-5 ${
                  milestone
                    ? 'text-amber-500 dark:text-amber-300'
                    : hasStreak
                    ? 'text-violet-600 dark:text-cyan-300'
                    : 'text-[var(--nx-text-muted)]'
                }`}
              />
            </motion.div>
            <div className="min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-violet-700 dark:text-cyan-300">
                Daily Connection Streak
              </div>
              <div className="text-xs text-[var(--nx-text-secondary)] truncate">
                Grows when both of you finish today&apos;s challenge
              </div>
            </div>
          </div>

          {nextThreshold && (
            <div className="text-right shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                Next Milestone
              </div>
              <div className="text-xs font-mono-tabular tabular-nums font-semibold text-violet-700 dark:text-cyan-300">
                {nextThreshold} days
              </div>
            </div>
          )}
        </div>

        {/* Metrics row — single surface, tabular numbers, unboxed cleanly separated columns */}
        <div className="grid grid-cols-3 divide-x divide-[var(--nx-hairline)] pt-1">
          <div className="px-2 text-center">
            <motion.div
              key={`detailed-streak-${connectionStreak.currentStreak}`}
              initial={prefersReducedMotion ? false : { scale: 0.8, y: 4, opacity: 0.5 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              className="text-xl font-display font-bold font-mono-tabular tabular-nums text-[var(--nx-text-primary)]"
            >
              {connectionStreak.currentStreak}
            </motion.div>
            <div className="text-[11px] text-[var(--nx-text-secondary)]">Current</div>
          </div>
          <div className="px-2 text-center">
            <div className="text-xl font-display font-bold font-mono-tabular tabular-nums text-[var(--nx-text-primary)]">
              {connectionStreak.longestStreak}
            </div>
            <div className="text-[11px] text-[var(--nx-text-secondary)]">Longest</div>
          </div>
          <div className="px-2 text-center">
            <div className="text-xl font-display font-bold font-mono-tabular tabular-nums text-[var(--nx-text-primary)]">
              {connectionStreak.totalCompleted}
            </div>
            <div className="text-[11px] text-[var(--nx-text-secondary)]">Completed</div>
          </div>
        </div>

        {/* Milestone Progress Track */}
        {nextThreshold && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-muted)]">
              <span>Milestone progress</span>
              <span className="font-mono-tabular tabular-nums">
                {connectionStreak.currentStreak} / {nextThreshold} days
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
              <motion.div
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full bg-gradient-to-r from-[#7c5cf6] via-[#566ee6] to-[#38bdf8]"
              />
            </div>
          </div>
        )}

        <AnimatePresence>
          {milestone && (
            <motion.div
              key={`streak-milestone-note-${milestone}`}
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.94, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 360, damping: 24 }}
              className="relative rounded-2xl bg-gradient-to-r from-amber-400/20 via-violet-500/20 to-cyan-400/20 border border-amber-300/45 dark:border-cyan-300/40 px-3.5 py-2.5 flex items-center gap-2.5 overflow-hidden"
            >
              {!prefersReducedMotion && (
                <motion.span
                  aria-hidden="true"
                  initial={{ x: '-110%' }}
                  animate={{ x: '130%' }}
                  transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }}
                  className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                />
              )}
              <Trophy className="w-4 h-4 text-amber-500 dark:text-amber-300 shrink-0 relative z-10" />
              <div className="text-xs text-[var(--nx-text-primary)] font-medium relative z-10">
                <span className="font-mono-tabular tabular-nums font-bold">{milestone}-Day</span>{' '}
                Connection Milestone Unlocked!
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface StreakMilestoneOverlayProps {
  milestone: number | null;
  peerName?: string;
  onDismiss: () => void;
}

const SPARKLE_RAYS = [
  { angle: 0, distance: 76, size: 6, delay: 0.05 },
  { angle: 36, distance: 88, size: 5, delay: 0.1 },
  { angle: 72, distance: 72, size: 7, delay: 0.15 },
  { angle: 108, distance: 86, size: 5, delay: 0.08 },
  { angle: 144, distance: 78, size: 6, delay: 0.12 },
  { angle: 180, distance: 90, size: 6, delay: 0.06 },
  { angle: 216, distance: 74, size: 5, delay: 0.14 },
  { angle: 252, distance: 84, size: 7, delay: 0.09 },
  { angle: 288, distance: 76, size: 5, delay: 0.16 },
  { angle: 324, distance: 86, size: 6, delay: 0.11 },
];

export function StreakMilestoneOverlay({
  milestone,
  peerName,
  onDismiss,
}: StreakMilestoneOverlayProps) {
  const { effectiveReducedMotion: prefersReducedMotion } = useVisualPrefs();

  return (
    <AnimatePresence>
      {milestone !== null && (
        <motion.div
          key={`milestone-overlay-${milestone}`}
          role="dialog"
          aria-modal="false"
          aria-label={`${milestone}-Day Connection Streak Milestone`}
          initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: 1, backdropFilter: 'blur(14px)' }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 z-20 rounded-[28px] bg-[var(--nx-glass-bg)]/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center overflow-hidden"
        >
          {/* Aurora Bloom Layers */}
          <motion.div
            aria-hidden="true"
            initial={prefersReducedMotion ? false : { scale: 0.6, opacity: 0 }}
            animate={
              prefersReducedMotion
                ? { opacity: 0.6 }
                : { scale: [0.85, 1.12, 1], opacity: [0.4, 0.85, 0.7] }
            }
            transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute w-72 h-72 rounded-full bg-gradient-to-tr from-violet-500/35 via-sky-400/25 to-amber-300/30 blur-2xl"
          />

          {/* Specular Sweep */}
          {!prefersReducedMotion && (
            <motion.div
              aria-hidden="true"
              initial={{ x: '-120%', opacity: 0 }}
              animate={{ x: '130%', opacity: [0, 0.7, 0] }}
              transition={{ duration: 1.25, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent -skew-x-12"
            />
          )}

          {/* Concentric Expanding Rings + Sparkles */}
          <div className="relative flex items-center justify-center mb-4">
            {!prefersReducedMotion && (
              <>
                <motion.span
                  aria-hidden="true"
                  initial={{ scale: 0.65, opacity: 0.85 }}
                  animate={{ scale: 2.35, opacity: 0 }}
                  transition={{ duration: 1.35, ease: 'easeOut' }}
                  className="pointer-events-none absolute w-20 h-20 rounded-full border border-amber-300/75"
                />
                <motion.span
                  aria-hidden="true"
                  initial={{ scale: 0.75, opacity: 0.75 }}
                  animate={{ scale: 2.7, opacity: 0 }}
                  transition={{ duration: 1.65, delay: 0.14, ease: 'easeOut' }}
                  className="pointer-events-none absolute w-20 h-20 rounded-full border border-cyan-300/65"
                />
                {SPARKLE_RAYS.map((ray, idx) => {
                  const rad = (ray.angle * Math.PI) / 180;
                  const tx = Math.round(Math.cos(rad) * ray.distance);
                  const ty = Math.round(Math.sin(rad) * ray.distance);
                  return (
                    <motion.span
                      key={idx}
                      aria-hidden="true"
                      initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                      animate={{
                        x: [0, tx * 0.75, tx],
                        y: [0, ty * 0.75, ty],
                        scale: [0, 1.15, 0],
                        opacity: [0, 1, 0],
                      }}
                      transition={{
                        duration: 1.45,
                        delay: ray.delay,
                        repeat: Infinity,
                        repeatDelay: 1.8,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      style={{ width: ray.size, height: ray.size }}
                      className={`pointer-events-none absolute rounded-full ${
                        idx % 3 === 0
                          ? 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.9)]'
                          : idx % 3 === 1
                          ? 'bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]'
                          : 'bg-violet-300 shadow-[0_0_10px_rgba(196,181,253,0.9)]'
                      }`}
                    />
                  );
                })}
              </>
            )}

            <motion.div
              initial={prefersReducedMotion ? false : { scale: 0.4, rotate: -14, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="relative z-10 w-20 h-20 rounded-[24px] bg-gradient-to-br from-amber-400/35 via-violet-500/30 to-cyan-400/35 border border-white/70 dark:border-white/25 shadow-[0_14px_38px_rgba(124,92,246,0.34)] flex items-center justify-center"
            >
              <Trophy className="w-9 h-9 text-amber-500 dark:text-amber-300 drop-shadow-[0_2px_10px_rgba(251,191,36,0.45)]" />
              <motion.span
                animate={prefersReducedMotion ? undefined : { scale: [1, 1.2, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 text-white flex items-center justify-center shadow-md"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </motion.span>
            </motion.div>
          </div>

          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.32, delay: prefersReducedMotion ? 0 : 0.12 }}
            className="relative z-10 space-y-2 max-w-xs"
          >
            <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-amber-600 dark:text-amber-300">
              Milestone Unlocked
            </div>
            <h4 className="text-2xl font-display font-bold text-[var(--nx-text-primary)] tracking-tight">
              <span className="font-mono-tabular tabular-nums">{milestone}-Day</span> Streak
            </h4>
            <p className="text-xs text-[var(--nx-text-secondary)] leading-relaxed">
              {peerName
                ? `You and ${peerName} kept your daily connection spark alive for ${milestone} days together.`
                : `You kept your daily connection spark alive for ${milestone} days together.`}
            </p>
          </motion.div>

          <motion.button
            type="button"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.3, delay: prefersReducedMotion ? 0 : 0.2 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
            onClick={onDismiss}
            className="relative z-10 mt-5 min-h-[42px] px-5 rounded-full bg-gradient-to-br from-[#7c5cf6] via-[#566ee6] to-[#38bdf8] text-white text-xs font-semibold shadow-[0_10px_26px_rgba(88,80,236,0.35)] hover:brightness-105 transition-all cursor-pointer whitespace-nowrap"
          >
            Celebrate &amp; View Answers
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
