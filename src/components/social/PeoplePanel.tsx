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
import { apiRequest } from '../../lib/api';
import { playMagicalSound } from '../../lib/audio';
import { useVisualPrefs } from '../../lib/theme';
import type { FriendItem, FriendRequestItem, PublicUser } from '../../types/nexora';
import { Avatar } from '../ui/Avatar';
import { CosmicLoader, ReactionParticleBurst } from '../ui/MagicalEffects';
import { SearchableContactList } from './SearchableContactList';

interface PeoplePanelProps {
  friends: FriendItem[];
  requests: FriendRequestItem[];
  onStartChat: (userId: string) => void;
  onRefresh: () => void;
}

export function PeoplePanel({ friends, requests, onStartChat, onRefresh }: PeoplePanelProps) {
  const { effectiveReducedMotion, soundEnabled, soundPack } = useVisualPrefs();
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
        playMagicalSound('friend_accept', soundPack, soundEnabled);
      } else {
        setStatusMsg('Connection request sent.');
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
      setStatusMsg('Connection accepted! Encrypted chat & streaks unlocked.');
      setCelebrateKey(Date.now());
      playMagicalSound('friend_accept', soundPack, soundEnabled);
    }
    onRefresh();
  };

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-5 overflow-y-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold text-white">Connections & Discovery</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Find people privately by @username without exposing email addresses.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-900/80 rounded-xl border border-white/10 self-start">
          <button
            type="button"
            onClick={() => setTab('friends')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              tab === 'friends' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Friends ({friends.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('discover')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              tab === 'discover' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Find @username
          </button>
          <button
            type="button"
            onClick={() => setTab('requests')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              tab === 'requests' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Requests {incomingCount > 0 ? `(${incomingCount})` : ''}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {statusMsg && (
          <motion.div
            initial={effectiveReducedMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={effectiveReducedMotion ? undefined : { opacity: 0, y: -6 }}
            className="relative overflow-hidden rounded-xl bg-cyan-500/10 border border-cyan-500/35 px-4 py-2.5 text-xs text-cyan-200 flex items-center justify-between shadow-[0_0_20px_rgba(34,211,238,0.12)]"
          >
            <div className="flex items-center gap-2 relative z-10">
              <span className="relative inline-flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                <ReactionParticleBurst burstKey={celebrateKey} />
              </span>
              <span>{statusMsg}</span>
            </div>
            <button type="button" onClick={() => setStatusMsg(null)} className="cursor-pointer relative z-10">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {tab === 'discover' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by @username or display name (e.g. @ShadowKing)"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          {searching ? (
            <CosmicLoader compact label="Searching NEXORA directory..." />
          ) : results.length === 0 ? (
            <div className="text-xs text-slate-500 py-8 text-center">
              {query.trim() ? 'No matching @usernames found.' : 'Type a @username to search the directory.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {results.map((u) => {
                const isFriend = friends.some((f) => f.user.id === u.id);
                return (
                  <div
                    key={u.id}
                    className="nexora-surface rounded-2xl p-4 flex items-center justify-between gap-3 hover:border-violet-500/35 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedProfile(u)}
                      className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
                    >
                      <Avatar src={u.avatarUrl} name={u.displayName} size="md" isOnline={u.isOnline} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{u.displayName}</div>
                        <div className="text-xs text-slate-400 truncate">@{u.username}</div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isFriend ? (
                        <button
                          type="button"
                          onClick={() => onStartChat(u.id)}
                          className="h-9 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Message</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => sendFriendRequest(u.id)}
                            className="h-9 px-3 rounded-xl bg-violet-600/80 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Add</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onStartChat(u.id)}
                            title="Send chat request"
                            className="h-9 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
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
          onSelectProfile={(user) => setSelectedProfile(user)}
          onSwitchToDiscover={() => setTab('discover')}
        />
      )}

      {tab === 'requests' && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="nexora-surface rounded-2xl p-8 text-center text-xs text-slate-400">
              No pending friend requests.
            </div>
          ) : (
            requests.map((r) => {
              const peer = r.direction === 'incoming' ? r.sender : r.receiver;
              return (
                <div
                  key={r.id}
                  className="nexora-surface rounded-2xl p-4 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar src={peer.avatarUrl} name={peer.displayName} size="md" cosmicRing />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{peer.displayName}</div>
                      <div className="text-xs text-slate-400">
                        @{peer.username} · {r.direction === 'incoming' ? 'Wants to connect' : 'Outgoing request'}
                      </div>
                    </div>
                  </div>

                  {r.direction === 'incoming' ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        type="button"
                        whileHover={effectiveReducedMotion ? undefined : { scale: 1.04 }}
                        whileTap={effectiveReducedMotion ? undefined : { scale: 0.95 }}
                        onClick={() => respondRequest(r.id, 'accept')}
                        className="h-9 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1 shadow-[0_0_12px_rgba(124,58,237,0.35)] cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Accept</span>
                      </motion.button>
                      <button
                        type="button"
                        onClick={() => respondRequest(r.id, 'reject')}
                        className="h-9 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                      >
                        Decline
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">Pending</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <AnimatePresence>
        {selectedProfile && (
          <motion.div
            initial={effectiveReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={effectiveReducedMotion ? undefined : { opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedProfile(null)}
          >
            <motion.div
              initial={effectiveReducedMotion ? false : { scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={effectiveReducedMotion ? undefined : { scale: 0.94, opacity: 0 }}
              transition={
                effectiveReducedMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 360, damping: 28 }
              }
              className="w-full max-w-sm nexora-glass rounded-2xl p-6 space-y-4 border border-violet-400/25 shadow-[0_0_32px_rgba(124,58,237,0.22)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <Avatar
                  src={selectedProfile.avatarUrl}
                  name={selectedProfile.displayName}
                  size="xl"
                  isOnline={selectedProfile.isOnline}
                  cosmicRing
                />
                <button
                  type="button"
                  onClick={() => setSelectedProfile(null)}
                  className="p-2 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div>
                <h3 className="text-xl font-display font-bold text-white">{selectedProfile.displayName}</h3>
                <div className="text-sm text-cyan-300">@{selectedProfile.username}</div>
                {selectedProfile.bio && <p className="text-xs text-slate-300 mt-2">{selectedProfile.bio}</p>}
                <div className="text-xs text-slate-400 mt-2">{selectedProfile.statusText}</div>
              </div>
              {selectedProfile.fingerprint && (
                <div className="p-3 rounded-xl bg-slate-950/70 border border-white/10 text-[11px] text-slate-400 space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Identity Key Fingerprint</span>
                  </div>
                  <div className="font-mono-tabular text-cyan-300">{selectedProfile.fingerprint}</div>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  const uid = selectedProfile.id;
                  setSelectedProfile(null);
                  onStartChat(uid);
                }}
                className="w-full h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
              >
                Open Encrypted Chat
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
