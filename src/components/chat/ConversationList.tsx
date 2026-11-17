import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, Plus, Search, Timer, Users } from 'lucide-react';
import { useVisualPrefs } from '../../lib/theme';
import type { ConversationSummary } from '../../types/nexora';
import { Avatar } from '../ui/Avatar';
import { StreakCounter } from './StreakCounter';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  filterTab: 'all' | 'groups' | 'archived';
  onFilterTabChange: (tab: 'all' | 'groups' | 'archived') => void;
  onSelect: (conv: ConversationSummary) => void;
  onOpenCreateGroup: () => void;
  onOpenPeopleSearch: () => void;
}

export function ConversationList({
  conversations,
  activeId,
  filterTab,
  onFilterTabChange,
  onSelect,
  onOpenCreateGroup,
  onOpenPeopleSearch,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [burst, setBurst] = useState<{ id: string; key: number } | null>(null);
  const { effectiveReducedMotion } = useVisualPrefs();

  const filtered = conversations.filter((c) => {
    if (filterTab === 'archived') {
      if (!c.archived) return false;
    } else {
      if (c.archived) return false;
      if (filterTab === 'groups' && c.type !== 'group') return false;
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return c.title.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q);
    }
    return true;
  });

  const handleSelectConversation = (conv: ConversationSummary) => {
    if (!effectiveReducedMotion) {
      setBurst({ id: conv.id, key: Date.now() });
    }
    onSelect(conv);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 space-y-3 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-display font-bold text-white">
            {filterTab === 'groups' ? 'Groups' : filterTab === 'archived' ? 'Archived' : 'Messages'}
          </h2>
          <div className="flex items-center gap-1.5">
            <motion.button
              type="button"
              whileHover={effectiveReducedMotion ? undefined : { scale: 1.03 }}
              whileTap={effectiveReducedMotion ? undefined : { scale: 0.96 }}
              onClick={onOpenPeopleSearch}
              title="New private chat"
              aria-label="New private chat"
              className="h-8 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Chat</span>
            </motion.button>
            <motion.button
              type="button"
              whileHover={effectiveReducedMotion ? undefined : { scale: 1.03 }}
              whileTap={effectiveReducedMotion ? undefined : { scale: 0.96 }}
              onClick={onOpenCreateGroup}
              title="Create encrypted group"
              aria-label="Create encrypted group"
              className="h-8 px-2.5 rounded-lg bg-violet-600/90 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Group</span>
            </motion.button>
          </div>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter conversations..."
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-900/75 rounded-lg border border-white/5 relative">
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
                onClick={() => onFilterTabChange(t.id)}
                className={`relative flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  active ? 'text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={effectiveReducedMotion ? undefined : 'conv-filter-indicator'}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-md bg-violet-600"
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 ? (
          <div className="text-center py-12 px-4 space-y-3">
            <div className="w-11 h-11 rounded-2xl bg-violet-600/15 border border-violet-500/25 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(124,58,237,0.2)]">
              <Lock className="w-5 h-5 text-violet-300" />
            </div>
            <div className="text-sm font-medium text-slate-200">
              {search.trim() ? 'No matching chats' : 'No conversations here yet'}
            </div>
            <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
              {search.trim()
                ? `No encrypted chats matched "${search.trim()}".`
                : 'Search for a friend by their @username or start an encrypted 25-member group.'}
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
              ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';

            const showBurst = burst?.id === conv.id && !effectiveReducedMotion;
            const hasEncryptionKey =
              conv.type === 'private' ? Boolean(conv.peerUser?.ecdhPublicJwk) : Boolean(conv.currentEpoch);

            return (
              <motion.button
                key={conv.id}
                type="button"
                whileHover={effectiveReducedMotion ? undefined : { x: 2 }}
                whileTap={effectiveReducedMotion ? undefined : { scale: 0.98 }}
                onClick={() => handleSelectConversation(conv)}
                className={`relative w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors overflow-hidden cursor-pointer ${
                  isSelected ? 'text-white' : 'hover:bg-white/[0.04] text-slate-200'
                }`}
              >
                {isSelected && (
                  <motion.div
                    layoutId={effectiveReducedMotion ? undefined : 'active-conversation-aura'}
                    transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-600/25 via-indigo-600/18 to-cyan-500/15 border border-violet-400/40 pointer-events-none"
                  />
                )}

                {showBurst && (
                  <motion.span
                    key={burst.key}
                    initial={{ scale: 0.25, opacity: 0.65 }}
                    animate={{ scale: 2.6, opacity: 0 }}
                    transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute left-8 top-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-gradient-to-r from-violet-400/30 to-cyan-300/25 pointer-events-none"
                  />
                )}

                {/* Avatar + Streak Counter displayed right next to conversation avatar */}
                <div className="relative z-10 flex items-center gap-2 shrink-0">
                  <Avatar
                    src={conv.avatarUrl}
                    name={conv.title}
                    size="md"
                    isOnline={conv.peerUser?.isOnline}
                    isGroup={conv.type === 'group'}
                  />
                  <StreakCounter streak={conv.streak} variant="avatar" />
                </div>

                <div className="relative z-10 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white truncate">{conv.title}</span>
                    <span className="text-[11px] font-mono-tabular text-slate-500 shrink-0">
                      {timeLabel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-slate-400 truncate flex items-center gap-1">
                      {hasEncryptionKey && (
                        <Lock className="w-2.5 h-2.5 text-violet-400/80 shrink-0" aria-hidden="true" />
                      )}
                      {conv.disappearingSeconds > 0 && (
                        <Timer className="w-3 h-3 text-cyan-400 shrink-0" />
                      )}
                      <span className="truncate">{previewText}</span>
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-violet-600 text-white text-[11px] font-mono-tabular font-semibold flex items-center justify-center shrink-0 shadow-[0_0_8px_rgba(124,58,237,0.5)]">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </motion.button>
            );
          })
        )}
      </div>
    </div>
  );
}
