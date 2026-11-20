import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { audioManager } from '../audio/AudioManager';
import type { SoundPackId } from '../audio/SoundSettings';

export type NexoraThemeId =
  | 'dreamy-lavender'
  | 'ocean-mist'
  | 'peach-blossom'
  | 'golden-sunrise'
  | 'violet-galaxy'
  | 'mint-paradise';

export type AppearanceMode = 'dark' | 'light';

export interface NexoraThemeMeta {
  id: NexoraThemeId;
  name: string;
  description: string;
  swatches: [string, string, string];
  darkSwatches: [string, string, string];
  particleRgb: [string, string, string];
  cursorRgb: string;
}

export const NEXORA_THEMES: NexoraThemeMeta[] = [
  {
    id: 'dreamy-lavender',
    name: 'Dreamy Lavender',
    description: 'Iridescent lavender haze blending into soft periwinkle blue.',
    swatches: ['#F4DFFF', '#D8C7FF', '#AFCBFF'],
    darkSwatches: ['#1d1433', '#31235c', '#182447'],
    particleRgb: ['216, 199, 255', '175, 203, 255', '244, 223, 255'],
    cursorRgb: '167, 139, 250',
  },
  {
    id: 'ocean-mist',
    name: 'Ocean Mist',
    description: 'Glacial aqua mist flowing through serene sky blue and soft indigo.',
    swatches: ['#D5F5F2', '#A8E4F4', '#B9B8FF'],
    darkSwatches: ['#0c222d', '#14334d', '#1c1d45'],
    particleRgb: ['168, 228, 244', '185, 184, 255', '213, 245, 242'],
    cursorRgb: '56, 189, 248',
  },
  {
    id: 'peach-blossom',
    name: 'Peach Blossom',
    description: 'Warm peach silk dissolving into rose quartz and soft violet.',
    swatches: ['#FFE0C7', '#FFBBD0', '#D8B8FF'],
    darkSwatches: ['#2b1721', '#3b1c36', '#21193d'],
    particleRgb: ['255, 187, 208', '216, 184, 255', '255, 224, 199'],
    cursorRgb: '244, 114, 182',
  },
  {
    id: 'golden-sunrise',
    name: 'Golden Sunrise',
    description: 'Sunlit champagne gold into warm apricot and rose twilight.',
    swatches: ['#FFF0B8', '#FFD0B4', '#F6B8D7'],
    darkSwatches: ['#281e12', '#3a221d', '#2d1930'],
    particleRgb: ['255, 208, 180', '246, 184, 215', '255, 240, 184'],
    cursorRgb: '251, 191, 36',
  },
  {
    id: 'violet-galaxy',
    name: 'Violet Galaxy',
    description: 'Luminous iris violet drifting through soft lilac and orchid.',
    swatches: ['#D0C8FF', '#B6A6FF', '#E6B9F1'],
    darkSwatches: ['#151233', '#271e54', '#2e183b'],
    particleRgb: ['182, 166, 255', '230, 185, 241', '208, 200, 255'],
    cursorRgb: '139, 92, 246',
  },
  {
    id: 'mint-paradise',
    name: 'Mint Paradise',
    description: 'Fresh seafoam mint merging with cool aquamarine and ice blue.',
    swatches: ['#D9F9DF', '#A8ECDD', '#B6D8FF'],
    darkSwatches: ['#0d241f', '#123338', '#162544'],
    particleRgb: ['168, 236, 221', '182, 216, 255', '217, 249, 223'],
    cursorRgb: '45, 212, 191',
  },
];

const STORAGE_KEY = 'nexora_visual_prefs_v2';
const LEGACY_STORAGE_KEY = 'nexora_visual_prefs_v1';
export const THEME_STORAGE_KEY = 'nexora_theme';

interface StoredPrefs {
  theme: NexoraThemeId;
  appearanceMode: AppearanceMode;
  reduceEffects: boolean;
}

interface VisualPrefsContextValue {
  theme: NexoraThemeId;
  themeMeta: NexoraThemeMeta;
  setTheme: (theme: NexoraThemeId) => void;
  appearanceMode: AppearanceMode;
  setAppearanceMode: (mode: AppearanceMode) => void;
  isDark: boolean;
  reduceEffects: boolean;
  setReduceEffects: (reduce: boolean) => void;
  effectiveReducedMotion: boolean;
  // Unified audio compatibility fields
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  soundPack: SoundPackId;
  setSoundPack: (pack: SoundPackId) => void;
}

const VisualPrefsContext = createContext<VisualPrefsContextValue | null>(null);

