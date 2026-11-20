import React from 'react';
import { motion } from 'motion/react';
import { Clock, Eye, Lock, Plus } from 'lucide-react';
import type { AuthUser, StoryRecord } from '../../types/nexora';
import { useVisualPrefs } from '../../lib/theme';
import { GlassButton, GlassCard, ProfileAvatar, StoryRing } from '../ui/LiquidGlass';

interface StoriesDashboardProps {
  currentUser: AuthUser;
  stories: StoryRecord[];
  onOpenCreate: () => void;
  onOpenStoryIndex: (index: number) => void;
}

export function StoriesDashboard({
  currentUser,
  stories,
  onOpenCreate,
  onOpenStoryIndex,
}: StoriesDashboardProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  const myStories = stories.filter((s) => s.userId === currentUser.id);
  const friendStories = stories.filter((s) => s.userId !== currentUser.id);

  const timeRemaining = (expiresAt: string) => {
    const ms = Math.max(0, Date.parse(expiresAt) - Date.now());
    const hrs = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hrs}h ${mins}m left`;
  };

  return (
    <div className="h-full max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-7 overflow-y-auto pt-safe">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--nx-text-primary)] tracking-tight">
            Stories
          </h1>
          <p className="text-xs sm:text-sm text-[var(--nx-text-secondary)] mt-1">
            Encrypted photo and video moments that expire automatically after 24 hours.
          </p>
        </div>

        <GlassButton type="button" variant="primary" onClick={onOpenCreate}>
          <Plus className="w-4 h-4" />
          <span>New Story</span>
        </GlassButton>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-display font-semibold text-[var(--nx-text-primary)]">Your Active Stories</h2>
        {myStories.length === 0 ? (
          <GlassCard intensity="subtle" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-[var(--nx-text-primary)]">Share a moment with your circle</div>
              <p className="text-xs text-[var(--nx-text-secondary)] leading-relaxed">
                Encrypted locally for your friends or selected viewers and erased automatically after 24 hours.
              </p>
            </div>
            <GlassButton type="button" variant="secondary" onClick={onOpenCreate} className="self-start sm:self-auto">
              Add Story
            </GlassButton>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myStories.map((s) => {
              const globalIdx = stories.findIndex((item) => item.id === s.id);
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  whileHover={effectiveReducedMotion ? undefined : { y: -2 }}
                  whileTap={effectiveReducedMotion ? undefined : { scale: 0.98 }}
                  onClick={() => onOpenStoryIndex(globalIdx)}
                  className="nexora-glass rounded-[22px] p-4 text-left transition-all space-y-3 cursor-pointer"
                >
                  <div className="relative z-10 flex items-center justify-between">
                    <span className="text-xs font-semibold text-violet-700 dark:text-violet-200 capitalize">
                      {s.mediaType} story
                    </span>
                    <span className="text-[11px] font-mono-tabular text-[var(--nx-text-secondary)] inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeRemaining(s.expiresAt)}
                    </span>
                  </div>
                  <div className="relative z-10 flex items-center justify-between text-xs text-[var(--nx-text-secondary)]">
                    <span className="inline-flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />
                      <span className="font-mono-tabular">{s.viewCount} views</span>
                    </span>
                    <span className="text-[var(--nx-text-muted)] capitalize">{s.visibility.replace('_', ' ')}</span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-display font-semibold text-[var(--nx-text-primary)]">Friends&apos; Stories</h2>
        {friendStories.length === 0 ? (
          <GlassCard intensity="subtle" className="py-10 text-center space-y-2.5">
            <div className="w-11 h-11 rounded-2xl nexora-glass-subtle flex items-center justify-center mx-auto">
              <Lock className="w-5 h-5 text-violet-600 dark:text-violet-300" />
            </div>
            <div className="text-sm font-semibold text-[var(--nx-text-primary)]">No friend stories right now</div>
            <p className="text-xs text-[var(--nx-text-secondary)] max-w-sm mx-auto leading-relaxed">
              When connected friends post encrypted 24-hour stories, they appear here.
            </p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {friendStories.map((s) => {
              const globalIdx = stories.findIndex((item) => item.id === s.id);
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  whileHover={effectiveReducedMotion ? undefined : { y: -2 }}
                  whileTap={effectiveReducedMotion ? undefined : { scale: 0.98 }}
                  onClick={() => onOpenStoryIndex(globalIdx)}
                  className="nexora-glass rounded-[22px] p-4 flex items-center gap-3.5 text-left transition-all cursor-pointer"
                >
                  <StoryRing hasUnviewed={!s.viewedByMe} sizeClass="w-13 h-13 shrink-0 relative z-10">
                    <ProfileAvatar src={s.avatarUrl} name={s.displayName} size="md" />
                  </StoryRing>
                  <div className="relative z-10 min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--nx-text-primary)] truncate">{s.displayName}</div>
                    <div className="text-xs text-[var(--nx-text-secondary)] truncate">
                      @{s.username} · {s.mediaType}
                    </div>
                    <div className="text-[11px] font-mono-tabular text-sky-600 dark:text-sky-300 mt-0.5">
                      {timeRemaining(s.expiresAt)}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
