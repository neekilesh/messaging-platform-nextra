import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { apiRequest } from '../../lib/api';
import { useVisualPrefs } from '../../lib/theme';
import type { FriendItem, FriendRequestItem, PublicUser } from '../../types/nexora';
import {
  GlassButton,
  GlassCard,
  GlassInput,
  GlassModal,
  ProfileAvatar,
} from '../ui/LiquidGlass';
import { CosmicLoader, ReactionParticleBurst } from '../ui/MagicalEffects';
import { SearchableContactList } from './SearchableContactList';

interface PeoplePanelProps {
  friends: FriendItem[];
  requests: FriendRequestItem[];
  onStartChat: (userId: string) => void;
  onRefresh: () => void;
}

export function PeoplePanel({ friends, requests, onStartChat, onRefresh }: PeoplePanelProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  const [tab, setTab] = useState<'friends' | 'discover' | 'requests'>('friends');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<PublicUser | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [celebrateKey, setCelebrateKey] = useState<number | null>(null);

  const incomingCount = requests.filter((r) => r.direction === 'incoming').length;

  const handleSearch = async (q: string) => {
    setQuery(q);
    const clean = q.trim();
    if (!clean) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await apiRequest<{ users: PublicUser[] }>(
        `/api/v1/users/search?q=${encodeURIComponent(clean)}`
      );
      setResults(res.users);
    } finally {
      setSearching(false);
    }
  };

  const sendFriendRequest = async (userId: string) => {
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ status: string }>('/api/v1/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      if (res.status === 'accepted') {
        setStatusMsg('Connected! You are now friends.');
        setCelebrateKey(Date.now());
        audioManager.play('friend.request_accept');
      } else {
        setStatusMsg('Connection request sent.');
        audioManager.play('friend.request_send');
      }
      onRefresh();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Request failed.');
    }
  };

  const respondRequest = async (requestId: string, action: 'accept' | 'reject') => {
    await apiRequest(`/api/v1/friends/requests/${requestId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (action === 'accept') {
      setStatusMsg('Connection accepted! Encrypted chat & connection games unlocked.');
      setCelebrateKey(Date.now());
      audioManager.play('friend.request_accept');
    } else {
      audioManager.play('friend.request_decline');
    }
    onRefresh();
  };

  const openProfile = (user: PublicUser) => {
    audioManager.play('friend.profile_open');
    setSelectedProfile(user);
  };

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-6 overflow-y-auto pt-safe">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--nx-text-primary)] tracking-tight">
            Friends
          </h1>
          <p className="text-xs sm:text-sm text-[var(--nx-text-secondary)] mt-1">
            Connect privately using @username handles without sharing email addresses.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-[16px] nexora-glass-subtle self-start">
          {([
            { id: 'friends', label: `Friends (${friends.length})` },
            { id: 'discover', label: 'Find @username' },
            { id: 'requests', label: `Requests${incomingCount > 0 ? ` (${incomingCount})` : ''}` },
          ] as const).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  audioManager.play('ui.tab_switch');
                  setTab(item.id);
                }}
                className={`relative px-3.5 py-2 rounded-[12px] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={effectiveReducedMotion ? undefined : 'friends-tab-pill'}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-[12px] bg-white/80 dark:bg-white/[0.15] border border-white/80 dark:border-white/[0.16] shadow-sm"
                  />
                )}
                <span className="relative z-10">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {statusMsg && (
          <motion.div
            initial={effectiveReducedMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={effectiveReducedMotion ? undefined : { opacity: 0, y: -6 }}
            className="relative overflow-hidden rounded-[18px] nexora-glass border-sky-500/35 dark:border-sky-400/30 px-4 py-3 text-xs text-sky-800 dark:text-sky-200 flex items-center justify-between"
          >
            <div className="flex items-center gap-2 relative z-10">
              <span className="relative inline-flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />
                <ReactionParticleBurst burstKey={celebrateKey} />
              </span>
              <span>{statusMsg}</span>
            </div>
            <button type="button" onClick={() => setStatusMsg(null)} className="cursor-pointer p-1">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {tab === 'discover' && (
        <div className="space-y-4">
          <GlassInput
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by @username or display name..."
            leadingIcon={<Search className="w-4 h-4" />}
            className="h-11"
          />

          {searching ? (
            <CosmicLoader compact label="Searching NEXORA directory..." />
          ) : results.length === 0 ? (
            <GlassCard intensity="subtle" className="py-10 text-center text-xs text-[var(--nx-text-secondary)]">
              {query.trim() ? 'No matching @usernames found.' : 'Type a @username to search the directory.'}
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {results.map((u) => {
                const isFriend = friends.some((f) => f.user.id === u.id);
                return (
                  <GlassCard
                    key={u.id}
                    intensity="subtle"
                    padding="sm"
                    className="flex items-center justify-between gap-3 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => openProfile(u)}
                      className="relative z-10 flex items-center gap-3 min-w-0 text-left cursor-pointer"
                    >
                      <ProfileAvatar src={u.avatarUrl} name={u.displayName} size="md" isOnline={u.isOnline} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--nx-text-primary)] truncate">{u.displayName}</div>
                        <div className="text-xs text-[var(--nx-text-secondary)] truncate">@{u.username}</div>
                      </div>
                    </button>

                    <div className="relative z-10 flex items-center gap-1.5 shrink-0">
                      {isFriend ? (
                        <GlassButton type="button" variant="primary" size="sm" onClick={() => onStartChat(u.id)}>
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Message</span>
                        </GlassButton>
                      ) : (
                        <>
                          <GlassButton
                            type="button"
                            variant="primary"
                            size="sm"
                            soundEvent={false}
                            onClick={() => sendFriendRequest(u.id)}
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Add</span>
                          </GlassButton>
                          <GlassButton
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onStartChat(u.id)}
                            title="Send chat request"
                            className="px-2.5"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </GlassButton>
                        </>
                      )}
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'friends' && (
        <SearchableContactList
          friends={friends}
          onStartChat={onStartChat}
          onSelectProfile={openProfile}
          onSwitchToDiscover={() => {
            audioManager.play('ui.tab_switch');
            setTab('discover');
          }}
        />
      )}

      {tab === 'requests' && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <GlassCard intensity="subtle" className="py-10 text-center text-xs text-[var(--nx-text-secondary)]">
              No pending friend requests.
            </GlassCard>
          ) : (
            requests.map((r) => {
              const peer = r.direction === 'incoming' ? r.sender : r.receiver;
              return (
                <GlassCard
                  key={r.id}
                  intensity="subtle"
                  padding="sm"
                  className="flex items-center justify-between gap-3"
                >
                  <div className="relative z-10 flex items-center gap-3 min-w-0">
                    <ProfileAvatar src={peer.avatarUrl} name={peer.displayName} size="md" cosmicRing />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--nx-text-primary)] truncate">{peer.displayName}</div>
                      <div className="text-xs text-[var(--nx-text-secondary)]">
                        @{peer.username} · {r.direction === 'incoming' ? 'Wants to connect' : 'Outgoing request'}
                      </div>
                    </div>
                  </div>

                  {r.direction === 'incoming' ? (
                    <div className="relative z-10 flex items-center gap-2 shrink-0">
                      <GlassButton
                        type="button"
                        variant="primary"
                        size="sm"
                        soundEvent={false}
                        onClick={() => respondRequest(r.id, 'accept')}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Accept</span>
                      </GlassButton>
                      <GlassButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        soundEvent={false}
                        onClick={() => respondRequest(r.id, 'reject')}
                      >
                        Decline
                      </GlassButton>
                    </div>
                  ) : (
                    <span className="relative z-10 text-xs text-[var(--nx-text-muted)]">Pending</span>
                  )}
                </GlassCard>
              );
            })
          )}
        </div>
      )}

      <AnimatePresence>
        {selectedProfile && (
          <GlassModal onClose={() => setSelectedProfile(null)} maxWidthClass="max-w-sm">
            <div className="flex items-start justify-between">
              <ProfileAvatar
                src={selectedProfile.avatarUrl}
                name={selectedProfile.displayName}
                size="xl"
                isOnline={selectedProfile.isOnline}
                cosmicRing
              />
              <button
                type="button"
                onClick={() => {
                  audioManager.play('ui.glass_close');
                  setSelectedProfile(null);
                }}
                aria-label="Close profile preview"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[var(--nx-surface-hover)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h3 className="text-xl font-display font-bold text-[var(--nx-text-primary)]">{selectedProfile.displayName}</h3>
              <div className="text-sm text-violet-700 dark:text-violet-200 font-medium">@{selectedProfile.username}</div>
              {selectedProfile.bio && (
                <p className="text-xs text-[var(--nx-text-secondary)] mt-2 leading-relaxed">{selectedProfile.bio}</p>
              )}
              {selectedProfile.statusText && (
                <div className="text-xs text-[var(--nx-text-muted)] mt-2">{selectedProfile.statusText}</div>
              )}
            </div>
            {selectedProfile.fingerprint && (
              <div className="p-3.5 rounded-2xl nexora-glass-subtle text-[11px] text-[var(--nx-text-secondary)] space-y-1">
                <div className="flex items-center gap-1.5 text-[var(--nx-text-primary)] font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />
                  <span>Identity Key Fingerprint</span>
                </div>
                <div className="font-mono-tabular text-sky-700 dark:text-sky-200">{selectedProfile.fingerprint}</div>
              </div>
            )}
            <GlassButton
              type="button"
              variant="primary"
              size="lg"
              onClick={() => {
                const uid = selectedProfile.id;
                setSelectedProfile(null);
                onStartChat(uid);
              }}
              className="w-full"
            >
              Open Encrypted Chat
            </GlassButton>
          </GlassModal>
        )}
      </AnimatePresence>
    </div>
  );
}
