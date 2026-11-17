export type SoundPackId = 'celestial' | 'deep-space' | 'minimal';

export type MagicalSoundEvent =
  | 'send-message'
  | 'receive-message'
  | 'portal-activation'
  | 'streak-milestone'
  | 'reaction'
  | 'notification'
  | 'friend_accept';

export interface SoundPackMeta {
  id: SoundPackId;
  name: string;
  description: string;
  toneLabel: string;
}

export const NEXORA_SOUND_PACKS: SoundPackMeta[] = [
  {
    id: 'celestial',
    name: 'Celestial',
    description: 'Luminous crystal chimes and airy harmonic intervals.',
    toneLabel: 'Bright & Shimmering',
  },
  {
    id: 'deep-space',
    name: 'Deep Space',
    description: 'Warm sub-resonant cosmic pulses and soft nebula pads.',
    toneLabel: 'Warm & Atmospheric',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Ultra-clean, delicate acoustic ticks and pure sine pings.',
    toneLabel: 'Crisp & Subtle',
  },
];

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

interface ToneStep {
  freq: number;
  endFreq?: number;
  delay: number;
  duration: number;
  gain: number;
  type: OscillatorType;
  detune?: number;
  filterFreq?: number;
}

function getToneSequence(event: MagicalSoundEvent, pack: SoundPackId): ToneStep[] {
  if (pack === 'celestial') {
    switch (event) {
      case 'send-message':
        return [
          { freq: 587.33, endFreq: 880, delay: 0, duration: 0.14, gain: 0.045, type: 'sine' },
          { freq: 1174.66, delay: 0.04, duration: 0.16, gain: 0.028, type: 'triangle' },
        ];
      case 'receive-message':
        return [
          { freq: 659.25, delay: 0, duration: 0.16, gain: 0.045, type: 'sine' },
          { freq: 987.77, delay: 0.07, duration: 0.22, gain: 0.038, type: 'sine' },
        ];
      case 'portal-activation':
        return [
          { freq: 392.0, endFreq: 587.33, delay: 0, duration: 0.22, gain: 0.036, type: 'sine' },
          { freq: 783.99, endFreq: 1174.66, delay: 0.05, duration: 0.24, gain: 0.026, type: 'triangle' },
        ];
      case 'streak-milestone':
        return [
          { freq: 523.25, delay: 0, duration: 0.2, gain: 0.042, type: 'sine', filterFreq: 3800 },
          { freq: 659.25, delay: 0.07, duration: 0.22, gain: 0.042, type: 'sine', filterFreq: 4200 },
          { freq: 783.99, delay: 0.14, duration: 0.24, gain: 0.044, type: 'triangle', filterFreq: 4200 },
          { freq: 987.77, delay: 0.21, duration: 0.28, gain: 0.04, type: 'sine', filterFreq: 4600 },
          { freq: 1046.5, delay: 0.28, duration: 0.52, gain: 0.048, type: 'sine', filterFreq: 5200 },
          { freq: 1046.5, delay: 0.285, duration: 0.52, gain: 0.024, type: 'triangle', detune: 7, filterFreq: 4800 },
          { freq: 1567.98, delay: 0.34, duration: 0.55, gain: 0.026, type: 'sine', detune: -5, filterFreq: 5600 },
        ];
      case 'reaction':
        return [
          { freq: 880, endFreq: 1318.5, delay: 0, duration: 0.11, gain: 0.035, type: 'sine' },
        ];
      case 'friend_accept':
        return [
          { freq: 523.25, delay: 0, duration: 0.15, gain: 0.045, type: 'sine' },
          { freq: 659.25, delay: 0.08, duration: 0.16, gain: 0.042, type: 'sine' },
          { freq: 1046.5, delay: 0.16, duration: 0.26, gain: 0.04, type: 'triangle' },
        ];
      case 'notification':
      default:
        return [
          { freq: 783.99, delay: 0, duration: 0.14, gain: 0.045, type: 'sine' },
          { freq: 1174.66, delay: 0.07, duration: 0.24, gain: 0.04, type: 'sine' },
          { freq: 1567.98, delay: 0.14, duration: 0.28, gain: 0.025, type: 'triangle' },
        ];
    }
  }

  if (pack === 'deep-space') {
    switch (event) {
      case 'send-message':
        return [
          { freq: 220, endFreq: 329.63, delay: 0, duration: 0.2, gain: 0.055, type: 'sine' },
          { freq: 440, delay: 0.05, duration: 0.2, gain: 0.025, type: 'sine' },
        ];
      case 'receive-message':
        return [
          { freq: 261.63, delay: 0, duration: 0.22, gain: 0.055, type: 'sine' },
          { freq: 392.0, delay: 0.09, duration: 0.28, gain: 0.045, type: 'triangle' },
        ];
      case 'portal-activation':
        return [
          { freq: 146.83, endFreq: 220.0, delay: 0, duration: 0.26, gain: 0.05, type: 'sine' },
          { freq: 293.66, endFreq: 392.0, delay: 0.06, duration: 0.28, gain: 0.032, type: 'triangle' },
        ];
      case 'streak-milestone':
        return [
          { freq: 130.81, delay: 0, duration: 0.48, gain: 0.055, type: 'sine', filterFreq: 1200 },
          { freq: 196.0, delay: 0.08, duration: 0.34, gain: 0.048, type: 'triangle', filterFreq: 1600 },
          { freq: 246.94, delay: 0.16, duration: 0.34, gain: 0.044, type: 'sine', filterFreq: 1800 },
          { freq: 293.66, delay: 0.24, duration: 0.38, gain: 0.044, type: 'sine', filterFreq: 2100 },
          { freq: 392.0, delay: 0.32, duration: 0.62, gain: 0.046, type: 'sine', filterFreq: 2400 },
          { freq: 392.0, delay: 0.33, duration: 0.62, gain: 0.024, type: 'triangle', detune: 6, filterFreq: 2200 },
        ];
      case 'reaction':
        return [
          { freq: 392, endFreq: 523.25, delay: 0, duration: 0.14, gain: 0.04, type: 'sine' },
        ];
      case 'friend_accept':
        return [
          { freq: 196, delay: 0, duration: 0.2, gain: 0.055, type: 'sine' },
          { freq: 293.66, delay: 0.09, duration: 0.24, gain: 0.05, type: 'sine' },
          { freq: 440, delay: 0.18, duration: 0.34, gain: 0.04, type: 'triangle' },
        ];
      case 'notification':
      default:
        return [
          { freq: 246.94, delay: 0, duration: 0.22, gain: 0.055, type: 'sine' },
          { freq: 369.99, delay: 0.1, duration: 0.32, gain: 0.045, type: 'sine' },
        ];
    }
  }

  // Minimal pack
  switch (event) {
    case 'send-message':
      return [{ freq: 620, endFreq: 740, delay: 0, duration: 0.075, gain: 0.032, type: 'sine' }];
    case 'receive-message':
      return [{ freq: 720, delay: 0, duration: 0.09, gain: 0.035, type: 'sine' }];
    case 'portal-activation':
      return [
        { freq: 480, endFreq: 640, delay: 0, duration: 0.1, gain: 0.028, type: 'sine' },
      ];
    case 'streak-milestone':
      return [
        { freq: 587.33, delay: 0, duration: 0.11, gain: 0.032, type: 'sine' },
        { freq: 739.99, delay: 0.065, duration: 0.12, gain: 0.034, type: 'sine' },
        { freq: 880.0, delay: 0.13, duration: 0.14, gain: 0.035, type: 'sine' },
        { freq: 1174.66, delay: 0.195, duration: 0.24, gain: 0.038, type: 'sine' },
      ];
    case 'reaction':
      return [{ freq: 880, delay: 0, duration: 0.06, gain: 0.025, type: 'sine' }];
    case 'friend_accept':
      return [
        { freq: 587.33, delay: 0, duration: 0.08, gain: 0.035, type: 'sine' },
        { freq: 880, delay: 0.07, duration: 0.12, gain: 0.035, type: 'sine' },
      ];
    case 'notification':
    default:
      return [
        { freq: 698.46, delay: 0, duration: 0.085, gain: 0.035, type: 'sine' },
        { freq: 932.33, delay: 0.075, duration: 0.12, gain: 0.03, type: 'sine' },
      ];
  }
}

export function playMagicalSound(
  event: MagicalSoundEvent,
  pack: SoundPackId,
  enabled: boolean,
  forcePreview = false
): void {
  if (!enabled && !forcePreview) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const steps = getToneSequence(event, pack);
  const baseTime = ctx.currentTime + 0.01;

  for (const step of steps) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = baseTime + step.delay;
      const end = start + step.duration;

      osc.type = step.type;
      osc.frequency.setValueAtTime(step.freq, start);
      if (step.detune) {
        osc.detune.setValueAtTime(step.detune, start);
      }
      if (step.endFreq) {
        osc.frequency.exponentialRampToValueAtTime(step.endFreq, end);
      }

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(step.gain, start + Math.min(0.02, step.duration * 0.25));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      if (step.filterFreq) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(step.filterFreq, start);
        filter.Q.setValueAtTime(0.8, start);
        osc.connect(filter);
        filter.connect(gain);
      } else {
        osc.connect(gain);
      }

      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(end + 0.02);
    } catch {
      // ignore individual oscillator failure
    }
  }
}
