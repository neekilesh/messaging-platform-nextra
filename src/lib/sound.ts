import { useCallback, useEffect, useState } from 'react';

export type NexoraSoundPackId =
  | 'astral-chime'
  | 'celestial-crystal'
  | 'quantum-pulse'
  | 'nebula-soft';

export interface NexoraSoundPackMeta {
  id: NexoraSoundPackId;
  name: string;
  description: string;
  pitchScale: number;
  wave: OscillatorType;
  gainScale: number;
}

export const NEXORA_SOUND_PACKS: NexoraSoundPackMeta[] = [
  {
    id: 'astral-chime',
    name: 'Astral Chime',
    description: 'Ethereal violet-cyan bells with soft harmonic fifths.',
    pitchScale: 1.0,
    wave: 'sine',
    gainScale: 1.0,
  },
  {
    id: 'celestial-crystal',
    name: 'Celestial Crystal',
    description: 'Delicate high-shimmer crystalline resonance.',
    pitchScale: 1.24,
    wave: 'sine',
    gainScale: 0.92,
  },
  {
    id: 'quantum-pulse',
    name: 'Quantum Pulse',
    description: 'Crisp futuristic synth intervals with clean precision.',
    pitchScale: 0.94,
    wave: 'triangle',
    gainScale: 0.95,
  },
  {
    id: 'nebula-soft',
    name: 'Nebula Soft',
    description: 'Ultra-gentle muted whispers for quiet late-night sessions.',
    pitchScale: 0.84,
    wave: 'sine',
    gainScale: 0.72,
  },
];

export type SoundEventId =
  // 1. Message Sound Effects
  | 'message.send'
  | 'message.receive'
  | 'message.delivered'
  | 'message.read'
  | 'message.failed'
  | 'message.deleted'
  | 'message.react'
  // 2. Magical Notification Sounds
  | 'notify.private'
  | 'notify.group'
  | 'notify.friend_request'
  | 'notify.friend_accepted'
  | 'notify.mention'
  | 'notify.story_new'
  | 'notify.story_reply'
  | 'notify.streak_milestone'
  | 'notify.security_alert'
  // 3. Magical UI Interaction Sounds
  | 'ui.chat_open'
  | 'ui.chat_close'
  | 'ui.menu_open'
  | 'ui.tab_switch'
  | 'ui.click'
  | 'ui.theme_change'
  | 'ui.theme_unlock'
  | 'ui.settings_saved'
  // 4. Voice Message Audio Effects
  | 'voice.record_start'
  | 'voice.record_stop'
  | 'voice.play_start';

export interface SoundPrefs {
  soundEnabled: boolean;
  soundVolume: number; // 0 to 1
  readSoundEnabled: boolean;
  uiClickEnabled: boolean;
  soundPack: NexoraSoundPackId;
}

const SOUND_STORAGE_KEY = 'nexora_sound_prefs_v1';
const EXPLORED_THEMES_KEY = 'nexora_explored_themes_v1';

const DEFAULT_SOUND_PREFS: SoundPrefs = {
  soundEnabled: true,
  soundVolume: 0.65,
  readSoundEnabled: true,
  uiClickEnabled: true,
  soundPack: 'astral-chime',
};

function readStoredSoundPrefs(): SoundPrefs {
  if (typeof window === 'undefined') return DEFAULT_SOUND_PREFS;
  try {
    const raw = localStorage.getItem(SOUND_STORAGE_KEY);
    if (!raw) return DEFAULT_SOUND_PREFS;
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
    const validPack = NEXORA_SOUND_PACKS.some((p) => p.id === parsed.soundPack)
      ? (parsed.soundPack as NexoraSoundPackId)
      : DEFAULT_SOUND_PREFS.soundPack;
    return {
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
      soundVolume:
        typeof parsed.soundVolume === 'number' && Number.isFinite(parsed.soundVolume)
          ? Math.min(1, Math.max(0, parsed.soundVolume))
          : DEFAULT_SOUND_PREFS.soundVolume,
      readSoundEnabled:
        typeof parsed.readSoundEnabled === 'boolean' ? parsed.readSoundEnabled : true,
      uiClickEnabled: typeof parsed.uiClickEnabled === 'boolean' ? parsed.uiClickEnabled : true,
      soundPack: validPack,
    };
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

let currentSoundPrefs: SoundPrefs = readStoredSoundPrefs();
const prefsSubscribers = new Set<(prefs: SoundPrefs) => void>();

function updateSoundPrefs(patch: Partial<SoundPrefs>) {
  currentSoundPrefs = {
    ...currentSoundPrefs,
    ...patch,
  };
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(currentSoundPrefs));
  } catch {
    // ignore storage errors
  }
  prefsSubscribers.forEach((cb) => cb(currentSoundPrefs));
}

