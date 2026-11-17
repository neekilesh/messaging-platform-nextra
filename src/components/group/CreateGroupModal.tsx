import React, { useState } from 'react';
import { Check, Search, Upload, Users, X } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { createGroupEpochEnvelopes, type StoredLocalKeyBundle } from '../../lib/crypto';
import type { PublicUser } from '../../types/nexora';
import { Avatar } from '../ui/Avatar';

interface CreateGroupModalProps {
  currentUserId: string;
  myKeys: StoredLocalKeyBundle;
  friends: PublicUser[];
  onCreated: (conversationId: string) => void;
  onClose: () => void;
}

const MAX_MEMBERS = 25;

export function CreateGroupModal({
  currentUserId,
  myKeys,
  friends,
  onCreated,
  onClose,
}: CreateGroupModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'private' | 'invite_only'>('private');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalMemberCount = selectedMembers.length + 1; // +1 includes creator

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    const clean = q.trim();
    if (!clean) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await apiRequest<{ users: PublicUser[] }>(
        `/api/v1/users/search?q=${encodeURIComponent(clean)}`
      );
      setSearchResults(res.users);
    } catch {
      setSearchResults([]);
    }
  };

  const toggleMember = (user: PublicUser) => {
    setError(null);
    const exists = selectedMembers.some((m) => m.id === user.id);
    if (exists) {
      setSelectedMembers((prev) => prev.filter((m) => m.id !== user.id));
      return;
    }
    if (totalMemberCount >= MAX_MEMBERS) {
      setError(`Maximum group size is ${MAX_MEMBERS} members including you.`);
      return;
    }
    setSelectedMembers((prev) => [...prev, user]);
  };

  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Group picture must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAvatarUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Group name is required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const recipients: Array<{ userId: string; ecdhPublicJwk: string }> = [
        { userId: currentUserId, ecdhPublicJwk: JSON.stringify(myKeys.ecdhPublicJwk) },
      ];
      for (const m of selectedMembers) {
        if (m.ecdhPublicJwk) {
          recipients.push({ userId: m.id, ecdhPublicJwk: m.ecdhPublicJwk });
        }
      }
      const { envelopes } = await createGroupEpochEnvelopes(recipients);

      const res = await apiRequest<{ groupId: string; conversationId: string }>('/api/v1/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          avatarUrl,
          privacy,
          memberIds: selectedMembers.map((m) => m.id),
          epochEnvelopes: envelopes,
        }),
      });

      onCreated(res.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group.');
    } finally {
      setLoading(false);
    }
  };

  const poolUsers = searchQuery.trim() ? searchResults : friends;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg nexora-glass rounded-2xl p-6 space-y-5 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-violet-400" />
            <h3 className="text-lg font-display font-semibold text-white">Create Encrypted Group</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono-tabular text-xs text-cyan-300">
              {totalMemberCount}/{MAX_MEMBERS} members
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="p-2 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2.5 text-xs text-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1">
          <div className="flex items-center gap-4">
            <label className="cursor-pointer shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Group avatar" className="w-14 h-14 rounded-full object-cover border border-white/15" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-slate-900 border border-dashed border-slate-600 flex items-center justify-center text-slate-400 hover:border-violet-400 transition-colors">
                  <Upload className="w-4 h-4" />
                </div>
              )}
              <input type="file" accept="image/*" onChange={handleAvatar} className="hidden" />
            </label>
            <div className="flex-1 space-y-2">
              <input
                type="text"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group name"
                className="w-full h-10 px-3.5 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
              <input
                type="text"
                maxLength={240}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Group description (optional)"
                className="w-full h-9 px-3.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">Group Privacy</span>
            <div className="flex items-center gap-1 p-1 bg-slate-900/80 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setPrivacy('private')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  privacy === 'private' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Private
              </button>
              <button
                type="button"
                onClick={() => setPrivacy('invite_only')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  privacy === 'invite_only' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Invite Only
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Add members by @username"
                className="w-full h-10 pl-9 pr-3.5 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-600/25 border border-violet-500/40 text-xs text-violet-100 hover:bg-violet-600/40 cursor-pointer"
                  >
                    <span>@{m.username}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}

            <div className="max-h-48 overflow-y-auto space-y-1 pt-1">
              {poolUsers.length === 0 ? (
                <div className="text-xs text-slate-500 py-4 text-center">
                  {searchQuery ? 'No matching users found.' : 'Search @username above or add friends first.'}
                </div>
              ) : (
                poolUsers.map((u) => {
                  const selected = selectedMembers.some((m) => m.id === u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleMember(u)}
                      className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors text-left cursor-pointer ${
                        selected ? 'bg-violet-600/20 border border-violet-500/35' : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <Avatar src={u.avatarUrl} name={u.displayName} size="sm" isOnline={u.isOnline} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white truncate">{u.displayName}</div>
                        <div className="text-xs text-slate-400 truncate">@{u.username}</div>
                      </div>
                      {selected && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
          >
            {loading ? 'Establishing Group Epoch Keys...' : 'Create Group'}
          </button>
        </form>
      </div>
    </div>
  );
}
