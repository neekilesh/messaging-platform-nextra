import React, { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Palette,
  Play,
  Shield,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { NEXORA_SOUND_PACKS, playMagicalSound } from '../../lib/audio';
import type { StoredLocalKeyBundle } from '../../lib/crypto';
import { NEXORA_THEMES, useVisualPrefs } from '../../lib/theme';
import type { AuthUser, DeviceSession, PrivacySettings, PublicUser } from '../../types/nexora';
import { Avatar } from '../ui/Avatar';

interface SettingsPanelProps {
  user: AuthUser;
  myKeys: StoredLocalKeyBundle;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}

export function SettingsPanel({ user, myKeys, onUserUpdated, onLogout }: SettingsPanelProps) {
  const [tab, setTab] = useState<'profile' | 'appearance' | 'privacy' | 'security' | 'blocked' | 'devices'>('profile');
  const {
    theme,
    setTheme,
    reduceEffects,
    setReduceEffects,
    soundEnabled,
    setSoundEnabled,
    soundPack,
    setSoundPack,
  } = useVisualPrefs();

  // Profile state
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [statusText, setStatusText] = useState(user.statusText);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);

  // Privacy state
  const [privacy, setPrivacy] = useState<PrivacySettings>({
    showOnlineStatus: true,
    showReadReceipts: true,
    allowChatRequests: true,
    storyDefaultVisibility: 'friends',
    allowDiscoveryByUsername: true,
  });

  const [blocked, setBlocked] = useState<Array<{ user: PublicUser; blockedAt: string }>>([]);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [copiedAccessKey, setCopiedAccessKey] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savedAccessKey = (() => {
    try {
      return localStorage.getItem(`nexora_access_key_${user.id}`);
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    apiRequest<{ privacy: PrivacySettings }>('/api/v1/users/me/privacy')
      .then((res) => setPrivacy(res.privacy))
      .catch(() => {});
    apiRequest<{ blocked: Array<{ user: PublicUser; blockedAt: string }> }>('/api/v1/users/me/blocked')
      .then((res) => setBlocked(res.blocked))
      .catch(() => {});
    apiRequest<{ devices: DeviceSession[] }>('/api/v1/auth/devices')
      .then((res) => setDevices(res.devices))
      .catch(() => {});
  }, []);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Avatar must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAvatarUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      const res = await apiRequest<{ user: PublicUser }>('/api/v1/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ username, displayName, bio, statusText, avatarUrl }),
      });
      onUserUpdated({ ...user, ...res.user });
      setFeedback('Profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    }
  };

  const updatePrivacy = async (patch: Partial<PrivacySettings>) => {
    const next = { ...privacy, ...patch };
    setPrivacy(next);
    setFeedback(null);
    try {
      const res = await apiRequest<{ privacy: PrivacySettings }>('/api/v1/users/me/privacy', {
        method: 'PATCH',
        body: JSON.stringify(next),
      });
      setPrivacy(res.privacy);
      setFeedback('Privacy settings updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save privacy settings.');
    }
  };

  const unblockUser = async (targetId: string) => {
    await apiRequest(`/api/v1/users/${targetId}/block`, { method: 'DELETE' });
    setBlocked((prev) => prev.filter((b) => b.user.id !== targetId));
    setFeedback('User unblocked.');
  };

  const revokeSession = async (sessionId: string) => {
    await apiRequest(`/api/v1/auth/devices/${sessionId}`, { method: 'DELETE' });
    setDevices((prev) => prev.filter((d) => d.id !== sessionId));
    setFeedback('Device session revoked.');
  };

  return (
    <div className="h-full max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-6 overflow-y-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold text-white">Settings</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Identity, themes, audio experience, privacy preferences, and active sessions.
          </p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="h-9 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 text-xs font-medium inline-flex items-center gap-1.5 self-start cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-900/80 rounded-xl border border-white/10">
        {([
          { id: 'profile', label: 'Profile', icon: User },
          { id: 'appearance', label: 'Themes & Audio', icon: Palette },
          { id: 'privacy', label: 'Privacy', icon: Shield },
          { id: 'security', label: 'Security & E2EE', icon: ShieldCheck },
          { id: 'blocked', label: 'Blocked Users', icon: Ban },
          { id: 'devices', label: 'Devices', icon: Laptop },
        ] as const).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                setError(null);
                setFeedback(null);
              }}
              className={`px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                tab === item.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/30 px-4 py-2.5 text-xs text-cyan-200 flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-2.5 text-xs text-rose-200">
          {error}
        </div>
      )}

      {tab === 'profile' && (
        <form onSubmit={saveProfile} className="nexora-surface rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={displayName} size="xl" />
            <div className="space-y-2">
              <label className="inline-flex items-center gap-2 h-9 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Change Avatar</span>
                <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
              </label>
              <div className="text-xs text-slate-400">
                {user.maskedEmail === 'Instant Pass' || user.maskedEmail === 'NEXORA ID'
                  ? `Instant Device Pass: @${user.username}`
                  : `Google Account: ${user.maskedEmail}`}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Username (7-day cooldown on changes)</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className="w-full h-10 px-3.5 rounded-xl bg-slate-900 border border-white/10 text-sm text-white"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full h-10 px-3.5 rounded-xl bg-slate-900 border border-white/10 text-sm text-white"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Status</label>
            <input
              type="text"
              maxLength={80}
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl bg-slate-900 border border-white/10 text-sm text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Bio</label>
            <textarea
              rows={3}
              maxLength={200}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-slate-900 border border-white/10 text-sm text-white"
            />
          </div>

          <button
            type="submit"
            className="h-10 px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
          >
            Save Profile
          </button>
        </form>
      )}

      {tab === 'appearance' && (
        <div className="space-y-5">
          <div className="nexora-surface rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-cyan-300" />
              <div>
                <h3 className="text-base font-display font-semibold text-white">Magical Galaxy Themes</h3>
                <p className="text-xs text-slate-400">
                  Choose an atmospheric cosmic palette for your stars, aurora waves, and interface glow.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {NEXORA_THEMES.map((t) => {
                const selected = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTheme(t.id);
                      setFeedback(`Theme switched to ${t.name}.`);
                    }}
                    className={`rounded-2xl p-4 text-left border transition-all cursor-pointer space-y-2.5 ${
                      selected
                        ? 'bg-violet-600/20 border-cyan-400/60 shadow-[0_0_20px_rgba(34,211,238,0.16)]'
                        : 'bg-slate-900/60 border-white/10 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {t.swatches.map((hex, i) => (
                          <span
                            key={i}
                            className="w-3.5 h-3.5 rounded-full border border-white/20"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                      {selected && <Check className="w-4 h-4 text-cyan-300" />}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{t.name}</div>
                      <div className="text-[11px] text-slate-400 leading-snug mt-0.5">{t.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audio Experience Section */}
          <section aria-labelledby="audio-experience-heading" className="nexora-surface rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-cyan-300 shrink-0" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-400 shrink-0" />
                )}
                <div>
                  <h3 id="audio-experience-heading" className="text-base font-display font-semibold text-white">
                    Audio Experience
                  </h3>
                  <p className="text-xs text-slate-400">
                    Subtle synthesized chimes for sent messages, incoming notifications, reactions, and connections.
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-label="Toggle magical sound effects"
                aria-checked={soundEnabled}
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  if (next) {
                    playMagicalSound('notification', soundPack, true, true);
                  }
                  setFeedback(next ? 'Magical sound effects enabled.' : 'Magical sound effects muted.');
                }}
                className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                  soundEnabled ? 'bg-violet-600' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    soundEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">Notification Sound Packs</span>
                {!soundEnabled && (
                  <span className="text-[11px] text-slate-500">Muted — enable sound effects to hear live cues</span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {NEXORA_SOUND_PACKS.map((pack) => {
                  const selected = soundPack === pack.id;
                  return (
                    <div
                      key={pack.id}
                      onClick={() => {
                        setSoundPack(pack.id);
                        playMagicalSound('notification', pack.id, soundEnabled, true);
                        setFeedback(`Notification Sound Pack set to ${pack.name}.`);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSoundPack(pack.id);
                          playMagicalSound('notification', pack.id, soundEnabled, true);
                          setFeedback(`Notification Sound Pack set to ${pack.name}.`);
                        }
                      }}
                      className={`rounded-2xl p-4 text-left border transition-all cursor-pointer space-y-2.5 ${
                        selected
                          ? 'bg-violet-600/20 border-cyan-400/60 shadow-[0_0_20px_rgba(34,211,238,0.14)]'
                          : 'bg-slate-900/60 border-white/10 hover:border-white/25'
                      } ${!soundEnabled ? 'opacity-75' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-cyan-300">{pack.toneLabel}</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              playMagicalSound('notification', pack.id, true, true);
                            }}
                            aria-label={`Preview ${pack.name} sound pack`}
                            title={`Preview ${pack.name}`}
                            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                          {selected && <Check className="w-4 h-4 text-cyan-300" />}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{pack.name}</div>
                        <div className="text-[11px] text-slate-400 leading-snug mt-0.5">{pack.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="nexora-surface rounded-2xl p-6 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-white">Reduce Decorative Effects</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Disable shooting stars, cursor glow, particle bursts, and nebula motion while preserving full readability and real encryption indicators.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reduceEffects}
              onClick={() => {
                setReduceEffects(!reduceEffects);
                setFeedback(!reduceEffects ? 'Decorative effects reduced.' : 'Magical effects enabled.');
              }}
              className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                reduceEffects ? 'bg-violet-600' : 'bg-slate-700'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  reduceEffects ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {tab === 'privacy' && (
        <div className="nexora-surface rounded-2xl p-6 space-y-4">
          {([
            {
              key: 'showOnlineStatus',
              title: 'Show Online Presence',
              desc: 'Allow contacts to see when your NEXORA session is active.',
            },
            {
              key: 'showReadReceipts',
              title: 'Read Receipts',
              desc: 'Send read indicators when you open encrypted messages.',
            },
            {
              key: 'allowChatRequests',
              title: 'Allow Direct Chat Requests',
              desc: 'Let people who find your @username initiate a chat request.',
            },
            {
              key: 'allowDiscoveryByUsername',
              title: 'Username Directory Discovery',
              desc: 'Appear in @username search results. Your email address is never shared.',
            },
          ] as const).map((item) => {
            const enabled = privacy[item.key];
            return (
              <div
                key={item.key}
                className="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0"
              >
                <div>
                  <div className="text-sm font-medium text-white">{item.title}</div>
                  <div className="text-xs text-slate-400">{item.desc}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => updatePrivacy({ [item.key]: !enabled })}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
                    enabled ? 'bg-violet-600' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'security' && (
        <div className="nexora-surface rounded-2xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-base font-display font-semibold text-white">Device Identity Key Vault</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Your private ECDH P-256 and ECDSA P-256 keys are stored locally in your browser IndexedDB and protected by a PBKDF2-SHA256 password-encrypted backup. The server never has access to plaintext messages, media, or private keys.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/75 border border-white/10 p-4 space-y-1.5">
            <div className="text-xs text-slate-400">Your Public Key Fingerprint</div>
            <div className="font-mono-tabular text-base text-cyan-300">{myKeys.fingerprint}</div>
          </div>

          {savedAccessKey && (
            <div className="rounded-xl bg-slate-950/75 border border-violet-500/25 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
                  <KeyRound className="w-3.5 h-3.5 text-violet-300" />
                  <span>Instant Pass Recovery Access Key</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(savedAccessKey).catch(() => {});
                    setCopiedAccessKey(true);
                    setTimeout(() => setCopiedAccessKey(false), 1800);
                  }}
                  className="h-7 px-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedAccessKey ? <Check className="w-3 h-3 text-cyan-300" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedAccessKey ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="font-mono-tabular text-xs text-violet-200 break-all">{savedAccessKey}</div>
              <p className="text-[11px] text-slate-400">
                Save this key to reconnect to @{user.username} from another browser without creating an account.
              </p>
            </div>
          )}

          <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-4 text-xs text-amber-100/90 space-y-1">
            <div className="font-semibold">Disappearing Messages & Media Notice</div>
            <p className="text-amber-200/80 leading-relaxed">
              Disappearing timers delete encrypted payloads and media blobs from the server upon expiration. However, no software can prevent a recipient from taking screenshots or capturing external photos before a message expires.
            </p>
          </div>
        </div>
      )}

      {tab === 'blocked' && (
        <div className="nexora-surface rounded-2xl p-6 space-y-3">
          {blocked.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-6">You have not blocked any users.</div>
          ) : (
            blocked.map((b) => (
              <div key={b.user.id} className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <Avatar src={b.user.avatarUrl} name={b.user.displayName} size="sm" />
                  <div>
                    <div className="text-sm font-medium text-white">{b.user.displayName}</div>
                    <div className="text-xs text-slate-400">@{b.user.username}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => unblockUser(b.user.id)}
                  className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
                >
                  Unblock
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'devices' && (
        <div className="nexora-surface rounded-2xl p-6 space-y-3">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-white/5 last:border-0">
              <div className="space-y-0.5">
                <div className="text-sm font-medium text-white flex items-center gap-2">
                  <span>{d.deviceName}</span>
                  {d.isCurrent && <span className="text-xs text-cyan-300">Current session</span>}
                </div>
                <div className="text-xs text-slate-400 font-mono-tabular">
                  {d.platform} · Last active {new Date(d.lastActiveAt).toLocaleString()}
                </div>
              </div>

              {!d.isCurrent && (
                <button
                  type="button"
                  onClick={() => revokeSession(d.id)}
                  className="h-8 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-xs text-rose-200 cursor-pointer"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