export function markThemeExploredAndCheckNew(themeId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(EXPLORED_THEMES_KEY);
    const explored: string[] = raw ? JSON.parse(raw) : ['cosmic-purple'];
    if (explored.includes(themeId)) {
      return false;
    }
    explored.push(themeId);
    localStorage.setItem(EXPLORED_THEMES_KEY, JSON.stringify(explored));
    return true;
  } catch {
    return false;
  }
}

// Shared Web Audio API context & gentle limiter
let sharedAudioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let unlockListenerBound = false;
const lastPlayedAt = new Map<string, number>();

function ensureAudioContext(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!unlockListenerBound) {
    unlockListenerBound = true;
    const unlock = () => {
      if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AudioCtx();
      const compressor = sharedAudioCtx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-16, sharedAudioCtx.currentTime);
      compressor.ratio.setValueAtTime(6, sharedAudioCtx.currentTime);

      const filter = sharedAudioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(7500, sharedAudioCtx.currentTime);

      masterGain = sharedAudioCtx.createGain();
      masterGain.gain.setValueAtTime(currentSoundPrefs.soundVolume * 0.45, sharedAudioCtx.currentTime);

      masterGain.connect(filter);
      filter.connect(compressor);
      compressor.connect(sharedAudioCtx.destination);
    } catch {
      return null;
    }
  }

  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }

  if (masterGain) {
    masterGain.gain.setTargetAtTime(
      currentSoundPrefs.soundVolume * 0.45,
      sharedAudioCtx.currentTime,
      0.02
    );
  }

  return sharedAudioCtx && masterGain ? { ctx: sharedAudioCtx, master: masterGain } : null;
}

interface ToneStep {
  freq: number;
  freqEnd?: number;
  delay?: number;
  duration: number;
  gain: number;
  wave?: OscillatorType;
}

