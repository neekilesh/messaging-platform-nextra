import React from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import type { AuthUser, StoryRecord } from '../../types/nexora';
import { useVisualPrefs } from '../../lib/theme';
import { Avatar } from '../ui/Avatar';

interface StoriesStripProps {
  currentUser: AuthUser;
  stories: StoryRecord[];
  onOpenCreate: () => void;
  onOpenUserStories: (userId: string) => void;
}

export function StoriesStrip({ currentUser, stories, onOpenCreate, onOpenUserStories }: StoriesStripProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  // Group stories by author
  const grouped = new Map<
    string,
    { userId: string; username: string; displayName: string; avatarUrl: string | null; hasUnviewed: boolean; count: number }
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
    <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3 overflow-x-auto">
      <motion.button
        type="button"
        whileHover={effectiveReducedMotion ? undefined : { scale: 1.05 }}
        whileTap={effectiveReducedMotion ? undefined : { scale: 0.94 }}
        onClick={onOpenCreate}
        className="flex flex-col items-center gap-1.5 shrink-0 group cursor-pointer"
      >
        <div className="w-13 h-13 rounded-full p-[2px] bg-slate-800 border border-dashed border-violet-400/60 flex items-center justify-center group-hover:border-cyan-400 group-hover:shadow-[0_0_12px_rgba(34,211,238,0.3)] transition-all">
          <Plus className="w-5 h-5 text-violet-300 group-hover:text-cyan-300 transition-colors" />
        </div>
        <span className="text-[11px] text-slate-300 max-w-[64px] truncate">Add Story</span>
      </motion.button>

      {authors.map((author) => (
        <motion.button
          key={author.userId}
          type="button"
          whileHover={effectiveReducedMotion ? undefined : { scale: 1.05 }}
          whileTap={effectiveReducedMotion ? undefined : { scale: 0.94 }}
          onClick={() => onOpenUserStories(author.userId)}
          className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer"
        >
          <div className="relative w-13 h-13 rounded-full p-[2.5px]">
            <span
              aria-hidden="true"
              className={`absolute inset-0 rounded-full ${
                author.hasUnviewed ? 'nexora-story-ring-unviewed' : 'nexora-story-ring-viewed'
              }`}
            />
            <div className="relative z-10 w-full h-full rounded-full bg-[#070913] p-[2px] flex items-center justify-center">
              <Avatar src={author.avatarUrl} name={author.displayName} size="md" />
            </div>
          </div>
          <span className="text-[11px] text-slate-300 max-w-[64px] truncate">
            {author.userId === currentUser.id ? 'Your Story' : `@${author.username}`}
          </span>
        </motion.button>
      ))}
    </div>
  );
}
