export type SoundPackId =
  | 'nexora-default'
  | 'soft-iphone'
  | 'magical'
  | 'minimal'
  | 'silent';

export type SoundProfileId = 'magical' | 'balanced' | 'minimal' | 'silent';

export type SoundThemeId = 'magical' | 'balanced' | 'minimal';

export type NotificationCategoryId =
  | 'messages'
  | 'notifications'
  | 'stories'
  | 'voiceUi'
  | 'achievements'
  | 'ui';

export type SoundCategory = 'app' | NotificationCategoryId;

export interface SoundPackMeta {
  id: SoundPackId;
  name: string;
  description: string;
  toneLabel: string;
  pitchScale: number;
  gainScale: number;
  wave: OscillatorType;
}

export interface SoundThemeMeta {
  id: SoundThemeId;
  name: string;
  description: string;
  pitchMultiplier: number;
  gainMultiplier: number;
  waveOverride?: OscillatorType;
}

export interface NotificationCategoryMeta {
  id: NotificationCategoryId;
  title: string;
  description: string;
  settingKey:
    | 'messagesEnabled'
    | 'notificationsEnabled'
    | 'storiesEnabled'
    | 'voiceUiEnabled'
    | 'achievementsEnabled'
    | 'uiEnabled';
}

export interface SoundProfileMeta {
  id: SoundProfileId;
  name: string;
  description: string;
}

export type CategoryThemeMap = Record<NotificationCategoryId, SoundThemeId>;

export interface SoundSettings {
  masterEnabled: boolean;
  uiEnabled: boolean;
  messagesEnabled: boolean;
  notificationsEnabled: boolean;
  storiesEnabled: boolean;
  voiceUiEnabled: boolean;
  achievementsEnabled: boolean;
  readSoundEnabled: boolean;
  hapticsEnabled: boolean;
  volume: number; // 0.0 - 1.0
  profile: SoundProfileId;
  soundPack: SoundPackId;
  soundTheme: SoundThemeId;
  categoryThemes: CategoryThemeMap;
}

export const NEXORA_SOUND_THEMES: SoundThemeMeta[] = [
  {
    id: 'magical',
    name: 'Magical',
    description: 'Luminous crystalline harmonics with bright celestial resonance.',
    pitchMultiplier: 1.14,
    gainMultiplier: 1.0,
    waveOverride: 'triangle',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Warm, clear Liquid Glass chimes tuned for everyday clarity.',
    pitchMultiplier: 1.0,
    gainMultiplier: 0.92,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Soft, ultra-clean sine micro-pings for quiet focus.',
    pitchMultiplier: 0.9,
    gainMultiplier: 0.68,
    waveOverride: 'sine',
  },
];

export const NOTIFICATION_CATEGORIES: NotificationCategoryMeta[] = [
  {
    id: 'notifications',
    title: 'Notification Chimes',
    description: 'Incoming chats, friend requests, @mentions, and security alerts.',
    settingKey: 'notificationsEnabled',
  },
  {
    id: 'messages',
    title: 'Messages & Reactions',
    description: 'Sent, received, reply, delivery, and encrypted reaction pulses.',
    settingKey: 'messagesEnabled',
  },
  {
    id: 'stories',
    title: 'Stories',
    description: 'Story open, advance gestures, reactions, and upload cues.',
    settingKey: 'storiesEnabled',
  },
  {
    id: 'achievements',
    title: 'Streaks & Achievements',
    description: 'Friend streak ignitions and milestone celebrations.',
    settingKey: 'achievementsEnabled',
  },
  {
    id: 'voiceUi',
    title: 'Voice Note UI Cues',
    description: 'Pre-record chime and post-recording send tone.',
    settingKey: 'voiceUiEnabled',
  },
  {
    id: 'ui',
    title: 'UI & Glass Feedback',
    description: 'Tactile glass taps, modal transitions, and tab switches.',
    settingKey: 'uiEnabled',
  },
];