function playTones(
  ctx: AudioContext,
  master: GainNode,
  steps: ToneStep[],
  pack: NexoraSoundPackMeta,
  usePackPitch = true
) {
  const now = ctx.currentTime;
  const pScale = usePackPitch ? pack.pitchScale : 1;

  for (const step of steps) {
    const start = now + (step.delay ?? 0);
    const dur = Math.max(0.02, step.duration);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = step.wave ?? pack.wave;
    const fStart = Math.min(8000, Math.max(60, step.freq * pScale));
    osc.frequency.setValueAtTime(fStart, start);
    if (step.freqEnd) {
      const fEnd = Math.min(8000, Math.max(60, step.freqEnd * pScale));
      osc.frequency.exponentialRampToValueAtTime(fEnd, start + dur);
    }

    const peak = Math.max(0.001, step.gain * pack.gainScale);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(peak, start + Math.min(0.018, dur * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}

export function playSound(
  event: SoundEventId,
  options?: { force?: boolean; packOverride?: NexoraSoundPackId }
) {
  const prefs = currentSoundPrefs;
  if (!options?.force) {
    if (!prefs.soundEnabled || prefs.soundVolume <= 0.01) return;
    if (event === 'message.read' && !prefs.readSoundEnabled) return;
    if (event === 'ui.click' && !prefs.uiClickEnabled) return;
  }

  // Cooldown guard prevents stacking when batch events arrive
  const nowMs = performance.now();
  const minCooldown = event === 'ui.click' ? 45 : 110;
  const prevMs = lastPlayedAt.get(event) ?? 0;
  if (!options?.force && nowMs - prevMs < minCooldown) {
    return;
  }
  lastPlayedAt.set(event, nowMs);

  const audio = ensureAudioContext();
  if (!audio) return;
  const { ctx, master } = audio;

  if (options?.force && master) {
    master.gain.setTargetAtTime(Math.max(0.22, prefs.soundVolume * 0.45), ctx.currentTime, 0.015);
  }

  const packId = options?.packOverride ?? prefs.soundPack;
  const pack = NEXORA_SOUND_PACKS.find((p) => p.id === packId) || NEXORA_SOUND_PACKS[0];

  switch (event) {
    // 1. Message Sound Effects
    case 'message.send':
      playTones(ctx, master, [
        { freq: 340, freqEnd: 560, duration: 0.14, gain: 0.22, wave: 'sine' },
        { freq: 680, freqEnd: 880, delay: 0.04, duration: 0.15, gain: 0.12, wave: 'triangle' },
      ], pack);
      break;

    case 'message.receive':
      playTones(ctx, master, [
        { freq: 523.25, duration: 0.14, gain: 0.2 },
        { freq: 783.99, delay: 0.07, duration: 0.24, gain: 0.18 },
      ], pack);
      break;

    case 'message.delivered':
      playTones(ctx, master, [
        { freq: 660, duration: 0.07, gain: 0.11 },
        { freq: 880, delay: 0.055, duration: 0.09, gain: 0.1 },
      ], pack);
      break;

    case 'message.read':
      playTones(ctx, master, [
        { freq: 1174.66, duration: 0.11, gain: 0.075, wave: 'sine' },
        { freq: 1567.98, delay: 0.045, duration: 0.16, gain: 0.06, wave: 'sine' },
      ], pack);
      break;

    case 'message.failed':
      playTones(ctx, master, [
        { freq: 240, freqEnd: 185, duration: 0.18, gain: 0.22, wave: 'triangle' },
        { freq: 195, freqEnd: 145, delay: 0.12, duration: 0.22, gain: 0.18, wave: 'sine' },
      ], pack, false);
      break;

    case 'message.deleted':
      playTones(ctx, master, [
        { freq: 480, freqEnd: 190, duration: 0.19, gain: 0.16, wave: 'sine' },
        { freq: 320, freqEnd: 130, delay: 0.03, duration: 0.18, gain: 0.1, wave: 'triangle' },
      ], pack);
      break;

    case 'message.react':
      playTones(ctx, master, [
        { freq: 880, duration: 0.08, gain: 0.13, wave: 'sine' },
        { freq: 1174.66, delay: 0.045, duration: 0.09, gain: 0.12, wave: 'sine' },
        { freq: 1567.98, delay: 0.09, duration: 0.14, gain: 0.11, wave: 'sine' },
      ], pack);
      break;

    // 2. Magical Notification Sounds
    case 'notify.private':
      playTones(ctx, master, [
        { freq: 587.33, duration: 0.14, gain: 0.22 },
        { freq: 880, delay: 0.08, duration: 0.26, gain: 0.2 },
      ], pack);
      break;

    case 'notify.group':
      playTones(ctx, master, [
        { freq: 440, duration: 0.12, gain: 0.17 },
        { freq: 554.37, delay: 0.06, duration: 0.14, gain: 0.17 },
        { freq: 659.25, delay: 0.12, duration: 0.24, gain: 0.18 },
      ], pack);
      break;

    case 'notify.friend_request':
      playTones(ctx, master, [
        { freq: 523.25, duration: 0.13, gain: 0.18 },
        { freq: 659.25, delay: 0.08, duration: 0.15, gain: 0.18 },
        { freq: 783.99, delay: 0.16, duration: 0.26, gain: 0.2 },
      ], pack);
      break;

    case 'notify.friend_accepted':
      playTones(ctx, master, [
        { freq: 392, duration: 0.12, gain: 0.18 },
        { freq: 493.88, delay: 0.07, duration: 0.14, gain: 0.18 },
        { freq: 587.33, delay: 0.14, duration: 0.16, gain: 0.19 },
        { freq: 783.99, delay: 0.21, duration: 0.34, gain: 0.22 },
      ], pack);
      break;

    case 'notify.mention':
      playTones(ctx, master, [
        { freq: 880, duration: 0.1, gain: 0.22 },
        { freq: 1318.51, delay: 0.07, duration: 0.28, gain: 0.22 },
      ], pack);
      break;

    case 'notify.story_new':
      playTones(ctx, master, [
        { freq: 587.33, freqEnd: 880, duration: 0.22, gain: 0.15, wave: 'sine' },
        { freq: 1174.66, delay: 0.1, duration: 0.26, gain: 0.14, wave: 'sine' },
      ], pack);
      break;

    case 'notify.story_reply':
      playTones(ctx, master, [
        { freq: 659.25, duration: 0.12, gain: 0.18 },
        { freq: 987.77, delay: 0.08, duration: 0.24, gain: 0.19 },
      ], pack);
      break;

    case 'notify.streak_milestone':
      playTones(ctx, master, [
        { freq: 523.25, duration: 0.11, gain: 0.19 },
        { freq: 659.25, delay: 0.07, duration: 0.11, gain: 0.19 },
        { freq: 783.99, delay: 0.14, duration: 0.12, gain: 0.2 },
        { freq: 987.77, delay: 0.21, duration: 0.14, gain: 0.21 },
        { freq: 1046.5, delay: 0.28, duration: 0.38, gain: 0.24 },
      ], pack);
      break;

    case 'notify.security_alert':
      playTones(ctx, master, [
        { freq: 329.63, duration: 0.16, gain: 0.24, wave: 'triangle' },
        { freq: 261.63, delay: 0.14, duration: 0.18, gain: 0.22, wave: 'triangle' },
        { freq: 329.63, delay: 0.3, duration: 0.24, gain: 0.2, wave: 'sine' },
      ], pack, false);
      break;

    // 3. Magical UI Interaction Sounds
    case 'ui.chat_open':
      playTones(ctx, master, [
        { freq: 260, freqEnd: 520, duration: 0.18, gain: 0.14, wave: 'sine' },
        { freq: 520, freqEnd: 780, delay: 0.05, duration: 0.2, gain: 0.1, wave: 'sine' },
      ], pack);
      break;

    case 'ui.chat_close':
      playTones(ctx, master, [
        { freq: 480, freqEnd: 250, duration: 0.16, gain: 0.13, wave: 'sine' },
      ], pack);
      break;

    case 'ui.menu_open':
      playTones(ctx, master, [
        { freq: 390, freqEnd: 585, duration: 0.11, gain: 0.12, wave: 'sine' },
      ], pack);
      break;

    case 'ui.tab_switch':
      playTones(ctx, master, [
        { freq: 540, freqEnd: 680, duration: 0.07, gain: 0.1, wave: 'sine' },
      ], pack);
      break;

    case 'ui.click':
      playTones(ctx, master, [
        { freq: 620, freqEnd: 360, duration: 0.032, gain: 0.075, wave: 'sine' },
      ], pack, false);
      break;

    case 'ui.theme_change':
      playTones(ctx, master, [
        { freq: 440, duration: 0.16, gain: 0.14 },
        { freq: 659.25, delay: 0.06, duration: 0.18, gain: 0.13 },
        { freq: 880, delay: 0.12, duration: 0.26, gain: 0.12 },
      ], pack);
      break;

    case 'ui.theme_unlock':
      playTones(ctx, master, [
        { freq: 523.25, duration: 0.12, gain: 0.18 },
        { freq: 659.25, delay: 0.06, duration: 0.12, gain: 0.18 },
        { freq: 783.99, delay: 0.12, duration: 0.14, gain: 0.19 },
        { freq: 1046.5, delay: 0.18, duration: 0.22, gain: 0.21 },
        { freq: 1318.51, delay: 0.24, duration: 0.32, gain: 0.18 },
      ], pack);
      break;

    case 'ui.settings_saved':
      playTones(ctx, master, [
        { freq: 523.25, duration: 0.1, gain: 0.15 },
        { freq: 783.99, delay: 0.07, duration: 0.18, gain: 0.16 },
      ], pack);
      break;

    // 4. Voice Message Audio Effects
    case 'voice.record_start':
      playTones(ctx, master, [
        { freq: 440, duration: 0.075, gain: 0.14 },
        { freq: 660, delay: 0.06, duration: 0.11, gain: 0.15 },
      ], pack);
      break;

    case 'voice.record_stop':
      playTones(ctx, master, [
        { freq: 660, duration: 0.075, gain: 0.13 },
        { freq: 493.88, delay: 0.06, duration: 0.13, gain: 0.13 },
      ], pack);
      break;

    case 'voice.play_start':
      playTones(ctx, master, [
        { freq: 520, freqEnd: 640, duration: 0.06, gain: 0.09 },
      ], pack);
      break;
  }
}

export function useSoundPrefs() {
  const [prefs, setPrefs] = useState<SoundPrefs>(() => currentSoundPrefs);

  useEffect(() => {
    const listener = (next: SoundPrefs) => setPrefs(next);
    prefsSubscribers.add(listener);
    return () => {
      prefsSubscribers.delete(listener);
    };
  }, []);

  const setSoundEnabled = useCallback((soundEnabled: boolean) => {
    updateSoundPrefs({ soundEnabled });
  }, []);

  const setSoundVolume = useCallback((soundVolume: number) => {
    updateSoundPrefs({ soundVolume: Math.min(1, Math.max(0, soundVolume)) });
  }, []);

  const setReadSoundEnabled = useCallback((readSoundEnabled: boolean) => {
    updateSoundPrefs({ readSoundEnabled });
  }, []);

  const setUiClickEnabled = useCallback((uiClickEnabled: boolean) => {
    updateSoundPrefs({ uiClickEnabled });
  }, []);

  const setSoundPack = useCallback((soundPack: NexoraSoundPackId) => {
    updateSoundPrefs({ soundPack });
  }, []);

  const previewPack = useCallback((packId: NexoraSoundPackId) => {
    playSound('notify.friend_accepted', { force: true, packOverride: packId });
  }, []);

  return {
    ...prefs,
    setSoundEnabled,
    setSoundVolume,
    setReadSoundEnabled,
    setUiClickEnabled,
    setSoundPack,
    previewPack,
  };
}
