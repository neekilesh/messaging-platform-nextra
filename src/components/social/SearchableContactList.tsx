import React, { useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { MessageSquare, Search, UserCheck, X } from 'lucide-react';
import { useVisualPrefs } from '../../lib/theme';
import type { FriendItem, PublicUser } from '../../types/nexora';
import { Avatar } from '../ui/Avatar';
import { StreakCounter } from '../chat/StreakCounter';

type ContactFilter = 'all' | 'online' | 'streaks';

interface SearchableContactListProps {
  friends: FriendItem[];
  onStartChat: (userId: string) => void;
  onSelectProfile: (user: PublicUser) => void;
  onSwitchToDiscover: () => void;
}

export function SearchableContactList({
  friends,
  onStartChat,
  onSelectProfile,
  onSwitchToDiscover,
}: SearchableContactListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ContactFilter>('all');
  const { effectiveReducedMotion: prefersReducedMotion } = useVisualPrefs();

  const onlineCount = useMemo(() => friends.filter((f) => f.user.isOnline).length, [friends]);
  const streakCount = useMemo(
    () => friends.filter((f) => f.streak.isActive && f.streak.streakCount > 0).length,
    [friends]
  );

  const filteredFriends = useMemo(() => {
    const rawQuery = searchQuery.trim().toLowerCase();
    const cleanQuery = rawQuery.startsWith('@') ? rawQuery.slice(1) : rawQuery;

    const list = friends.filter((f) => {
      if (filter === 'online' && !f.user.isOnline) return false;
      if (filter === 'streaks' && (!f.streak.isActive || f.streak.streakCount <= 0)) return false;

      if (!cleanQuery) return true;
      const displayMatch = f.user.displayName.toLowerCase().includes(cleanQuery);
      const usernameMatch = f.user.username.toLowerCase().includes(cleanQuery);
      return displayMatch || usernameMatch;
    });

    // Rank prefix/exact matches first, then online status and active streak
    return [...list].sort((a, b) => {
      if (cleanQuery) {
        const aExact =
          a.user.username.toLowerCase().startsWith(cleanQuery) ||
          a.user.displayName.toLowerCase().startsWith(cleanQuery);
        const bExact =
          b.user.username.toLowerCase().startsWith(cleanQuery) ||
          b.user.displayName.toLowerCase().startsWith(cleanQuery);
        if (aExact !== bExact) return aExact ? -1 : 1;
      }
      if (a.user.isOnline !== b.user.isOnline) return a.user.isOnline ? -1 : 1;
      return (b.streak.streakCount || 0) - (a.streak.streakCount || 0);
    });
  }, [friends, searchQuery, filter]);

  if (friends.length === 0) {
    return (
      <div className="nexora-surface rounded-2xl p-8 text-center space-y-3">
        <UserCheck className="w-8 h-8 text-violet-400 mx-auto opacity-80" />
        <div className="text-sm font-medium text-white">No connections yet</div>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          Search for friends by their @username to start encrypted conversations, 24h stories, and friend streaks.
        </p>
        <button
          type="button"
          onClick={onSwitchToDiscover}
          className="h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
        >
          Find People
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar & Quick Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && searchQuery) {
                setSearchQuery('');
              }
            }}
            placeholder="Filter friends by display name or @username..."
            aria-label="Filter friends by display name or username"
            className="w-full h-10 pl-10 pr-9 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear friend filter"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-900/75 rounded-xl border border-white/10 self-start sm:self-auto">
          {([
            { id: 'all', label: `All (${friends.length})` },
            { id: 'online', label: `Online (${onlineCount})` },
            { id: 'streaks', label: `Streaks (${streakCount})` },
          ] as const).map((item) => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`relative px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  active ? 'text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={prefersReducedMotion ? undefined : 'contact-filter-indicator'}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-lg bg-violet-600/85"
                  />
                )}
                <span className="relative z-10 font-mono-tabular">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Contact Count Status */}
      {(searchQuery.trim() || filter !== 'all') && (
        <div className="text-xs text-slate-400 flex items-center justify-between px-0.5">
          <span>
            Showing <span className="font-mono-tabular text-slate-200">{filteredFriends.length}</span> of{' '}
            <span className="font-mono-tabular text-slate-200">{friends.length}</span> friends
          </span>
          {(searchQuery.trim() || filter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilter('all');
              }}
              className="text-cyan-300 hover:text-cyan-200 cursor-pointer"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      {/* Filtered Contact Grid */}
      {filteredFriends.length === 0 ? (
        <div className="nexora-surface rounded-2xl p-8 text-center space-y-3">
          <div className="text-sm font-medium text-white">No matching friends</div>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {searchQuery.trim()
              ? `No friends matched "${searchQuery.trim()}" in your connections.`
              : 'No friends match this filter right now.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilter('all');
              }}
              className="h-9 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
            >
              Show All Friends
            </button>
            <button
              type="button"
              onClick={onSwitchToDiscover}
              className="h-9 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
            >
              Find @username
            </button>
          </div>
        </div>
      ) : (
        <LayoutGroup id="searchable-contact-list">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AnimatePresence initial={false} mode="popLayout">
              {filteredFriends.map((f) => (
                <motion.div
                  key={f.friendshipId}
                  layout={prefersReducedMotion ? false : 'position'}
                  initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.94 }}
                  transition={
                    prefersReducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 380, damping: 28 }
                  }
                  className="nexora-surface rounded-2xl p-4 flex items-center justify-between gap-3 hover:border-violet-500/35 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onSelectProfile(f.user)}
                    className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
                  >
                    <Avatar
                      src={f.user.avatarUrl}
                      name={f.user.displayName}
                      size="md"
                      isOnline={f.user.isOnline}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate flex items-center gap-2">
                        <span className="truncate">{f.user.displayName}</span>
                        <StreakCounter streak={f.streak} variant="avatar" />
                      </div>
                      <div className="text-xs text-slate-400 truncate">
                        @{f.user.username}
                        {f.user.isOnline && ' · Online'}
                        {f.streak.expiringSoon && ' · Streak expiring soon'}
                      </div>
                    </div>
                  </button>

                  <motion.button
                    type="button"
                    whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
                    whileTap={prefersReducedMotion ? undefined : { scale: 0.95 }}
                    onClick={() => onStartChat(f.user.id)}
                    aria-label={`Start encrypted chat with ${f.user.displayName}`}
                    className="h-9 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat</span>
                  </motion.button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}
