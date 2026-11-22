import React from 'react';
import { motion } from 'motion/react';
import { Lock, Plus, Timer, Users } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { formatRelativeTimestamp } from '../../lib/time';
import { useVisualPrefs } from '../../lib/theme';
import type { ConversationSummary } from '../../types/nexora';
import { GlassButton, ProfileAvatar } from '../ui/LiquidGlass';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  searchQuery: string;
  filterTab: 'all' | 'groups' | 'archived';
  onFilterTabChange: (tab: 'all' | 'groups' | 'archived') => void;
  onSelect: (conv: ConversationSummary) => void;
  onOpenCreateGroup: () => void;
  onOpenPeopleSearch: () => void;
}

export function ConversationList({
  conversations,
  activeId,
  searchQuery,
  filterTab,
  onFilterTabChange,
  onSelect,
  onOpenCreateGroup,
  onOpenPeopleSearch,
}: ConversationListProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  const filtered = conversations.filter((c) => {
    if (filterTab === 'archived') {
      if (!c.archived) return false;
    } else {
      if (c.archived) return false;
      if (filterTab === 'groups' && c.type !== 'group') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        (c.lastMessage?.localDecrypted?.text || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Segmented Filter Control & Quick Compose Actions */}
      <div className="px-4 pt-3 pb-2.5 flex items-center justify-between gap-2 border-b border-[var(--nx-hairline)]">
        <div className="flex items-center gap-1 p-1 rounded-[14px] bg-white/40 dark:bg-white/[0.04] border border-white/60 dark:border-white/[0.08] relative flex-1 max-w-[235px]">
          {([
            { id: 'all', label: 'All' },
            { id: 'groups', label: 'Groups' },
            { id: 'archived', label: 'Archived' },
          ] as const).map((t) => {
            const active = filterTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (t.id !== filterTab) audioManager.play('ui.tab_switch');
                  onFilterTabChange(t.id);
                }}
                className={`relative flex-1 py-1.5 text-[11px] font-medium rounded-[10px] transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'text-violet-950 dark:text-white'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={effectiveReducedMotion ? undefined : 'conv-filter-indicator'}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-[10px] bg-white/80 dark:bg-white/[0.14] border border-white/85 dark:border-white/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_2px_8px_rgba(30,24,70,0.06)]"
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <GlassButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenPeopleSearch}
            title="New private chat"
            aria-label="New private chat"
            className="px-2.5 h-8 rounded-[12px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Chat</span>
          </GlassButton>
          <GlassButton
            type="button"
            variant="primary"
            size="sm"
            onClick={onOpenCreateGroup}
            title="Create encrypted group"
            aria-label="Create encrypted group"
            className="px-2.5 h-8 rounded-[12px]"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Group</span>
          </GlassButton>
        </div>
      </div>

      {/* Conversation Rows */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-1">
        {filtered.length === 0 ? (
          <div className="text-center py-12 px-4 space-y-3">
            <div className="w-11 h-11 rounded-2xl bg-white/45 dark:bg-white/[0.06] border border-white/65 dark:border-white/[0.12] flex items-center justify-center mx-auto">
              <Lock className="w-5 h-5 text-violet-600 dark:text-violet-300" />
            </div>
            <div className="text-sm font-medium text-[var(--nx-text-primary)]">
              {searchQuery.trim() ? 'No matching chats' : 'No conversations here yet'}
            </div>
            <p className="text-xs text-[var(--nx-text-secondary)] max-w-[240px] mx-auto leading-relaxed">
              {searchQuery.trim()
                ? `No encrypted chats matched "${searchQuery.trim()}".`
                : 'Search for a friend by @username or start an encrypted 25-member group.'}
            </p>
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv.id === activeId;
            const previewText = conv.lastMessage
              ? conv.lastMessage.deletedForEveryone
                ? 'Message deleted'
                : conv.lastMessage.localDecrypted?.text ||
                  (conv.lastMessage.kind === 'voice'
                    ? 'Voice message'
                    : conv.lastMessage.kind === 'image'
                    ? 'Encrypted photo'
                    : conv.lastMessage.kind === 'video'
                    ? 'Encrypted video'
                    : conv.lastMessage.kind === 'file'
                    ? 'Encrypted document'
                    : 'Encrypted message')
              : conv.subtitle;

            const timeLabel = conv.lastMessageAt
              ? formatRelativeTimestamp(conv.lastMessageAt)
              : '';

            const hasEncryptionKey =
              conv.type === 'private' ? Boolean(conv.peerUser?.ecdhPublicJwk) : Boolean(conv.currentEpoch);

            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv)}
                className={`relative w-full flex items-center gap-3 px-3 py-3 rounded-[20px] text-left transition-all cursor-pointer group ${
                  isSelected
                    ? 'nexora-glass border-white/80 dark:border-white/[0.2] text-[var(--nx-text-primary)]'
                    : 'hover:bg-[var(--nx-surface-hover)] border border-transparent text-[var(--nx-text-primary)]'
                }`}
              >
                <div className="relative z-10 flex items-center gap-2 shrink-0">
                  <ProfileAvatar
                    src={conv.avatarUrl}
                    name={conv.title}
                    size="md"
                    isOnline={conv.peerUser?.isOnline}
                    isGroup={conv.type === 'group'}
                  />
                </div>

                <div className="relative z-10 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold text-[var(--nx-text-primary)] truncate">
                        {conv.title}
                      </span>
                      {conv.type === 'private' && conv.peerUser?.username && (
                        <span className="text-[11px] text-[var(--nx-text-muted)] truncate hidden sm:inline">
                          @{conv.peerUser.username}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono-tabular text-[var(--nx-text-secondary)] shrink-0">
                      {timeLabel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-[var(--nx-text-secondary)] truncate flex items-center gap-1">
                      {hasEncryptionKey && (
                        <Lock className="w-2.5 h-2.5 text-violet-600/80 dark:text-violet-300/75 shrink-0" aria-hidden="true" />
                      )}
                      {conv.disappearingSeconds > 0 && (
                        <Timer className="w-3 h-3 text-sky-600 dark:text-sky-300 shrink-0" />
                      )}
                      <span className="truncate">{previewText}</span>
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#7c5cf6] text-white text-[11px] font-mono-tabular font-semibold flex items-center justify-center shrink-0 shadow-sm">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