export const NEXORA_SOUND_PACKS: SoundPackMeta[] = [
  {
    id: 'nexora-default',
    name: 'NEXORA Signature',
    description: 'Smooth futuristic glass chimes and warm tonal pulses.',
    toneLabel: 'Balanced & Luminous',
    pitchScale: 1.0,
    gainScale: 1.0,
    wave: 'sine',
  },
  {
    id: 'soft-iphone',
    name: 'Soft Glass',
    description: 'Gentle acoustic-inspired taps and airy harmonic notes.',
    toneLabel: 'Soft & Tactile',
    pitchScale: 1.08,
    gainScale: 0.9,
    wave: 'sine',
  },
  {
    id: 'magical',
    name: 'Celestial Shimmer',
    description: 'Crystalline intervals with delicate atmospheric tail.',
    toneLabel: 'Sparkling & Airy',
    pitchScale: 1.2,
    gainScale: 0.95,
    wave: 'triangle',
  },
  {
    id: 'minimal',
    name: 'Minimal Pure',
    description: 'Ultra-clean micro-ticks and quiet pure sine pings.',
    toneLabel: 'Crisp & Quiet',
    pitchScale: 0.94,
    gainScale: 0.72,
    wave: 'sine',
  },
  {
    id: 'silent',
    name: 'Silent Pack',
    description: 'Suppresses all optional NEXORA audio assets.',
    toneLabel: 'Muted',
    pitchScale: 1.0,
    gainScale: 0,
    wave: 'sine',
  },
];

export const NEXORA_SOUND_PROFILES: SoundProfileMeta[] = [
  {
    id: 'magical',
    name: 'Magical',
    description: 'Full subtle audio feedback across glass, messages, stories, and streaks.',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Important messages, notifications, voice cues, and milestones.',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Essential incoming messages and primary alerts only.',
  },
  {
    id: 'silent',
    name: 'Silent',
    description: 'All optional NEXORA sounds muted.',
  },
];

export function createUniformCategoryThemes(theme: SoundThemeId): CategoryThemeMap {
  return {
    messages: theme,
    notifications: theme,
    stories: theme,
    voiceUi: theme,
    achievements: theme,
    ui: theme,
  };
}

export const DEFAULT_CATEGORY_THEMES: CategoryThemeMap = createUniformCategoryThemes('magical');

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  masterEnabled: true,
  uiEnabled: true,
  messagesEnabled: true,
  notificationsEnabled: true,
  storiesEnabled: true,
  voiceUiEnabled: true,
  achievementsEnabled: true,
  readSoundEnabled: true,
  hapticsEnabled: true,
  volume: 0.68,
  profile: 'magical',
  soundPack: 'nexora-default',
  soundTheme: 'magical',
  categoryThemes: { ...DEFAULT_CATEGORY_THEMES },
};

const STORAGE_KEY = 'nexora_sound_settings_v2';
export const SOUND_THEME_STORAGE_KEY = 'nexora_sound_theme';

export function isSoundThemeId(value: unknown): value is SoundThemeId {
  return value === 'magical' || value === 'balanced' || value === 'minimal';
}

export function getSoundThemeMeta(themeId: SoundThemeId): SoundThemeMeta {
  return NEXORA_SOUND_THEMES.find((t) => t.id === themeId) || NEXORA_SOUND_THEMES[0];
}

export function mergeCategoryThemes(
  raw: Partial<Record<NotificationCategoryId, unknown>> | undefined,
  fallback: SoundThemeId = 'magical'
): CategoryThemeMap {
  const base = createUniformCategoryThemes(fallback);
  if (!raw || typeof raw !== 'object') return base;
  for (const cat of NOTIFICATION_CATEGORIES) {
    const candidate = raw[cat.id];
    if (isSoundThemeId(candidate)) {
      base[cat.id] = candidate;
    }
  }
  return base;
}

