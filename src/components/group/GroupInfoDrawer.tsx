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
import { apiRequest } from '../../lib/api';
import { createGroupEpochEnvelopes, type StoredLocalKeyBundle } from '../../lib/crypto';
import type { GroupDetails, MessageRecord, PublicUser } from '../../types/nexora';
import { Avatar } from '../ui/Avatar';

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
        onLeftOrDeleted();
      } else {
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
    <aside className="w-full sm:w-96 border-l border-white/10 bg-[#0b0f1f]/95 backdrop-blur-xl flex flex-col h-full shrink-0">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <h3 className="text-base font-display font-semibold text-white">Group Information</h3>
          {group && (
            <div className="text-xs text-slate-400 font-mono-tabular">
              {group.memberCount}/{group.maxMembers} members · Epoch {group.currentEpoch}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close group info"
          className="p-2 text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {group && (
        <>
          <div className="p-5 border-b border-white/10 flex items-center gap-4">
            <Avatar src={group.avatarUrl} name={group.name} size="lg" isGroup />
            <div className="min-w-0">
              <div className="text-base font-display font-semibold text-white truncate">{group.name}</div>
              <div className="text-xs text-slate-400 line-clamp-2 mt-0.5">
                {group.description || 'End-to-end encrypted group'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 p-2 border-b border-white/10">
            {(['members', 'media', 'settings'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-medium rounded-lg capitalize transition-colors cursor-pointer ${
                  tab === t ? 'bg-violet-600/25 text-violet-200' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {tab === 'members' && (
              <>
                {isAdminOrOwner && group.memberCount < group.maxMembers && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQ}
                        onChange={(e) => handleSearchUsers(e.target.value)}
                        placeholder="Add member by @username"
                        className="w-full h-9 pl-8 pr-3 rounded-xl bg-slate-900/90 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                      />
                    </div>
                    {searchResults.length > 0 && (
                      <div className="space-y-1 bg-slate-900/90 rounded-xl p-1.5 border border-white/10">
                        {searchResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            disabled={busy}
                            onClick={() => handleAddMember(u)}
                            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/5 text-left cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar src={u.avatarUrl} name={u.displayName} size="xs" />
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-white truncate">{u.displayName}</div>
                                <div className="text-[11px] text-slate-400 truncate">@{u.username}</div>
                              </div>
                            </div>
                            <UserPlus className="w-4 h-4 text-cyan-400 shrink-0" />
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
                      className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900/50 border border-white/5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar src={m.avatarUrl} name={m.displayName} size="sm" isOnline={m.isOnline} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white truncate flex items-center gap-1.5">
                            <span>{m.displayName}</span>
                            {m.role === 'owner' && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                            {m.role === 'admin' && <Shield className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                          </div>
                          <div className="text-xs text-slate-400 truncate">
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
                            className="px-2 py-1 rounded-lg text-[11px] bg-white/5 hover:bg-white/10 text-slate-300 cursor-pointer"
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
                              className="p-1.5 rounded-lg text-rose-300 hover:bg-rose-500/15 cursor-pointer"
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
                  <div className="text-center py-10 text-xs text-slate-500 space-y-2">
                    <ImageIcon className="w-6 h-6 mx-auto opacity-50" />
                    <div>No encrypted media shared in this group yet.</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mediaItems.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="text-slate-200 font-medium truncate">
                            {m.localDecrypted?.fileName || `${m.kind} attachment`}
                          </div>
                          <div className="text-slate-500">
                            @{m.senderUsername} · {new Date(m.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <span className="text-[11px] text-cyan-300 capitalize">{m.kind}</span>
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
                      <label className="text-xs text-slate-400">Group Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full h-9 px-3 rounded-xl bg-slate-900 border border-white/10 text-sm text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-400">Description</label>
                      <textarea
                        rows={2}
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full p-3 rounded-xl bg-slate-900 border border-white/10 text-xs text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
                    >
                      Save Group Details
                    </button>
                  </form>
                )}

                <div className="pt-3 border-t border-white/10 space-y-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRemoveOrLeave(currentUserId)}
                    className="w-full h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Leave Group</span>
                  </button>

                  {myRole === 'owner' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleDeleteGroup}
                      className="w-full h-10 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Group Permanently</span>
                    </button>
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
