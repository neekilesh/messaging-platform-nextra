import React from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import type { AuthUser, StoryRecord } from '../../types/nexora';
import { useVisualPrefs } from '../../lib/theme';
import { ProfileAvatar, StoryRing } from '../ui/LiquidGlass';

interface StoriesStripProps {
  currentUser: AuthUser;
  stories: StoryRecord[];
  onOpenCreate: () => void;
  onOpenUserStories: (userId: string) => void;
}

export function StoriesStrip({
  currentUser,
  stories,
  onOpenCreate,
  onOpenUserStories,
}: StoriesStripProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  const grouped = new Map<
    string,
    {
      userId: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      hasUnviewed: boolean;
      count: number;
    }
  >();

  for (const s of stories) {
    const existing = grouped.get(s.userId);
    const unviewed = !s.viewedByMe && s.userId !== currentUser.id;
    if (!existing) {
      grouped.set(s.userId, {
        userId: s.userId,
        username: s.username,
        displayName: s.displayName,
        avatarUrl: s.avatarUrl,
        hasUnviewed: unviewed,
        count: 1,
      });
    } else {
      existing.hasUnviewed = existing.hasUnviewed || unviewed;
      existing.count += 1;
    }
  }

  const authors = Array.from(grouped.values()).sort((a, b) => {
    if (a.userId === currentUser.id) return -1;
    if (b.userId === currentUser.id) return 1;
    if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
    return 0;
  });

  return (
    <section aria-label="Stories" className="px-4 py-3 border-b border-[var(--nx-hairline)] shrink-0">
      <div className="flex items-center gap-3.5 overflow-x-auto no-scrollbar pb-0.5">
        <motion.button
          type="button"
          whileHover={effectiveReducedMotion ? undefined : { scale: 1.04 }}
          whileTap={effectiveReducedMotion ? undefined : { scale: 0.95 }}
          onClick={() => {
            audioManager.play('ui.glass_touch');
            onOpenCreate();
          }}
          className="flex flex-col items-center gap-1.5 shrink-0 group cursor-pointer"
        >
          <div className="w-13 h-13 rounded-full bg-white/50 dark:bg-white/[0.06] border border-dashed border-violet-500/45 dark:border-white/25 group-hover:border-violet-500 dark:group-hover:border-violet-400/70 group-hover:bg-white/75 dark:group-hover:bg-white/[0.1] flex items-center justify-center transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
            <Plus className="w-5 h-5 text-[var(--nx-text-secondary)] group-hover:text-[var(--nx-text-primary)] transition-colors" />
          </div>
          <span className="text-[11px] font-medium text-[var(--nx-text-secondary)] max-w-[64px] truncate">
            Add Story
          </span>
        </motion.button>

        {authors.map((author) => (
          <motion.button
            key={author.userId}
            type="button"
            whileHover={effectiveReducedMotion ? undefined : { scale: 1.04 }}
            whileTap={effectiveReducedMotion ? undefined : { scale: 0.95 }}
            onClick={() => onOpenUserStories(author.userId)}
            className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <StoryRing hasUnviewed={author.hasUnviewed} sizeClass="w-13 h-13">
              <ProfileAvatar src={author.avatarUrl} name={author.displayName} size="md" />
            </StoryRing>
            <span
              className={`text-[11px] max-w-[66px] truncate ${
                author.hasUnviewed
                  ? 'text-[var(--nx-text-primary)] font-semibold'
                  : 'text-[var(--nx-text-muted)]'
              }`}
            >
              {author.userId === currentUser.id ? 'Your Story' : `@${author.username}`}
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