function mapLegacyTheme(rawTheme: unknown): NexoraThemeId {
  if (typeof rawTheme !== 'string') return 'dreamy-lavender';
  if (NEXORA_THEMES.some((t) => t.id === rawTheme)) return rawTheme as NexoraThemeId;
  if (rawTheme === 'cosmic-purple' || rawTheme === 'dark-nebula') return 'violet-galaxy';
  if (rawTheme === 'mystic-blue') return 'ocean-mist';
  if (rawTheme === 'aurora-dream') return 'mint-paradise';
  if (rawTheme === 'celestial-gold') return 'golden-sunrise';
  return 'dreamy-lavender';
}

function loadPrefs(): StoredPrefs {
  if (typeof window === 'undefined') {
    return { theme: 'dreamy-lavender', appearanceMode: 'dark', reduceEffects: false };
  }
  try {
    const directTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const hasDirectTheme =
      typeof directTheme === 'string' && NEXORA_THEMES.some((t) => t.id === directTheme);

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      return {
        theme: parsed.theme
          ? mapLegacyTheme(parsed.theme)
          : hasDirectTheme
          ? (directTheme as NexoraThemeId)
          : 'dreamy-lavender',
        appearanceMode: parsed.appearanceMode === 'light' ? 'light' : 'dark',
        reduceEffects: Boolean(parsed.reduceEffects),
      };
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as { theme?: string; reduceEffects?: boolean };
      return {
        theme: mapLegacyTheme(parsed.theme),
        appearanceMode: 'dark',
        reduceEffects: Boolean(parsed.reduceEffects),
      };
    }

    if (hasDirectTheme) {
      return {
        theme: directTheme as NexoraThemeId,
        appearanceMode: 'dark',
        reduceEffects: false,
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    theme: 'dreamy-lavender',
    appearanceMode: 'dark',
    reduceEffects: false,
  };
}

export function VisualPrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<StoredPrefs>(() => loadPrefs());
  const [soundState, setSoundState] = useState(() => audioManager.getSettings());
  const [osReduced, setOsReduced] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    return audioManager.subscribe(setSoundState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setOsReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      localStorage.setItem(THEME_STORAGE_KEY, prefs.theme);
    } catch {
      // ignore
    }
    const root = document.documentElement;
    root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-appearance', prefs.appearanceMode);
    root.setAttribute('data-reduce-effects', String(prefs.reduceEffects || osReduced));
    if (prefs.appearanceMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', prefs.appearanceMode === 'dark' ? '#080912' : '#EFE8FF');
    }
  }, [prefs, osReduced]);

  const themeMeta = useMemo(
    () => NEXORA_THEMES.find((t) => t.id === prefs.theme) || NEXORA_THEMES[0],
    [prefs.theme]
  );

  const value = useMemo<VisualPrefsContextValue>(
    () => ({
      theme: prefs.theme,
      themeMeta,
      setTheme: (theme) => {
        setPrefs((p) => {
          const next = { ...p, theme };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            localStorage.setItem(THEME_STORAGE_KEY, theme);
          } catch {
            // ignore storage errors
          }
          return next;
        });
      },
      appearanceMode: prefs.appearanceMode,
      setAppearanceMode: (appearanceMode) => setPrefs((p) => ({ ...p, appearanceMode })),
      isDark: prefs.appearanceMode === 'dark',
      reduceEffects: prefs.reduceEffects,
      setReduceEffects: (reduceEffects) => setPrefs((p) => ({ ...p, reduceEffects })),
      effectiveReducedMotion: prefs.reduceEffects || osReduced,
      soundEnabled: soundState.masterEnabled,
      setSoundEnabled: (masterEnabled) => audioManager.updateSettings({ masterEnabled }),
      soundPack: soundState.soundPack,
      setSoundPack: (soundPack) => audioManager.updateSettings({ soundPack }),
    }),
    [prefs, themeMeta, osReduced, soundState]
  );

  return <VisualPrefsContext.Provider value={value}>{children}</VisualPrefsContext.Provider>;
}

export function useVisualPrefs(): VisualPrefsContextValue {
  const ctx = useContext(VisualPrefsContext);
  if (!ctx) {
    return {
      theme: 'dreamy-lavender',
      themeMeta: NEXORA_THEMES[0],
      setTheme: () => {},
      appearanceMode: 'dark',
      setAppearanceMode: () => {},
      isDark: true,
      reduceEffects: false,
      setReduceEffects: () => {},
      effectiveReducedMotion: false,
      soundEnabled: true,
      setSoundEnabled: () => {},
      soundPack: 'nexora-default',
      setSoundPack: () => {},
    };
  }
  return ctx;
}
