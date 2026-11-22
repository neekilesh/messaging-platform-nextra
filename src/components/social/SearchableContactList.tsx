import React, { useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Search, UserCheck, X } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { useVisualPrefs } from '../../lib/theme';
import type { FriendItem, PublicUser } from '../../types/nexora';
import { GlassButton, GlassCard, GlassInput } from '../ui/LiquidGlass';
import { FriendItemCard } from './FriendItemCard';

type ContactFilter = 'all' | 'online';

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

  const onlineCount = useMemo(
    () => friends.filter((f) => f.user.isOnline).length,
    [friends]
  );

  const filteredFriends = useMemo(() => {
    const rawQuery = searchQuery.trim().toLowerCase();
    const cleanQuery = rawQuery.startsWith('@') ? rawQuery.slice(1) : rawQuery;

    const list = friends.filter((f) => {
      if (filter === 'online' && !f.user.isOnline) return false;

      if (!cleanQuery) return true;
      const displayMatch = f.user.displayName.toLowerCase().includes(cleanQuery);
      const usernameMatch = f.user.username.toLowerCase().includes(cleanQuery);
      return displayMatch || usernameMatch;
    });

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
      return a.user.displayName.localeCompare(b.user.displayName);
    });
  }, [friends, searchQuery, filter]);

  if (friends.length === 0) {
    return (
      <GlassCard intensity="subtle" className="py-10 text-center space-y-3">
        <UserCheck className="w-8 h-8 text-violet-600 dark:text-violet-300 mx-auto opacity-85" />
        <div className="text-sm font-semibold text-[var(--nx-text-primary)]">No connections yet</div>
        <p className="text-xs text-[var(--nx-text-secondary)] max-w-sm mx-auto leading-relaxed">
          Search for friends by their @username to start encrypted conversations, 24h stories, and connection games.
        </p>
        <GlassButton type="button" variant="primary" size="sm" onClick={onSwitchToDiscover}>
          Find People
        </GlassButton>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar & Segmented Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <GlassInput
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && searchQuery) {
              setSearchQuery('');
            }
          }}
          placeholder="Filter friends by name or @username..."
          aria-label="Filter friends by display name or username"
          containerClassName="flex-1"
          leadingIcon={<Search className="w-4 h-4" />}
          trailingAction={
            searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear friend filter"
                className="p-1.5 rounded-full text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : undefined
          }
        />

        <div className="flex items-center gap-1 p-1 rounded-[14px] nexora-glass-subtle self-start sm:self-auto">
          {([
            { id: 'all', label: `All (${friends.length})` },
            { id: 'online', label: `Online (${onlineCount})` },
          ] as const).map((item) => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  audioManager.play('ui.tab_switch');
                  setFilter(item.id);
                }}
                className={`relative px-2.5 py-1.5 rounded-[10px] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={prefersReducedMotion ? undefined : 'contact-filter-indicator'}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-[10px] bg-white/80 dark:bg-white/[0.15] border border-white/80 dark:border-white/[0.14] shadow-sm"
                  />
                )}
                <span className="relative z-10 font-mono-tabular">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {(searchQuery.trim() || filter !== 'all') && (
        <div className="text-xs text-[var(--nx-text-secondary)] flex items-center justify-between px-0.5">
          <span>
            Showing <span className="font-mono-tabular text-[var(--nx-text-primary)] font-medium">{filteredFriends.length}</span> of{' '}
            <span className="font-mono-tabular text-[var(--nx-text-primary)] font-medium">{friends.length}</span> friends
          </span>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setFilter('all');
            }}
            className="text-violet-700 dark:text-sky-300 hover:underline cursor-pointer"
          >
            Reset filters
          </button>
        </div>
      )}

      {filteredFriends.length === 0 ? (
        <GlassCard intensity="subtle" className="py-10 text-center space-y-3">
          <div className="text-sm font-semibold text-[var(--nx-text-primary)]">No matching friends</div>
          <p className="text-xs text-[var(--nx-text-secondary)] max-w-sm mx-auto">
            {searchQuery.trim()
              ? `No friends matched "${searchQuery.trim()}" in your connections.`
              : 'No friends match this filter right now.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            <GlassButton
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setFilter('all');
              }}
            >
              Show All Friends
            </GlassButton>
            <GlassButton type="button" variant="primary" size="sm" onClick={onSwitchToDiscover}>
              Find @username
            </GlassButton>
          </div>
        </GlassCard>
      ) : (
        <LayoutGroup id="searchable-contact-list">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AnimatePresence initial={false} mode="popLayout">
              {filteredFriends.map((f) => (
                <FriendItemCard
                  key={f.friendshipId}
                  friend={f}
                  prefersReducedMotion={prefersReducedMotion}
                  onStartChat={onStartChat}
                  onSelectProfile={onSelectProfile}
                />
              ))}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}
