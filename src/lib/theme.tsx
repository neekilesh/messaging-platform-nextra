import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { SoundPackId } from './audio';

export type NexoraThemeId =
  | 'cosmic-purple'
  | 'mystic-blue'
  | 'aurora-dream'
  | 'dark-nebula'
  | 'celestial-gold';

export interface NexoraThemeMeta {
  id: NexoraThemeId;
  name: string;
  description: string;
  swatches: [string, string, string];
  particleRgb: [string, string, string];
  cursorRgb: string;
}

export const NEXORA_THEMES: NexoraThemeMeta[] = [
  {
    id: 'cosmic-purple',
    name: 'Cosmic Purple',
    description: 'Deep purple galaxy with luminous violet and cyan energy.',
    swatches: ['#7c3aed', '#6366f1', '#22d3ee'],
    particleRgb: ['167, 139, 250', '34, 211, 238', '129, 140, 248'],
    cursorRgb: '139, 92, 246',
  },
  {
    id: 'mystic-blue',
    name: 'Mystic Blue',
    description: 'Midnight cobalt depths lit by electric sapphire waves.',
    swatches: ['#2563eb', '#38bdf8', '#818cf8'],
    particleRgb: ['56, 189, 248', '59, 130, 246', '129, 140, 248'],
    cursorRgb: '56, 189, 248',
  },
  {
    id: 'aurora-dream',
    name: 'Aurora Dream',
    description: 'Flowing cyan, emerald teal, and twilight violet aurora.',
    swatches: ['#14b8a6', '#22d3ee', '#a855f7'],
    particleRgb: ['45, 212, 191', '34, 211, 238', '192, 132, 252'],
    cursorRgb: '45, 212, 191',
  },
  {
    id: 'dark-nebula',
    name: 'Dark Nebula',
    description: 'Ultra-dark obsidian expanse with crisp starlight shimmer.',
    swatches: ['#0f172a', '#64748b', '#94a3b8'],
    particleRgb: ['226, 232, 240', '148, 163, 184', '165, 180, 252'],
    cursorRgb: '148, 163, 184',
  },
  {
    id: 'celestial-gold',
    name: 'Celestial Gold',
    description: 'Deep starlit night accented with warm solar gold.',
    swatches: ['#f59e0b', '#fbbf24', '#8b5cf6'],
    particleRgb: ['251, 191, 36', '245, 158, 11', '167, 139, 250'],
    cursorRgb: '251, 191, 36',
  },
];

const STORAGE_KEY = 'nexora_visual_prefs_v1';
const VALID_PACKS: SoundPackId[] = ['celestial', 'deep-space', 'minimal'];

interface StoredPrefs {
  theme: NexoraThemeId;
  reduceEffects: boolean;
  soundEnabled: boolean;
  soundPack: SoundPackId;
}

interface VisualPrefsContextValue {
  theme: NexoraThemeId;
  themeMeta: NexoraThemeMeta;
  setTheme: (theme: NexoraThemeId) => void;
  reduceEffects: boolean;
  setReduceEffects: (reduce: boolean) => void;
  effectiveReducedMotion: boolean;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  soundPack: SoundPackId;
  setSoundPack: (pack: SoundPackId) => void;
}

const VisualPrefsContext = createContext<VisualPrefsContextValue | null>(null);

function loadPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      const validTheme = NEXORA_THEMES.some((t) => t.id === parsed.theme)
        ? (parsed.theme as NexoraThemeId)
        : 'cosmic-purple';
      const validPack = VALID_PACKS.includes(parsed.soundPack as SoundPackId)
        ? (parsed.soundPack as SoundPackId)
        : 'celestial';
      return {
        theme: validTheme,
        reduceEffects: Boolean(parsed.reduceEffects),
        soundEnabled: parsed.soundEnabled !== undefined ? Boolean(parsed.soundEnabled) : true,
        soundPack: validPack,
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    theme: 'cosmic-purple',
    reduceEffects: false,
    soundEnabled: true,
    soundPack: 'celestial',
  };
}

export function VisualPrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<StoredPrefs>(() => loadPrefs());
  const [osReduced, setOsReduced] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

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
    } catch {
      // ignore
    }
    const root = document.documentElement;
    root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-reduce-effects', String(prefs.reduceEffects || osReduced));
  }, [prefs, osReduced]);

  const themeMeta = useMemo(
    () => NEXORA_THEMES.find((t) => t.id === prefs.theme) || NEXORA_THEMES[0],
    [prefs.theme]
  );

  const value = useMemo<VisualPrefsContextValue>(
    () => ({
      theme: prefs.theme,
      themeMeta,
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      reduceEffects: prefs.reduceEffects,
      setReduceEffects: (reduceEffects) => setPrefs((p) => ({ ...p, reduceEffects })),
      effectiveReducedMotion: prefs.reduceEffects || osReduced,
      soundEnabled: prefs.soundEnabled,
      setSoundEnabled: (soundEnabled) => setPrefs((p) => ({ ...p, soundEnabled })),
      soundPack: prefs.soundPack,
      setSoundPack: (soundPack) => setPrefs((p) => ({ ...p, soundPack })),
    }),
    [prefs, themeMeta, osReduced]
  );

  return <VisualPrefsContext.Provider value={value}>{children}</VisualPrefsContext.Provider>;
}

export function useVisualPrefs(): VisualPrefsContextValue {
  const ctx = useContext(VisualPrefsContext);
  if (!ctx) {
    return {
      theme: 'cosmic-purple',
      themeMeta: NEXORA_THEMES[0],
      setTheme: () => {},
      reduceEffects: false,
      setReduceEffects: () => {},
      effectiveReducedMotion: false,
      soundEnabled: true,
      setSoundEnabled: () => {},
      soundPack: 'celestial',
      setSoundPack: () => {},
    };
  }
  return ctx;
}
