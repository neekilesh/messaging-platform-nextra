import React, { useEffect, useRef, useState } from 'react';
import {
  Ban,
  BellRing,
  Check,
  ChevronDown,
  Copy,
  Flame,
  Gamepad2,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  MapPin,
  Mic,
  Palette,
  Play,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Upload,
  User,
  Users,
  Vibrate,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { useAudio } from '../../audio/AudioProvider';
import { SIGNATURE_PREVIEW_EVENTS, type SoundEventId } from '../../audio/SoundRegistry';
import {
  createUniformCategoryThemes,
  NEXORA_SOUND_PACKS,
  NEXORA_SOUND_PROFILES,
  NEXORA_SOUND_THEMES,
  NOTIFICATION_CATEGORIES,
  SOUND_THEME_STORAGE_KEY,
  type NotificationCategoryId,
  type SoundThemeId,
} from '../../audio/SoundSettings';
import { apiRequest } from '../../lib/api';
import type { StoredLocalKeyBundle } from '../../lib/crypto';
import {
  NEXORA_THEMES,
  THEME_STORAGE_KEY,
  useVisualPrefs,
  type NexoraThemeId,
  type NexoraThemeMeta,
} from '../../lib/theme';
import type { AuthUser, DeviceSession, PrivacySettings, PublicUser } from '../../types/nexora';
import {
  GlassButton,
  GlassCard,
  GlassInput,
  ProfileAvatar,
  ThemeSelector,
} from '../ui/LiquidGlass';
import { PWAInstallButton } from '../ui/PWAInstallButton';

interface SettingsPanelProps {
  user: AuthUser;
  myKeys: StoredLocalKeyBundle;
  friendsCount?: number;
  activeStreaksCount?: number;
  onOpenExplore?: (target: 'ai' | 'maps' | 'arena3d') => void;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}

type SettingsTabId =
  | 'profile'
  | 'appearance'
  | 'sound'
  | 'privacy'
  | 'security'
  | 'blocked'
  | 'devices';

function GlassSwitch({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onToggle}
      className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 border ${
        checked
          ? 'bg-[#7c5cf6] border-violet-400/50 shadow-[0_2px_10px_rgba(124,92,246,0.35)]'
          : 'bg-slate-400/30 dark:bg-white/15 border-white/50 dark:border-white/10'
      }`}
    >
      <div
        className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function ThemeColorSwatch({
  themeMeta,
  isDark,
  size = 'md',
}: {
  themeMeta: NexoraThemeMeta;
  isDark: boolean;
  size?: 'sm' | 'md';
}) {
  const activeSwatches = isDark ? themeMeta.darkSwatches : themeMeta.swatches;
  const sizeClass = size === 'sm' ? 'w-9 h-6 rounded-[9px]' : 'w-12 h-8 rounded-[10px]';
  const innerRadius = size === 'sm' ? 'rounded-[5px]' : 'rounded-[6px]';

  return (
    <span
      aria-hidden="true"
      data-testid={`theme-swatch-preview-${themeMeta.id}`}
      className={`${sizeClass} border border-white/80 dark:border-white/25 shadow-sm shrink-0 relative overflow-hidden flex items-center justify-center p-1`}
      style={{
        background: `linear-gradient(135deg, ${activeSwatches[0]} 0%, ${activeSwatches[1]} 52%, ${activeSwatches[2]} 100%)`,
      }}
    >
      <span
        className={`w-full h-full ${innerRadius} bg-white/45 dark:bg-white/[0.16] border border-white/65 dark:border-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]`}
      />
    </span>
  );
}

export function SettingsPanel({
  user,
  myKeys,
  friendsCount = 0,
  activeStreaksCount = 0,
  onOpenExplore,
  onUserUpdated,
  onLogout,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTabId>('profile');
  const { theme, themeMeta, isDark, setTheme, reduceEffects, setReduceEffects } = useVisualPrefs();
  const {
    settings: audioSettings,
    updateSettings: updateAudioSettings,
    setProfile,
    setSoundTheme,
    setCategoryTheme,
    preview,
  } = useAudio();

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
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!themeDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setThemeDropdownOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setThemeDropdownOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [themeDropdownOpen]);

  const handleSelectGradientTheme = (nextThemeId: NexoraThemeId) => {
    const chosen = NEXORA_THEMES.find((t) => t.id === nextThemeId);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextThemeId);
    } catch {
      // ignore storage quota errors
    }
    setTheme(nextThemeId);
    audioManager.play('ui.theme_change');
    setFeedback(`Theme switched to ${chosen?.name ?? nextThemeId}.`);
    setThemeDropdownOpen(false);
  };

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
      audioManager.play('message.failed');
      return;
    }
    audioManager.play('media.select');
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
      audioManager.play('ui.settings_saved');
      setFeedback('Profile saved.');
    } catch (err) {
      audioManager.play('message.failed');
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    }
  };

  const updatePrivacy = async (patch: Partial<PrivacySettings>) => {
    const next = { ...privacy, ...patch };
    setPrivacy(next);
    setFeedback(null);
    setError(null);
    try {
      const res = await apiRequest<{ privacy: PrivacySettings }>('/api/v1/users/me/privacy', {
        method: 'PATCH',
        body: JSON.stringify(next),
      });
      setPrivacy(res.privacy);
      audioManager.play('ui.settings_saved');
      setFeedback('Privacy settings updated.');
    } catch (err) {
      audioManager.play('message.failed');
      setError(err instanceof Error ? err.message : 'Failed to save privacy settings.');
    }
  };

  const unblockUser = async (targetId: string) => {
    try {
      await apiRequest(`/api/v1/users/${targetId}/block`, { method: 'DELETE' });
      setBlocked((prev) => prev.filter((b) => b.user.id !== targetId));
      audioManager.play('ui.settings_saved');
      setFeedback('User unblocked.');
    } catch (err) {
      audioManager.play('message.failed');
      setError(err instanceof Error ? err.message : 'Failed to unblock user.');
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await apiRequest(`/api/v1/auth/devices/${sessionId}`, { method: 'DELETE' });
      setDevices((prev) => prev.filter((d) => d.id !== sessionId));
      audioManager.play('ui.settings_saved');
      setFeedback('Device session revoked.');
    } catch (err) {
      audioManager.play('message.failed');
      setError(err instanceof Error ? err.message : 'Failed to revoke session.');
    }
  };

  const shortFingerprint = myKeys.fingerprint.slice(0, 14);
  const volumePercent = Math.round(audioSettings.volume * 100);

  return (
    <div className="h-full max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-5 overflow-y-auto pt-safe pb-24 md:pb-8">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold tracking-tight text-[var(--nx-text-primary)]">
            Profile &amp; Settings
          </h2>
          <p className="text-xs text-[var(--nx-text-secondary)] mt-0.5">
            Identity, Liquid Glass themes, Sound &amp; Haptics, privacy controls, and device keys.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start">
          <PWAInstallButton />
          <GlassButton
            type="button"
            variant="danger"
            size="sm"
            soundEvent="ui.logout"
            onClick={onLogout}
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </GlassButton>
        </div>
      </div>

      {/* Layered Reflective Liquid Glass Profile Hero Card */}
      <GlassCard intensity="elevated" padding="lg" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-20 w-72 h-72 rounded-full bg-violet-500/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-sky-400/15 blur-3xl"
        />

        <div className="relative z-10 space-y-4">
          {/* Nested translucent sub-panel */}
          <div className="rounded-[22px] p-4 sm:p-5 bg-white/35 dark:bg-white/[0.06] border border-white/65 dark:border-white/[0.16] shadow-[inset_0_1px_1px_rgba(255,255,255,0.45)] flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <ProfileAvatar
                src={avatarUrl}
                name={displayName || user.displayName}
                size="xl"
                cosmicRing
                isOnline
              />
              <div className="min-w-0 space-y-1">
                <div className="text-xl font-display font-bold text-[var(--nx-text-primary)] truncate">
                  {displayName || user.displayName}
                </div>
                <div className="text-sm text-violet-700 dark:text-violet-300 font-medium truncate">
                  @{username || user.username}
                </div>
                {statusText && (
                  <div className="text-xs text-[var(--nx-text-secondary)] truncate">{statusText}</div>
                )}
                {bio && (
                  <div className="text-xs text-[var(--nx-text-muted)] line-clamp-1">{bio}</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 sm:gap-6 pt-3 sm:pt-0 border-t sm:border-t-0 border-[var(--nx-border)] shrink-0">
              <div>
                <div className="text-lg font-display font-bold text-[var(--nx-text-primary)] font-mono-tabular tabular-nums flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0" />
                  <span>{friendsCount}</span>
                </div>
                <div className="text-[11px] text-[var(--nx-text-secondary)]">Friends</div>
              </div>
              <div>
                <div className="text-lg font-display font-bold text-[var(--nx-text-primary)] font-mono-tabular tabular-nums flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" />
                  <span>{activeStreaksCount}</span>
                </div>
                <div className="text-[11px] text-[var(--nx-text-secondary)]">Active Streaks</div>
              </div>
              <div>
                <div className="text-sm font-mono-tabular tabular-nums font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1.5 pt-0.5">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[92px]">{shortFingerprint}</span>
                </div>
                <div className="text-[11px] text-[var(--nx-text-secondary)] mt-0.5">E2EE Verified</div>
              </div>
            </div>
          </div>

          {onOpenExplore && (
            <div className="pt-1 flex flex-wrap items-center justify-between gap-2.5">
              <span className="text-xs font-medium text-[var(--nx-text-secondary)]">NEXORA Experiences</span>
              <div className="flex flex-wrap items-center gap-2">
                <GlassButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  soundEvent="ui.glass_touch"
                  onClick={() => onOpenExplore('ai')}
                >
                  <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />
                  <span>AI Studio</span>
                </GlassButton>
                <GlassButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  soundEvent="ui.glass_touch"
                  onClick={() => onOpenExplore('maps')}
                >
                  <MapPin className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />
                  <span>Maps</span>
                </GlassButton>
                <GlassButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  soundEvent="ui.glass_touch"
                  onClick={() => onOpenExplore('arena3d')}
                >
                  <Gamepad2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300" />
                  <span>3D Arena</span>
                </GlassButton>
              </div>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Segmented Navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1.5 nexora-glass-subtle rounded-[20px]">
        {(
          [
            { id: 'profile', label: 'Profile', icon: User },
            { id: 'appearance', label: 'Themes & Glass', icon: Palette },
            { id: 'sound', label: 'Sound & Haptics', icon: Volume2 },
            { id: 'privacy', label: 'Privacy', icon: Shield },
            { id: 'security', label: 'Security & E2EE', icon: ShieldCheck },
            { id: 'blocked', label: 'Blocked Users', icon: Ban },
            { id: 'devices', label: 'Devices', icon: Laptop },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (tab !== item.id) audioManager.play('ui.tab_switch');
                setTab(item.id);
                setError(null);
                setFeedback(null);
              }}
              className={`min-h-[40px] px-3.5 py-2 rounded-[14px] text-xs font-medium inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-white/75 dark:bg-white/[0.16] text-slate-950 dark:text-white border border-white/85 dark:border-white/[0.22] shadow-[inset_0_1px_1px_rgba(255,255,255,0.55),0_4px_12px_rgba(30,24,70,0.08)]'
                  : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className="rounded-[18px] bg-sky-500/12 border border-sky-500/35 dark:border-sky-400/30 px-4 py-2.5 text-xs text-sky-900 dark:text-sky-200 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-300" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div className="rounded-[18px] bg-rose-500/12 border border-rose-500/35 dark:border-rose-400/30 px-4 py-2.5 text-xs text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {tab === 'profile' && (
        <GlassCard intensity="medium" padding="lg">
          <form onSubmit={saveProfile} className="space-y-5 relative z-10">
            <div className="flex flex-wrap items-center gap-4">
              <ProfileAvatar src={avatarUrl} name={displayName} size="lg" />
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 min-h-[40px] px-3.5 rounded-[14px] bg-white/55 hover:bg-white/75 dark:bg-white/[0.08] dark:hover:bg-white/[0.14] border border-white/70 dark:border-white/[0.14] text-xs font-medium text-[var(--nx-text-primary)] cursor-pointer transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Change Avatar</span>
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </label>
                <div className="text-xs text-[var(--nx-text-secondary)]">
                  {user.maskedEmail === 'Instant Pass' || user.maskedEmail === 'NEXORA ID'
                    ? `Instant Device Pass: @${user.username}`
                    : `Google Account: ${user.maskedEmail}`}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--nx-text-secondary)]">
                  Username (7-day cooldown on changes)
                </label>
                <GlassInput
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--nx-text-secondary)]">Display Name</label>
                <GlassInput
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--nx-text-secondary)]">Status</label>
              <GlassInput
                type="text"
                maxLength={80}
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                placeholder="Share a short status..."
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--nx-text-secondary)]">Bio</label>
              <textarea
                rows={3}
                maxLength={200}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full p-3.5 rounded-[16px] bg-[var(--nx-input-bg)] border border-[var(--nx-input-border)] text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] shadow-[inset_0_1px_1px_var(--nx-glass-specular)] focus:outline-none focus:bg-white/75 dark:focus:bg-white/[0.11] focus:border-violet-500/65 dark:focus:border-violet-400/60 transition-all"
              />
            </div>

            <GlassButton type="submit" variant="primary" size="md" soundEvent={false}>
              Save Profile
            </GlassButton>
          </form>
        </GlassCard>
      )}

      {tab === 'appearance' && (
        <div className="space-y-5">
          <GlassCard intensity="medium" padding="lg" className="space-y-4">
            <div className="relative z-30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--nx-border)]">
              <div className="min-w-0">
                <label
                  htmlFor="nexora-theme-dropdown"
                  className="text-sm font-semibold text-[var(--nx-text-primary)] block"
                >
                  Background Gradient Theme
                </label>
                <p className="text-xs text-[var(--nx-text-secondary)] mt-0.5">
                  Preview each gradient swatch and select a persistent backdrop theme across all screens.
                </p>
              </div>

              <div ref={themeDropdownRef} className="relative shrink-0">
                <button
                  id="nexora-theme-dropdown"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={themeDropdownOpen}
                  aria-label="Select gradient background theme"
                  onClick={() => {
                    audioManager.play('ui.glass_touch');
                    setThemeDropdownOpen((open) => !open);
                  }}
                  className="min-h-[42px] min-w-[244px] pl-2.5 pr-3 rounded-[14px] bg-[var(--nx-input-bg)] hover:bg-white/70 dark:hover:bg-white/[0.11] border border-[var(--nx-input-border)] text-xs font-medium text-[var(--nx-text-primary)] shadow-[inset_0_1px_1px_var(--nx-glass-specular)] focus:outline-none focus:ring-2 focus:ring-violet-400/60 cursor-pointer transition-all inline-flex items-center justify-between gap-2.5"
                >
                  <span className="inline-flex items-center gap-2.5 min-w-0">
                    <ThemeColorSwatch themeMeta={themeMeta} isDark={isDark} size="sm" />
                    <span className="truncate">{themeMeta.name}</span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`w-4 h-4 text-[var(--nx-text-secondary)] shrink-0 transition-transform duration-150 ${
                      themeDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {themeDropdownOpen && (
                  <div
                    role="listbox"
                    aria-label="Gradient background theme options"
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        const idx = NEXORA_THEMES.findIndex((item) => item.id === theme);
                        const nextIdx =
                          e.key === 'ArrowDown'
                            ? (idx + 1) % NEXORA_THEMES.length
                            : (idx - 1 + NEXORA_THEMES.length) % NEXORA_THEMES.length;
                        handleSelectGradientTheme(NEXORA_THEMES[nextIdx].id);
                      }
                    }}
                    className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-72 sm:w-80 rounded-[20px] p-1.5 bg-white/95 dark:bg-[#101528]/95 backdrop-blur-2xl border border-white/80 dark:border-white/[0.18] shadow-[0_20px_48px_rgba(20,16,56,0.28)] z-50 space-y-1"
                  >
                    {NEXORA_THEMES.map((t) => {
                      const isSelected = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelectGradientTheme(t.id)}
                          className={`w-full rounded-[14px] px-2.5 py-2 text-left transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-violet-500/16 dark:bg-violet-500/24 border border-violet-500/45 dark:border-violet-300/40'
                              : 'hover:bg-slate-900/5 dark:hover:bg-white/[0.08] border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <ThemeColorSwatch themeMeta={t} isDark={isDark} size="md" />

                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                  {t.name}
                                </span>
                                <span aria-hidden="true" className="inline-flex items-center gap-0.5 shrink-0">
                                  {t.swatches.map((hex, i) => (
                                    <span
                                      key={i}
                                      className="w-2 h-2 rounded-full border border-black/10 dark:border-white/20"
                                      style={{ backgroundColor: hex }}
                                    />
                                  ))}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-300/80 truncate">
                                {t.description}
                              </div>
                            </div>
                          </div>

                          {isSelected && (
                            <Check className="w-4 h-4 text-violet-600 dark:text-sky-300 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="relative z-10">
              <ThemeSelector onSelectFeedback={(msg) => setFeedback(msg)} />
            </div>
          </GlassCard>

          <GlassCard intensity="medium" padding="lg" className="flex items-center justify-between gap-4">
            <div className="relative z-10">
              <div className="text-sm font-semibold text-[var(--nx-text-primary)]">Reduce Decorative Motion</div>
              <div className="text-xs text-[var(--nx-text-secondary)] mt-0.5">
                Simplify spring animations and glass motion while preserving full readability and real encryption indicators.
              </div>
            </div>
            <div className="relative z-10">
              <GlassSwitch
                checked={reduceEffects}
                label="Reduce decorative motion"
                onToggle={() => {
                  const next = !reduceEffects;
                  setReduceEffects(next);
                  audioManager.play('ui.settings_saved');
                  setFeedback(next ? 'Decorative motion reduced.' : 'Full motion enabled.');
                }}
              />
            </div>
          </GlassCard>
        </div>
      )}

      {tab === 'sound' && (
        <div className="space-y-5">
          {/* Master Sound Effects & Volume */}
          <GlassCard intensity="medium" padding="lg" className="space-y-5">
            <div className="relative z-10 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-[14px] bg-white/50 dark:bg-white/[0.08] border border-white/65 dark:border-white/[0.14] flex items-center justify-center shrink-0">
                  {audioSettings.masterEnabled ? (
                    <Volume2 className="w-4 h-4 text-violet-600 dark:text-sky-300" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-[var(--nx-text-muted)]" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)]">
                    Sound Effects
                  </h3>
                  <p className="text-xs text-[var(--nx-text-secondary)]">
                    Master switch for soft Liquid Glass audio feedback across chats, stories, and gestures.
                  </p>
                </div>
              </div>
              <GlassSwitch
                checked={audioSettings.masterEnabled}
                label="Toggle master sound effects"
                onToggle={() => {
                  const next = !audioSettings.masterEnabled;
                  updateAudioSettings({
                    masterEnabled: next,
                    ...(next && audioSettings.profile === 'silent' ? { profile: 'magical' } : {}),
                  });
                  if (next) {
                    preview('notify.private');
                  }
                  setFeedback(next ? 'Sound effects enabled.' : 'Sound effects muted.');
                }}
              />
            </div>

            <div className="relative z-10 pt-3 border-t border-[var(--nx-border)] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--nx-text-primary)] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />
                  <span>Master Volume</span>
                </span>
                <span className="text-xs font-mono-tabular tabular-nums font-semibold text-violet-700 dark:text-sky-300">
                  {volumePercent}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={volumePercent}
                aria-label="Master sound volume"
                onChange={(e) => {
                  const nextVol = Math.min(1, Math.max(0, Number(e.target.value) / 100));
                  updateAudioSettings({ volume: nextVol });
                }}
                onPointerUp={() => preview('ui.glass_touch')}
                onKeyUp={() => preview('ui.glass_touch')}
                className="w-full accent-[#7c5cf6] cursor-pointer"
              />
            </div>
          </GlassCard>

          {/* Sound Theme Dropdown & Acoustic Profiles */}
          <GlassCard intensity="medium" padding="lg" className="space-y-4">
            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--nx-border)]">
              <div className="min-w-0">
                <label
                  htmlFor="nexora-sound-theme-dropdown"
                  className="text-base font-display font-semibold text-[var(--nx-text-primary)] block"
                >
                  Sound Theme &amp; Profiles
                </label>
                <p className="text-xs text-[var(--nx-text-secondary)]">
                  Select a predefined global sound theme (Magical, Balanced, Minimal) or preset profile to update AudioManager settings.
                </p>
              </div>

              <div className="flex flex-col sm:items-end gap-1.5 shrink-0">
                <div className="relative">
                  <select
                    id="nexora-sound-theme-dropdown"
                    aria-label="Select sound theme"
                    value={audioSettings.soundTheme}
                    onChange={(e) => {
                      const nextTheme = e.target.value as SoundThemeId;
                      const chosen = NEXORA_SOUND_THEMES.find((t) => t.id === nextTheme);
                      try {
                        localStorage.setItem(SOUND_THEME_STORAGE_KEY, nextTheme);
                      } catch {
                        // ignore storage quota errors
                      }
                      setSoundTheme(nextTheme);
                      preview('ui.settings_saved', undefined, nextTheme);
                      setFeedback(`Sound theme updated to ${chosen?.name ?? nextTheme}.`);
                    }}
                    className="appearance-none h-10 min-w-[205px] pl-3.5 pr-9 rounded-[14px] bg-[var(--nx-input-bg)] border border-[var(--nx-input-border)] text-xs font-medium text-[var(--nx-text-primary)] shadow-[inset_0_1px_1px_var(--nx-glass-specular)] focus:outline-none focus:border-violet-500/65 dark:focus:border-violet-400/60 cursor-pointer transition-all"
                  >
                    {NEXORA_SOUND_THEMES.map((t) => (
                      <option
                        key={t.id}
                        value={t.id}
                        className="bg-white text-slate-900 dark:bg-[#111528] dark:text-slate-100"
                      >
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none w-4 h-4 text-[var(--nx-text-secondary)] absolute right-3 top-1/2 -translate-y-1/2"
                  />
                </div>
                <span className="text-[11px] text-[var(--nx-text-secondary)] max-w-[260px] sm:text-right leading-snug">
                  {NEXORA_SOUND_THEMES.find((t) => t.id === audioSettings.soundTheme)?.description}
                </span>
              </div>
            </div>

            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {NEXORA_SOUND_PROFILES.map((p) => {
                const selected = audioSettings.profile === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProfile(p.id);
                      if (p.id !== 'silent') {
                        preview('ui.settings_saved');
                      }
                      setFeedback(`Sound profile set to ${p.name}.`);
                    }}
                    className={`rounded-[18px] p-3.5 text-left border transition-all cursor-pointer space-y-1.5 ${
                      selected
                        ? 'bg-violet-500/18 dark:bg-violet-500/20 border-violet-500/60 dark:border-violet-300/50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]'
                        : 'bg-white/40 dark:bg-white/[0.04] border-white/65 dark:border-white/[0.1] hover:border-violet-400/50 dark:hover:border-white/[0.22]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--nx-text-primary)]">{p.name}</span>
                      {selected && <Check className="w-4 h-4 text-violet-600 dark:text-sky-300 shrink-0" />}
                    </div>
                    <p className="text-[11px] text-[var(--nx-text-secondary)] leading-snug">{p.description}</p>
                  </button>
                );
              })}
            </div>
          </GlassCard>

          {/* 5 Sound Packs with Preview */}
          <GlassCard intensity="medium" padding="lg" className="space-y-4">
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)]">
                  Sound Packs
                </h3>
                <p className="text-xs text-[var(--nx-text-secondary)]">
                  Select a tonal character or preview any pack live.
                </p>
              </div>
              {!audioSettings.masterEnabled && (
                <span className="text-[11px] text-[var(--nx-text-muted)]">
                  Master audio muted — Preview still auditions live
                </span>
              )}
            </div>

            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {NEXORA_SOUND_PACKS.map((pack) => {
                const selected = audioSettings.soundPack === pack.id;
                return (
                  <div
                    key={pack.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      updateAudioSettings({ soundPack: pack.id });
                      if (pack.id !== 'silent') {
                        preview('notify.friend_accepted', pack.id);
                      }
                      setFeedback(`Sound pack switched to ${pack.name}.`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        updateAudioSettings({ soundPack: pack.id });
                        if (pack.id !== 'silent') {
                          preview('notify.friend_accepted', pack.id);
                        }
                        setFeedback(`Sound pack switched to ${pack.name}.`);
                      }
                    }}
                    className={`rounded-[18px] p-4 text-left border transition-all cursor-pointer space-y-2.5 ${
                      selected
                        ? 'bg-violet-500/18 dark:bg-violet-500/20 border-violet-500/60 dark:border-violet-300/50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]'
                        : 'bg-white/40 dark:bg-white/[0.04] border-white/65 dark:border-white/[0.1] hover:border-violet-400/50 dark:hover:border-white/[0.22]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-violet-700 dark:text-sky-300">
                        {pack.toneLabel}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            preview('notify.friend_accepted', pack.id);
                          }}
                          aria-label={`Preview ${pack.name} sound pack`}
                          title={`Preview ${pack.name}`}
                          className="min-w-[32px] min-h-[32px] px-2 rounded-full bg-white/65 hover:bg-white/90 dark:bg-white/10 dark:hover:bg-white/20 border border-white/70 dark:border-white/15 text-[var(--nx-text-primary)] inline-flex items-center justify-center gap-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Play className="w-3 h-3" />
                          <span>Preview</span>
                        </button>
                        {selected && <Check className="w-4 h-4 text-violet-600 dark:text-sky-300 shrink-0" />}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[var(--nx-text-primary)]">{pack.name}</div>
                      <div className="text-[11px] text-[var(--nx-text-secondary)] leading-snug mt-0.5">
                        {pack.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>

          {/* Notification Categories, Sound Themes & Haptics */}
          <GlassCard intensity="medium" padding="lg" className="space-y-3">
            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
              <div>
                <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)]">
                  Notification Categories &amp; Sound Themes
                </h3>
                <p className="text-xs text-[var(--nx-text-secondary)]">
                  Choose <span className="font-medium text-[var(--nx-text-primary)]">Magical</span>,{' '}
                  <span className="font-medium text-[var(--nx-text-primary)]">Balanced</span>, or{' '}
                  <span className="font-medium text-[var(--nx-text-primary)]">Minimal</span> for each category and control toggles.
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                <span className="text-[11px] text-[var(--nx-text-muted)] mr-0.5">All:</span>
                {NEXORA_SOUND_THEMES.map((themeOption) => (
                  <button
                    key={themeOption.id}
                    type="button"
                    onClick={() => {
                      updateAudioSettings({
                        categoryThemes: createUniformCategoryThemes(themeOption.id),
                      });
                      preview('notify.private', undefined, themeOption.id);
                      setFeedback(`All notification categories set to ${themeOption.name} theme.`);
                    }}
                    className="min-h-[30px] px-2.5 rounded-[10px] text-[11px] font-medium bg-white/55 hover:bg-white/85 dark:bg-white/[0.08] dark:hover:bg-white/[0.15] border border-white/70 dark:border-white/[0.14] text-[var(--nx-text-primary)] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {themeOption.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative z-10 divide-y divide-[var(--nx-border)]">
              {(
                [
                  { id: 'notifications', icon: Volume2, sample: 'notify.private' },
                  { id: 'messages', icon: BellRing, sample: 'message.send' },
                  { id: 'stories', icon: Play, sample: 'story.open' },
                  { id: 'achievements', icon: Flame, sample: 'achievement.streak_milestone' },
                  { id: 'voiceUi', icon: Mic, sample: 'voice.record_start' },
                  { id: 'ui', icon: Sparkles, sample: 'ui.glass_touch' },
                ] as Array<{
                  id: NotificationCategoryId;
                  icon: React.ComponentType<{ className?: string }>;
                  sample: SoundEventId;
                }>
              ).map((entry) => {
                const meta = NOTIFICATION_CATEGORIES.find((c) => c.id === entry.id)!;
                const Icon = entry.icon;
                const enabled = audioSettings[meta.settingKey];
                const activeTheme = audioSettings.categoryThemes[entry.id] ?? 'magical';

                return (
                  <div
                    key={meta.id}
                    className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--nx-text-primary)]">{meta.title}</div>
                        <div className="text-xs text-[var(--nx-text-secondary)]">{meta.description}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-2.5 shrink-0 pl-7 md:pl-0">
                      <div
                        role="radiogroup"
                        aria-label={`${meta.title} sound theme`}
                        className="inline-flex items-center gap-1 p-1 rounded-[12px] bg-white/45 dark:bg-white/[0.06] border border-white/65 dark:border-white/[0.12]"
                      >
                        {NEXORA_SOUND_THEMES.map((themeOption) => {
                          const isSelected = activeTheme === themeOption.id;
                          return (
                            <button
                              key={themeOption.id}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              onClick={() => {
                                setCategoryTheme(meta.id, themeOption.id);
                                preview(entry.sample, undefined, themeOption.id);
                                setFeedback(`${meta.title} theme set to ${themeOption.name}.`);
                              }}
                              title={themeOption.description}
                              className={`min-h-[30px] px-2.5 rounded-[9px] text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                                isSelected
                                  ? 'bg-[#7c5cf6] text-white shadow-sm'
                                  : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                              }`}
                            >
                              {themeOption.name}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => preview(entry.sample, undefined, activeTheme)}
                        aria-label={`Preview ${meta.title} sound`}
                        title={`Preview ${meta.title} (${activeTheme})`}
                        className="w-8 h-8 rounded-full bg-white/60 hover:bg-white/85 dark:bg-white/[0.08] dark:hover:bg-white/[0.16] border border-white/70 dark:border-white/15 text-[var(--nx-text-primary)] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                      >
                        <Play className="w-3 h-3" />
                      </button>

                      <GlassSwitch
                        checked={enabled}
                        label={meta.title}
                        onToggle={() => {
                          const next = !enabled;
                          updateAudioSettings({ [meta.settingKey]: next });
                          if (next) {
                            preview(entry.sample, undefined, activeTheme);
                          }
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              {(
                [
                  {
                    key: 'readSoundEnabled',
                    title: 'Read Receipt Sound',
                    desc: 'Whisper-quiet confirmation tone when an outgoing message is verified read.',
                    icon: Check,
                    sample: 'message.read' as SoundEventId,
                    theme: audioSettings.categoryThemes.messages,
                  },
                  {
                    key: 'hapticsEnabled',
                    title: 'Haptic Vibration',
                    desc: 'Micro tactile vibration on supported mobile browsers during taps & gestures.',
                    icon: Vibrate,
                    sample: 'ui.glass_touch' as SoundEventId,
                    theme: audioSettings.categoryThemes.ui,
                  },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const enabled = audioSettings[item.key];
                return (
                  <div key={item.key} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--nx-text-primary)]">{item.title}</div>
                        <div className="text-xs text-[var(--nx-text-secondary)]">{item.desc}</div>
                      </div>
                    </div>
                    <GlassSwitch
                      checked={enabled}
                      label={item.title}
                      onToggle={() => {
                        const next = !enabled;
                        updateAudioSettings({ [item.key]: next });
                        if (next) {
                          preview(item.sample, undefined, item.theme);
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </GlassCard>

          {/* 5 Signature Sound Preview Deck */}
          <GlassCard intensity="medium" padding="lg" className="space-y-4">
            <div className="relative z-10">
              <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)]">
                NEXORA Signature Audio Palette
              </h3>
              <p className="text-xs text-[var(--nx-text-secondary)]">
                Audition the 5 custom Web Audio synthesized signature cues crafted for NEXORA.
              </p>
            </div>

            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {SIGNATURE_PREVIEW_EVENTS.map((sig) => (
                <GlassButton
                  key={sig.id}
                  type="button"
                  variant="secondary"
                  size="md"
                  soundEvent={false}
                  onClick={() => preview(sig.id)}
                  className="justify-between h-auto py-2.5 px-3.5 text-left w-full"
                >
                  <div className="min-w-0 text-left">
                    <div className="text-xs font-semibold text-[var(--nx-text-primary)] truncate">
                      {sig.label}
                    </div>
                    <div className="text-[10px] text-[var(--nx-text-secondary)] truncate">{sig.subtitle}</div>
                  </div>
                  <Play className="w-3.5 h-3.5 text-violet-600 dark:text-sky-300 shrink-0" />
                </GlassButton>
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {tab === 'privacy' && (
        <GlassCard intensity="medium" padding="lg" className="space-y-1">
          <div className="relative z-10 divide-y divide-[var(--nx-border)]">
            {(
              [
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
              ] as const
            ).map((item) => {
              const enabled = privacy[item.key];
              return (
                <div key={item.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-[var(--nx-text-primary)]">{item.title}</div>
                    <div className="text-xs text-[var(--nx-text-secondary)]">{item.desc}</div>
                  </div>
                  <GlassSwitch
                    checked={enabled}
                    label={item.title}
                    onToggle={() => updatePrivacy({ [item.key]: !enabled })}
                  />
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {tab === 'security' && (
        <GlassCard intensity="medium" padding="lg" className="space-y-5">
          <div className="relative z-10 flex items-start gap-3">
            <Lock className="w-5 h-5 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)]">
                Device Identity Key Vault
              </h3>
              <p className="text-xs text-[var(--nx-text-secondary)] leading-relaxed">
                Your private ECDH P-256 and ECDSA P-256 keys are stored locally in your browser IndexedDB and protected by a PBKDF2-SHA256 encrypted backup. The server never has access to plaintext messages, media, or private keys.
              </p>
            </div>
          </div>

          <div className="relative z-10 rounded-[18px] bg-white/45 dark:bg-black/35 border border-white/65 dark:border-white/[0.1] p-4 space-y-1.5">
            <div className="text-xs text-[var(--nx-text-secondary)]">Your Public Key Fingerprint</div>
            <div className="font-mono-tabular tabular-nums text-base font-semibold text-sky-700 dark:text-sky-300">
              {myKeys.fingerprint}
            </div>
          </div>

          {savedAccessKey && (
            <div className="relative z-10 rounded-[18px] bg-white/45 dark:bg-black/35 border border-violet-500/35 dark:border-violet-400/25 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-primary)]">
                  <KeyRound className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />
                  <span>Instant Pass Recovery Access Key</span>
                </div>
                <GlassButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  soundEvent="message.copy"
                  onClick={() => {
                    navigator.clipboard?.writeText(savedAccessKey).catch(() => {});
                    setCopiedAccessKey(true);
                    setTimeout(() => setCopiedAccessKey(false), 1800);
                  }}
                >
                  {copiedAccessKey ? (
                    <Check className="w-3 h-3 text-sky-600 dark:text-sky-300" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedAccessKey ? 'Copied' : 'Copy'}</span>
                </GlassButton>
              </div>
              <div className="font-mono-tabular text-xs text-violet-800 dark:text-violet-200 break-all">
                {savedAccessKey}
              </div>
              <p className="text-[11px] text-[var(--nx-text-secondary)]">
                Save this key to reconnect to @{user.username} from another browser without creating an account.
              </p>
            </div>
          )}

          <div className="relative z-10 rounded-[18px] bg-amber-500/12 border border-amber-500/35 dark:border-amber-400/25 p-4 text-xs text-amber-950 dark:text-amber-100/90 space-y-1">
            <div className="font-semibold">Disappearing Messages &amp; Media Notice</div>
            <p className="text-amber-900/85 dark:text-amber-200/80 leading-relaxed">
              Disappearing timers delete encrypted payloads and media blobs from the server upon expiration. However, no software can prevent a recipient from taking screenshots or capturing external photos before a message expires.
            </p>
          </div>
        </GlassCard>
      )}

      {tab === 'blocked' && (
        <GlassCard intensity="medium" padding="lg" className="space-y-3">
          <div className="relative z-10 divide-y divide-[var(--nx-border)]">
            {blocked.length === 0 ? (
              <div className="text-xs text-[var(--nx-text-secondary)] text-center py-6">
                You have not blocked any users.
              </div>
            ) : (
              blocked.map((b) => (
                <div key={b.user.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <ProfileAvatar src={b.user.avatarUrl} name={b.user.displayName} size="sm" />
                    <div>
                      <div className="text-sm font-medium text-[var(--nx-text-primary)]">
                        {b.user.displayName}
                      </div>
                      <div className="text-xs text-[var(--nx-text-secondary)]">@{b.user.username}</div>
                    </div>
                  </div>
                  <GlassButton
                    type="button"
                    variant="secondary"
                    size="sm"
                    soundEvent={false}
                    onClick={() => unblockUser(b.user.id)}
                  >
                    Unblock
                  </GlassButton>
                </div>
              ))
            )}
          </div>
        </GlassCard>
      )}

      {tab === 'devices' && (
        <GlassCard intensity="medium" padding="lg" className="space-y-3">
          <div className="relative z-10 divide-y divide-[var(--nx-border)]">
            {devices.length === 0 ? (
              <div className="text-xs text-[var(--nx-text-secondary)] text-center py-6">
                No active device sessions found.
              </div>
            ) : (
              devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-[var(--nx-text-primary)] flex items-center gap-2">
                      <span>{d.deviceName}</span>
                      {d.isCurrent && (
                        <span className="text-xs font-semibold text-sky-700 dark:text-sky-300">
                          Current session
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--nx-text-secondary)] font-mono-tabular tabular-nums">
                      {d.platform} · Last active {new Date(d.lastActiveAt).toLocaleString()}
                    </div>
                  </div>

                  {!d.isCurrent && (
                    <GlassButton
                      type="button"
                      variant="danger"
                      size="sm"
                      soundEvent={false}
                      onClick={() => revokeSession(d.id)}
                    >
                      Revoke
                    </GlassButton>
                  )}
                </div>
              ))
            )}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
