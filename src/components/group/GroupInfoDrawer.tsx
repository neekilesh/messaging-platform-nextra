import React, { useEffect, useState } from 'react';
import {
  Crown,
  Image as ImageIcon,
  LogOut,
  Search,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { apiRequest } from '../../lib/api';
import { createGroupEpochEnvelopes, type StoredLocalKeyBundle } from '../../lib/crypto';
import type { GroupDetails, MessageRecord, PublicUser } from '../../types/nexora';
import { GlassButton, GlassInput, ProfileAvatar } from '../ui/LiquidGlass';

interface GroupInfoDrawerProps {
  groupId: string;
  currentUserId: string;
  myKeys: StoredLocalKeyBundle;
  messages: MessageRecord[];
  onClose: () => void;
  onRefresh: () => void;
  onLeftOrDeleted: () => void;
}

export function GroupInfoDrawer({
  groupId,
  currentUserId,
  myKeys,
  messages,
  onClose,
  onRefresh,
  onLeftOrDeleted,
}: GroupInfoDrawerProps) {
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [tab, setTab] = useState<'members' | 'media' | 'settings'>('members');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGroup = async () => {
    try {
      const res = await apiRequest<{ group: GroupDetails }>(`/api/v1/groups/${groupId}`);
      setGroup(res.group);
      setEditName(res.group.name);
      setEditDesc(res.group.description);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load group details.');
    }
  };

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  const myRole = group?.members.find((m) => m.userId === currentUserId)?.role;
  const isAdminOrOwner = myRole === 'owner' || myRole === 'admin';

  const handleSearchUsers = async (q: string) => {
    setSearchQ(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await apiRequest<{ users: PublicUser[] }>(`/api/v1/users/search?q=${encodeURIComponent(q.trim())}`);
      const memberIds = new Set(group?.members.map((m) => m.userId) || []);
      setSearchResults(res.users.filter((u) => !memberIds.has(u.id)));
    } catch {
      setSearchResults([]);
    }
  };

  const buildRotatedEnvelopes = async (targetMembers: Array<{ userId: string; ecdhPublicJwk: string | null }>) => {
    const valid = targetMembers
      .map((m) => ({
        userId: m.userId,
        ecdhPublicJwk:
          m.userId === currentUserId ? JSON.stringify(myKeys.ecdhPublicJwk) : m.ecdhPublicJwk || '',
      }))
      .filter((m) => Boolean(m.ecdhPublicJwk));

    const { envelopes } = await createGroupEpochEnvelopes(valid);
    return envelopes;
  };

  const handleAddMember = async (user: PublicUser) => {
    if (!group) return;
    if (group.memberCount >= group.maxMembers) {
      setError(`Group is full (${group.maxMembers} members max).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextMembers = [
        ...group.members.map((m) => ({ userId: m.userId, ecdhPublicJwk: m.ecdhPublicJwk })),
        { userId: user.id, ecdhPublicJwk: user.ecdhPublicJwk },
      ];
      const envelopes = await buildRotatedEnvelopes(nextMembers);

      await apiRequest(`/api/v1/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, epochEnvelopes: envelopes }),
      });

      audioManager.play('group.member_add');
      setSearchQ('');
      setSearchResults([]);
      await loadGroup();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveOrLeave = async (targetUserId: string) => {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const remaining = group.members
        .filter((m) => m.userId !== targetUserId)
        .map((m) => ({ userId: m.userId, ecdhPublicJwk: m.ecdhPublicJwk }));
      const envelopes = remaining.length > 0 ? await buildRotatedEnvelopes(remaining) : [];

      await apiRequest(`/api/v1/groups/${groupId}/members/${targetUserId}`, {
        method: 'DELETE',
        body: JSON.stringify({ epochEnvelopes: envelopes }),
      });

      if (targetUserId === currentUserId) {
        audioManager.play('group.leave');
        onLeftOrDeleted();
      } else {
        audioManager.play('group.member_remove');
        await loadGroup();
        onRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRole = async (userId: string, currentRole: 'admin' | 'member') => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/groups/${groupId}/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: currentRole === 'admin' ? 'member' : 'admin' }),
      });
      audioManager.play('group.settings_updated');
      await loadGroup();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change role.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName, description: editDesc }),
      });
      audioManager.play('group.settings_updated');
      await loadGroup();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save group info.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGroup = async () => {
    setBusy(true);
    try {
      await apiRequest(`/api/v1/groups/${groupId}`, { method: 'DELETE' });
      audioManager.play('group.leave');
      onLeftOrDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group.');
      setBusy(false);
    }
  };

  const mediaItems = messages.filter(
    (m) => !m.deletedForEveryone && m.attachmentId && ['image', 'video', 'voice', 'file'].includes(m.kind)
  );

  return (
    <aside className="w-full sm:w-96 nexora-glass-elevated border-y-0 border-r-0 flex flex-col h-full shrink-0">
      <div className="relative z-10 px-5 py-4 border-b border-[var(--nx-hairline)] flex items-center justify-between">
        <div>
          <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)]">Group Information</h3>
          {group && (
            <div className="text-xs text-[var(--nx-text-secondary)] font-mono-tabular">
              {group.memberCount}/{group.maxMembers} members · Epoch {group.currentEpoch}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            audioManager.play('ui.glass_close');
            onClose();
          }}
          aria-label="Close group info"
          className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[var(--nx-surface-hover)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="relative z-10 mx-4 mt-3 rounded-[16px] bg-rose-500/12 border border-rose-500/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {group && (
        <>
          <div className="relative z-10 p-5 border-b border-[var(--nx-hairline)] flex items-center gap-4">
            <ProfileAvatar src={group.avatarUrl} name={group.name} size="lg" isGroup />
            <div className="min-w-0">
              <div className="text-base font-display font-semibold text-[var(--nx-text-primary)] truncate">{group.name}</div>
              <div className="text-xs text-[var(--nx-text-secondary)] line-clamp-2 mt-0.5">
                {group.description || 'End-to-end encrypted group'}
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-1 p-2 border-b border-[var(--nx-hairline)]">
            {(['members', 'media', 'settings'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  audioManager.play('ui.tab_switch');
                  setTab(t);
                }}
                className={`flex-1 py-2 text-xs font-medium rounded-[12px] capitalize transition-colors cursor-pointer ${
                  tab === t
                    ? 'bg-white/75 dark:bg-white/[0.15] text-slate-900 dark:text-white shadow-sm'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="relative z-10 flex-1 overflow-y-auto p-4 space-y-4">
            {tab === 'members' && (
              <>
                {isAdminOrOwner && group.memberCount < group.maxMembers && (
                  <div className="space-y-2">
                    <GlassInput
                      type="text"
                      value={searchQ}
                      onChange={(e) => handleSearchUsers(e.target.value)}
                      placeholder="Add member by @username"
                      leadingIcon={<Search className="w-3.5 h-3.5" />}
                      className="h-9 text-xs"
                    />
                    {searchResults.length > 0 && (
                      <div className="space-y-1 nexora-glass-subtle rounded-[16px] p-1.5">
                        {searchResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            disabled={busy}
                            onClick={() => handleAddMember(u)}
                            className="w-full flex items-center justify-between p-2 rounded-[12px] hover:bg-[var(--nx-surface-hover)] text-left cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <ProfileAvatar src={u.avatarUrl} name={u.displayName} size="xs" />
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-[var(--nx-text-primary)] truncate">{u.displayName}</div>
                                <div className="text-[11px] text-[var(--nx-text-secondary)] truncate">@{u.username}</div>
                              </div>
                            </div>
                            <UserPlus className="w-4 h-4 text-violet-600 dark:text-sky-300 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  {group.members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-[16px] nexora-glass-subtle"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ProfileAvatar src={m.avatarUrl} name={m.displayName} size="sm" isOnline={m.isOnline} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--nx-text-primary)] truncate flex items-center gap-1.5">
                            <span>{m.displayName}</span>
                            {m.role === 'owner' && <Crown className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 shrink-0" />}
                            {m.role === 'admin' && <Shield className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300 shrink-0" />}
                          </div>
                          <div className="text-xs text-[var(--nx-text-secondary)] truncate">
                            @{m.username} · {m.role} · Epoch {m.joinedEpoch}+
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {myRole === 'owner' && m.userId !== currentUserId && m.role !== 'owner' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleRole(m.userId, m.role === 'admin' ? 'admin' : 'member')}
                            title={m.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
                            className="px-2 py-1 rounded-[10px] text-[11px] bg-white/60 dark:bg-white/[0.08] hover:bg-white/80 dark:hover:bg-white/[0.14] text-[var(--nx-text-primary)] cursor-pointer"
                          >
                            {m.role === 'admin' ? 'Demote' : 'Admin'}
                          </button>
                        )}
                        {isAdminOrOwner &&
                          m.userId !== currentUserId &&
                          m.role !== 'owner' &&
                          !(myRole === 'admin' && m.role === 'admin') && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRemoveOrLeave(m.userId)}
                              title="Remove member and rotate group key"
                              aria-label={`Remove ${m.username}`}
                              className="p-1.5 rounded-[10px] text-rose-600 dark:text-rose-300 hover:bg-rose-500/15 cursor-pointer"
                            >
                              <UserMinus className="w-4 h-4" />
                            </button>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === 'media' && (
              <div className="space-y-2">
                {mediaItems.length === 0 ? (
                  <div className="text-center py-10 text-xs text-[var(--nx-text-secondary)] space-y-2">
                    <ImageIcon className="w-6 h-6 mx-auto opacity-50" />
                    <div>No encrypted media shared in this group yet.</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mediaItems.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-2.5 rounded-[16px] nexora-glass-subtle text-xs"
                      >
                        <div className="min-w-0">
                          <div className="text-[var(--nx-text-primary)] font-medium truncate">
                            {m.localDecrypted?.fileName || `${m.kind} attachment`}
                          </div>
                          <div className="text-[var(--nx-text-secondary)]">
                            @{m.senderUsername} · {new Date(m.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <span className="text-[11px] text-violet-600 dark:text-sky-300 capitalize">{m.kind}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'settings' && (
              <div className="space-y-5">
                {isAdminOrOwner && (
                  <form onSubmit={handleSaveDetails} className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--nx-text-secondary)]">Group Name</label>
                      <GlassInput
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--nx-text-secondary)]">Description</label>
                      <textarea
                        rows={2}
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full p-3 rounded-[16px] bg-white/55 dark:bg-white/[0.06] border border-white/75 dark:border-white/[0.11] text-xs text-[var(--nx-text-primary)] focus:outline-none focus:border-violet-400/60"
                      />
                    </div>
                    <GlassButton
                      type="submit"
                      variant="primary"
                      size="sm"
                      soundEvent={false}
                      disabled={busy}
                      className="w-full"
                    >
                      Save Group Details
                    </GlassButton>
                  </form>
                )}

                <div className="pt-3 border-t border-[var(--nx-hairline)] space-y-2">
                  <GlassButton
                    type="button"
                    variant="secondary"
                    size="md"
                    soundEvent={false}
                    disabled={busy}
                    onClick={() => handleRemoveOrLeave(currentUserId)}
                    className="w-full"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Leave Group</span>
                  </GlassButton>

                  {myRole === 'owner' && (
                    <GlassButton
                      type="button"
                      variant="danger"
                      size="md"
                      soundEvent={false}
                      disabled={busy}
                      onClick={handleDeleteGroup}
                      className="w-full"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Group Permanently</span>
                    </GlassButton>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
