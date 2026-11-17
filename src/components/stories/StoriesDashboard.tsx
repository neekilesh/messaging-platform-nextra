import React from 'react';
import { motion } from 'motion/react';
import { Clock, Eye, Lock, Plus } from 'lucide-react';
import type { AuthUser, StoryRecord } from '../../types/nexora';
import { useVisualPrefs } from '../../lib/theme';
import { Avatar } from '../ui/Avatar';

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
    <div className="h-full max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-6 overflow-y-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold text-white">24-Hour Stories</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            End-to-end encrypted photo and video stories that automatically expire after 24 hours.
          </p>
        </div>

        <motion.button
          type="button"
          whileHover={effectiveReducedMotion ? undefined : { scale: 1.03 }}
          whileTap={effectiveReducedMotion ? undefined : { scale: 0.96 }}
          onClick={onOpenCreate}
          className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1.5 shadow-[0_0_16px_rgba(124,58,237,0.3)] transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Story</span>
        </motion.button>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-display font-semibold text-slate-200">Your Active Stories</h3>
        {myStories.length === 0 ? (
          <div className="nexora-surface rounded-2xl p-6 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-white">Share a moment with your circle</div>
              <p className="text-xs text-slate-400">
                Encrypted locally for your friends or selected viewers. Automatically erased after 24 hours.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenCreate}
              className="h-9 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white shrink-0 cursor-pointer transition-colors"
            >
              Add Story
            </button>
          </div>
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
                  className="nexora-surface rounded-2xl p-4 text-left hover:border-violet-500/45 hover:shadow-[0_0_20px_rgba(124,58,237,0.16)] transition-all space-y-3 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-cyan-300 capitalize">{s.mediaType} story</span>
                    <span className="text-[11px] font-mono-tabular text-slate-400 inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeRemaining(s.expiresAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="inline-flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-violet-400" />
                      <span className="font-mono-tabular">{s.viewCount} views</span>
                    </span>
                    <span className="text-slate-400 capitalize">{s.visibility.replace('_', ' ')}</span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-display font-semibold text-slate-200">Friends' Stories</h3>
        {friendStories.length === 0 ? (
          <div className="nexora-surface rounded-2xl p-10 text-center space-y-2.5">
            <div className="w-11 h-11 rounded-2xl bg-violet-600/15 border border-violet-500/25 flex items-center justify-center mx-auto">
              <Lock className="w-5 h-5 text-violet-300" />
            </div>
            <div className="text-sm font-medium text-slate-200">No friend stories right now</div>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              When connected friends post encrypted 24-hour stories, they will appear here with glowing story rings.
            </p>
          </div>
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
                  className="nexora-surface rounded-2xl p-4 flex items-center gap-3 text-left hover:border-cyan-400/45 hover:shadow-[0_0_20px_rgba(34,211,238,0.14)] transition-all cursor-pointer"
                >
                  <div className="relative p-[2.5px] rounded-full shrink-0">
                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 rounded-full ${
                        !s.viewedByMe ? 'nexora-story-ring-unviewed' : 'nexora-story-ring-viewed'
                      }`}
                    />
                    <div className="relative z-10 rounded-full bg-[#070913] p-[2px]">
                      <Avatar src={s.avatarUrl} name={s.displayName} size="md" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">{s.displayName}</div>
                    <div className="text-xs text-slate-400 truncate">
                      @{s.username} · {s.mediaType}
                    </div>
                    <div className="text-[11px] font-mono-tabular text-cyan-300 mt-0.5">
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