export function getProfilePatch(profile: SoundProfileId): Partial<SoundSettings> {
  switch (profile) {
    case 'magical':
      return {
        profile: 'magical',
        soundTheme: 'magical',
        masterEnabled: true,
        uiEnabled: true,
        messagesEnabled: true,
        notificationsEnabled: true,
        storiesEnabled: true,
        voiceUiEnabled: true,
        achievementsEnabled: true,
        readSoundEnabled: true,
        categoryThemes: createUniformCategoryThemes('magical'),
      };
    case 'balanced':
      return {
        profile: 'balanced',
        soundTheme: 'balanced',
        masterEnabled: true,
        uiEnabled: true,
        messagesEnabled: true,
        notificationsEnabled: true,
        storiesEnabled: true,
        voiceUiEnabled: true,
        achievementsEnabled: true,
        readSoundEnabled: false,
        categoryThemes: createUniformCategoryThemes('balanced'),
      };
    case 'minimal':
      return {
        profile: 'minimal',
        soundTheme: 'minimal',
        masterEnabled: true,
        uiEnabled: true,
        messagesEnabled: true,
        notificationsEnabled: true,
        storiesEnabled: false,
        voiceUiEnabled: false,
        achievementsEnabled: false,
        readSoundEnabled: false,
        categoryThemes: createUniformCategoryThemes('minimal'),
      };
    case 'silent':
      return {
        profile: 'silent',
        masterEnabled: false,
      };
  }
}

function mapLegacyPack(rawPack: unknown): SoundPackId {
  if (typeof rawPack !== 'string') return DEFAULT_SOUND_SETTINGS.soundPack;
  if (NEXORA_SOUND_PACKS.some((p) => p.id === rawPack)) return rawPack as SoundPackId;
  if (rawPack === 'celestial' || rawPack === 'celestial-crystal') return 'magical';
  if (rawPack === 'deep-space' || rawPack === 'astral-chime') return 'nexora-default';
  if (rawPack === 'quantum-pulse' || rawPack === 'nebula-soft') return 'soft-iphone';
  if (rawPack === 'minimal') return 'minimal';
  return DEFAULT_SOUND_SETTINGS.soundPack;
}

export function loadSoundSettings(): SoundSettings {
  if (typeof window === 'undefined') return DEFAULT_SOUND_SETTINGS;
  try {
    const storedThemeRaw = localStorage.getItem(SOUND_THEME_STORAGE_KEY);
    const storedTheme = isSoundThemeId(storedThemeRaw) ? storedThemeRaw : undefined;

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SoundSettings>;
      const profile = NEXORA_SOUND_PROFILES.some((p) => p.id === parsed.profile)
        ? (parsed.profile as SoundProfileId)
        : DEFAULT_SOUND_SETTINGS.profile;
      const derivedTheme: SoundThemeId = isSoundThemeId(parsed.soundTheme)
        ? parsed.soundTheme
        : storedTheme ??
          (profile === 'minimal' ? 'minimal' : profile === 'balanced' ? 'balanced' : 'magical');
      return {
        ...DEFAULT_SOUND_SETTINGS,
        ...parsed,
        profile,
        soundTheme: derivedTheme,
        soundPack: mapLegacyPack(parsed.soundPack),
        volume:
          typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
            ? Math.min(1, Math.max(0, parsed.volume))
            : DEFAULT_SOUND_SETTINGS.volume,
        categoryThemes: mergeCategoryThemes(parsed.categoryThemes, derivedTheme),
      };
    }

    // Migrate legacy v1 preferences if present
    const legacyRaw = localStorage.getItem('nexora_sound_prefs_v1');
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as {
        soundEnabled?: boolean;
        soundVolume?: number;
        readSoundEnabled?: boolean;
        uiClickEnabled?: boolean;
        soundPack?: string;
      };
      const initialTheme = storedTheme ?? DEFAULT_SOUND_SETTINGS.soundTheme;
      return {
        ...DEFAULT_SOUND_SETTINGS,
        masterEnabled: parsed.soundEnabled ?? true,
        volume: typeof parsed.soundVolume === 'number' ? parsed.soundVolume : DEFAULT_SOUND_SETTINGS.volume,
        readSoundEnabled: parsed.readSoundEnabled ?? true,
        uiEnabled: parsed.uiClickEnabled ?? true,
        soundPack: mapLegacyPack(parsed.soundPack),
        soundTheme: initialTheme,
        categoryThemes: createUniformCategoryThemes(initialTheme),
      };
    }

    if (storedTheme) {
      return {
        ...DEFAULT_SOUND_SETTINGS,
        ...getProfilePatch(storedTheme),
        soundTheme: storedTheme,
      };
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_SOUND_SETTINGS;
}

export function saveSoundSettings(settings: SoundSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(SOUND_THEME_STORAGE_KEY, settings.soundTheme);
  } catch {
    // ignore storage quota errors
  }
}
