import React, { useState } from 'react';
import { Check, Search, Upload, Users, X } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { apiRequest } from '../../lib/api';
import { createGroupEpochEnvelopes, type StoredLocalKeyBundle } from '../../lib/crypto';
import type { PublicUser } from '../../types/nexora';
import { GlassButton, GlassInput, GlassModal, ProfileAvatar } from '../ui/LiquidGlass';

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

  const totalMemberCount = selectedMembers.length + 1;

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
    audioManager.play('ui.glass_touch');
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
    <GlassModal onClose={onClose} maxWidthClass="max-w-lg">
      <div className="max-h-[82vh] flex flex-col space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-violet-600 dark:text-violet-300" />
            <h3 className="text-lg font-display font-semibold text-[var(--nx-text-primary)]">Create Encrypted Group</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono-tabular text-xs text-sky-600 dark:text-sky-300">
              {totalMemberCount}/{MAX_MEMBERS} members
            </span>
            <button
              type="button"
              onClick={() => {
                audioManager.play('ui.glass_close');
                onClose();
              }}
              aria-label="Close modal"
              className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[var(--nx-surface-hover)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-[16px] bg-rose-500/12 border border-rose-500/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1">
          <div className="flex items-center gap-4">
            <label className="cursor-pointer shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Group avatar" className="w-14 h-14 rounded-full object-cover border border-white/40 dark:border-white/20" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-white/45 dark:bg-white/[0.06] border border-dashed border-slate-400/50 dark:border-white/25 flex items-center justify-center text-[var(--nx-text-secondary)] hover:border-violet-500 transition-colors">
                  <Upload className="w-4 h-4" />
                </div>
              )}
              <input type="file" accept="image/*" onChange={handleAvatar} className="hidden" />
            </label>
            <div className="flex-1 space-y-2">
              <GlassInput
                type="text"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group name"
              />
              <GlassInput
                type="text"
                maxLength={240}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Group description (optional)"
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-[var(--nx-text-secondary)]">Group Privacy</span>
            <div className="flex items-center gap-1 p-1 nexora-glass-subtle rounded-[14px]">
              <button
                type="button"
                onClick={() => {
                  audioManager.play('ui.tab_switch');
                  setPrivacy('private');
                }}
                className={`px-3 py-1 rounded-[10px] transition-colors cursor-pointer ${
                  privacy === 'private'
                    ? 'bg-white/80 dark:bg-white/[0.16] text-slate-900 dark:text-white shadow-sm'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                Private
              </button>
              <button
                type="button"
                onClick={() => {
                  audioManager.play('ui.tab_switch');
                  setPrivacy('invite_only');
                }}
                className={`px-3 py-1 rounded-[10px] transition-colors cursor-pointer ${
                  privacy === 'invite_only'
                    ? 'bg-white/80 dark:bg-white/[0.16] text-slate-900 dark:text-white shadow-sm'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                Invite Only
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <GlassInput
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Add members by @username"
              leadingIcon={<Search className="w-4 h-4" />}
            />

            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/20 border border-violet-500/40 dark:border-violet-300/35 text-xs text-violet-800 dark:text-violet-100 hover:bg-violet-500/35 cursor-pointer"
                  >
                    <span>@{m.username}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}

            <div className="max-h-48 overflow-y-auto space-y-1 pt-1">
              {poolUsers.length === 0 ? (
                <div className="text-xs text-[var(--nx-text-secondary)] py-4 text-center">
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
                      className={`w-full flex items-center gap-3 p-2.5 rounded-[16px] transition-colors text-left cursor-pointer border ${
                        selected
                          ? 'bg-violet-500/18 border-violet-500/45 dark:border-violet-300/35'
                          : 'hover:bg-[var(--nx-surface-hover)] border-transparent'
                      }`}
                    >
                      <ProfileAvatar src={u.avatarUrl} name={u.displayName} size="sm" isOnline={u.isOnline} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--nx-text-primary)] truncate">{u.displayName}</div>
                        <div className="text-xs text-[var(--nx-text-secondary)] truncate">@{u.username}</div>
                      </div>
                      {selected && <Check className="w-4 h-4 text-violet-600 dark:text-sky-300 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <GlassButton
            type="submit"
            variant="primary"
            size="lg"
            soundEvent={false}
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Establishing Group Epoch Keys...' : 'Create Group'}
          </GlassButton>
        </form>
      </div>
    </GlassModal>
  );
}
