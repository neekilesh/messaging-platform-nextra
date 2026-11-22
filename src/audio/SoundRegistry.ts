import type { SoundCategory, SoundThemeId } from './SoundSettings';

export type SoundEventId =
  // Signature Startup
  | 'app.awakening'
  // Messages
  | 'message.send'
  | 'message.receive'
  | 'message.delivered'
  | 'message.read'
  | 'message.failed'
  | 'message.retry'
  | 'message.deleted'
  | 'message.react'
  | 'message.reply'
  | 'message.copy'
  // Groups
  | 'group.create'
  | 'group.join'
  | 'group.leave'
  | 'group.send'
  | 'group.receive'
  | 'group.invite'
  | 'group.mention'
  | 'group.member_add'
  | 'group.member_remove'
  | 'group.settings_updated'
  // Notifications
  | 'notify.private'
  | 'notify.group'
  | 'notify.friend_request'
  | 'notify.friend_accepted'
  | 'notify.mention'
  | 'notify.story_new'
  | 'notify.story_reply'
  | 'notify.streak_milestone'
  | 'notify.security_alert'
  // Voice
  | 'voice.record_start'
  | 'voice.record_stop'
  | 'voice.send'
  | 'voice.receive'
  | 'voice.play_start'
  | 'voice.play_end'
  | 'voice.delete'
  // Media
  | 'media.menu_open'
  | 'media.select'
  | 'media.preview_open'
  | 'media.preview_close'
  | 'media.upload_start'
  | 'media.upload_success'
  | 'media.upload_error'
  | 'media.download'
  // Stories
  | 'story.open'
  | 'story.next'
  | 'story.prev'
  | 'story.loaded'
  | 'story.reaction'
  | 'story.reply'
  | 'story.upload'
  | 'story.delete'
  | 'story.close'
  // Friends
  | 'friend.request_send'
  | 'friend.request_accept'
  | 'friend.request_decline'
  | 'friend.profile_open'
  // Achievements & Streaks
  | 'achievement.streak_started'
  | 'achievement.streak_milestone'
  | 'achievement.celestial_unlock'
  // Liquid Glass UI & Profile
  | 'ui.glass_touch'
  | 'ui.glass_open'
  | 'ui.glass_close'
  | 'ui.feature_open'
  | 'ui.chat_open'
  | 'ui.chat_close'
  | 'ui.menu_open'
  | 'ui.nav_switch'
  | 'ui.tab_switch'
  | 'ui.click'
  | 'ui.theme_change'
  | 'ui.theme_unlock'
  | 'ui.settings_saved'
  | 'ui.logout';

export interface ToneStep {
  freq: number;
  freqEnd?: number;
  delay?: number;
  duration: number;
  gain: number;
  wave?: OscillatorType;
  detune?: number;
  filterFreq?: number;
}

export interface SoundDefinition {
  category: SoundCategory;
  cooldownMs: number;
  priority: number; // higher priority overrides/bypasses suppression
  hapticMs?: number;
  ignorePackPitch?: boolean;
  steps: ToneStep[];
}

export function adaptPlaybackPattern(
  steps: ToneStep[],
  themeId: SoundThemeId,
  ignorePackPitch = false
): ToneStep[] {
  if (steps.length === 0) return [];

  if (themeId === 'minimal') {
    const condensed = steps.length > 2 ? steps.slice(0, 2) : steps;
    return condensed.map((step, idx) => ({
      ...step,
      delay: Number(((step.delay ?? 0) * 0.5).toFixed(4)),
      duration: Number(Math.max(0.024, step.duration * (idx === 0 ? 0.62 : 0.55)).toFixed(4)),
      gain: Number((step.gain * 0.75).toFixed(4)),
      wave: 'sine',
    }));
  }

  if (themeId === 'balanced') {
    const capped = steps.length > 3 ? steps.slice(0, 3) : steps;
    return capped.map((step) => ({
      ...step,
      delay: Number(((step.delay ?? 0) * 0.9).toFixed(4)),
      duration: Number(Math.max(0.026, step.duration * 0.92).toFixed(4)),
    }));
  }

  // 'magical': expansive harmonic cadence + subtle crystalline shimmer tail on melodic cues
  const expanded = steps.map((step) => ({
    ...step,
    duration: Number((step.duration * 1.12).toFixed(4)),
  }));

  if (steps.length >= 2 && !ignorePackPitch) {
    const last = expanded[expanded.length - 1];
    const shimmerFreq = Math.min(4800, Number(((last.freqEnd ?? last.freq) * 1.5).toFixed(2)));
    expanded.push({
      freq: shimmerFreq,
      delay: Number(((last.delay ?? 0) + 0.065).toFixed(4)),
      duration: Number(Math.min(0.48, Math.max(0.2, last.duration * 1.1)).toFixed(4)),
      gain: Number(Math.max(0.032, last.gain * 0.42).toFixed(4)),
      wave: 'sine',
      detune: 7,
      filterFreq: 5400,
    });
  }

  return expanded;
}

export const SIGNATURE_PREVIEW_EVENTS: Array<{
  id: SoundEventId;
  label: string;
  subtitle: string;
}> = [
  { id: 'app.awakening', label: 'NEXORA Awakening', subtitle: 'Soft glass startup shimmer' },
  { id: 'message.send', label: 'Message Pulse', subtitle: 'Crisp crystal send pulse' },
  { id: 'notify.private', label: 'Cosmic Signal', subtitle: 'Melodic incoming chime' },
  { id: 'ui.glass_touch', label: 'Glass Touch', subtitle: 'Tactile Liquid Glass tap' },
  { id: 'ui.chat_open', label: 'Celestial Transition', subtitle: 'Airy portal movement' },
];

export const SOUND_REGISTRY: Record<SoundEventId, SoundDefinition> = {
  // 1. NEXORA Awakening (~1.1s soft harmonic glass shimmer)
  'app.awakening': {
    category: 'app',
    cooldownMs: 4000,
    priority: 4,
    steps: [
      { freq: 293.66, duration: 0.72, gain: 0.14, wave: 'sine', filterFreq: 3200 },
      { freq: 440.0, delay: 0.08, duration: 0.76, gain: 0.13, wave: 'sine', filterFreq: 3600 },
      { freq: 587.33, delay: 0.16, duration: 0.8, gain: 0.12, wave: 'triangle', filterFreq: 4200 },
      { freq: 880.0, delay: 0.25, duration: 0.85, gain: 0.09, wave: 'sine', detune: 5, filterFreq: 5200 },
    ],
  },

  // 2. NEXORA Message Send: Soft outgoing message pop
  'message.send': {
    category: 'messages',
    cooldownMs: 80,
    priority: 3,
    hapticMs: 10,
    steps: [
      { freq: 460, freqEnd: 740, duration: 0.09, gain: 0.22, wave: 'sine', filterFreq: 4200 },
      { freq: 920, freqEnd: 1100, delay: 0.02, duration: 0.07, gain: 0.1, wave: 'triangle', filterFreq: 5000 },
    ],
  },

  // 3. NEXORA Message Receive: Gentle incoming message notification
  'message.receive': {
    category: 'messages',
    cooldownMs: 250,
    priority: 4,
    hapticMs: 12,
    steps: [
      { freq: 659.25, duration: 0.16, gain: 0.2, wave: 'sine', filterFreq: 4600 },
      { freq: 880.0, delay: 0.07, duration: 0.28, gain: 0.18, wave: 'sine', filterFreq: 5200 },
      { freq: 1174.66, delay: 0.14, duration: 0.35, gain: 0.11, wave: 'triangle', filterFreq: 5600 },
    ],
  },

  // Subtle delivery confirmation
  'message.delivered': {
    category: 'messages',
    cooldownMs: 150,
    priority: 1,
    steps: [
      { freq: 880, duration: 0.04, gain: 0.08, wave: 'sine', filterFreq: 4000 },
      { freq: 1174.66, delay: 0.035, duration: 0.05, gain: 0.07, wave: 'sine', filterFreq: 4600 },
    ],
  },

  // Very subtle read confirmation, if enabled
  'message.read': {
    category: 'messages',
    cooldownMs: 200,
    priority: 1,
    steps: [
      { freq: 1318.51, duration: 0.06, gain: 0.05, wave: 'sine', filterFreq: 5000 },
      { freq: 1760.0, delay: 0.035, duration: 0.09, gain: 0.045, wave: 'sine', filterFreq: 5800 },
    ],
  },

  'message.failed': {
    category: 'messages',
    cooldownMs: 300,
    priority: 4,
    hapticMs: 18,
    ignorePackPitch: true,
    steps: [
      { freq: 240, freqEnd: 180, duration: 0.16, gain: 0.2, wave: 'triangle' },
      { freq: 190, freqEnd: 145, delay: 0.12, duration: 0.2, gain: 0.16, wave: 'sine' },
    ],
  },

  'message.retry': {
    category: 'messages',
    cooldownMs: 200,
    priority: 2,
    steps: [
      { freq: 420, freqEnd: 620, duration: 0.11, gain: 0.13, wave: 'sine' },
    ],
  },

  'message.deleted': {
    category: 'messages',
    cooldownMs: 140,
    priority: 2,
    steps: [
      { freq: 480, freqEnd: 185, duration: 0.18, gain: 0.14, wave: 'sine' },
      { freq: 310, freqEnd: 125, delay: 0.03, duration: 0.17, gain: 0.09, wave: 'triangle' },
    ],
  },

  'message.react': {
    category: 'messages',
    cooldownMs: 100,
    priority: 2,
    hapticMs: 8,
    steps: [
      { freq: 880, duration: 0.075, gain: 0.12, wave: 'sine' },
      { freq: 1174.66, delay: 0.04, duration: 0.09, gain: 0.11, wave: 'sine' },
      { freq: 1567.98, delay: 0.085, duration: 0.13, gain: 0.1, wave: 'sine' },
    ],
  },

  'message.reply': {
    category: 'messages',
    cooldownMs: 100,
    priority: 2,
    hapticMs: 6,
    steps: [{ freq: 680, freqEnd: 820, duration: 0.065, gain: 0.09, wave: 'sine' }],
  },

  'message.copy': {
    category: 'messages',
    cooldownMs: 120,
    priority: 1,
    hapticMs: 6,
    steps: [
      { freq: 780, duration: 0.05, gain: 0.08, wave: 'sine' },
      { freq: 1040, delay: 0.04, duration: 0.06, gain: 0.07, wave: 'sine' },
    ],
  },

  // Groups
  'group.create': {
    category: 'messages',
    cooldownMs: 300,
    priority: 3,
    hapticMs: 12,
    steps: [
      { freq: 440, duration: 0.11, gain: 0.15, wave: 'sine' },
      { freq: 554.37, delay: 0.06, duration: 0.12, gain: 0.15, wave: 'sine' },
      { freq: 659.25, delay: 0.12, duration: 0.2, gain: 0.16, wave: 'triangle' },
    ],
  },

  'group.join': {
    category: 'messages',
    cooldownMs: 250,
    priority: 2,
    steps: [
      { freq: 493.88, duration: 0.11, gain: 0.13 },
      { freq: 739.99, delay: 0.06, duration: 0.18, gain: 0.14 },
    ],
  },

  'group.leave': {
    category: 'messages',
    cooldownMs: 250,
    priority: 2,
    steps: [
      { freq: 523.25, freqEnd: 349.23, duration: 0.18, gain: 0.13 },
    ],
  },

  'group.send': {
    category: 'messages',
    cooldownMs: 90,
    priority: 3,
    hapticMs: 10,
    steps: [
      { freq: 392, freqEnd: 587.33, duration: 0.13, gain: 0.18, wave: 'sine' },
      { freq: 784, delay: 0.04, duration: 0.14, gain: 0.1, wave: 'triangle' },
    ],
  },

  'group.receive': {
    category: 'messages',
    cooldownMs: 500,
    priority: 3,
    steps: [
      { freq: 440, duration: 0.11, gain: 0.15 },
      { freq: 554.37, delay: 0.06, duration: 0.13, gain: 0.15 },
      { freq: 659.25, delay: 0.12, duration: 0.22, gain: 0.15 },
    ],
  },

  'group.invite': {
    category: 'notifications',
    cooldownMs: 450,
    priority: 3,
    steps: [
      { freq: 523.25, duration: 0.12, gain: 0.16 },
      { freq: 659.25, delay: 0.07, duration: 0.18, gain: 0.16 },
    ],
  },

  'group.mention': {
    category: 'notifications',
    cooldownMs: 350,
    priority: 4,
    hapticMs: 12,
    steps: [
      { freq: 880, duration: 0.1, gain: 0.2 },
      { freq: 1318.51, delay: 0.07, duration: 0.26, gain: 0.2 },
    ],
  },

  'group.member_add': {
    category: 'messages',
    cooldownMs: 200,
    priority: 2,
    steps: [
      { freq: 523.25, duration: 0.09, gain: 0.13 },
      { freq: 783.99, delay: 0.06, duration: 0.14, gain: 0.13 },
    ],
  },

  'group.member_remove': {
    category: 'messages',
    cooldownMs: 200,
    priority: 2,
    steps: [{ freq: 440, freqEnd: 293.66, duration: 0.15, gain: 0.12 }],
  },

  'group.settings_updated': {
    category: 'ui',
    cooldownMs: 200,
    priority: 2,
    steps: [
      { freq: 523.25, duration: 0.09, gain: 0.13 },
      { freq: 783.99, delay: 0.06, duration: 0.16, gain: 0.13 },
    ],
  },

  // Notifications
  'notify.private': {
    category: 'notifications',
    cooldownMs: 450,
    priority: 3,
    steps: [
      { freq: 659.25, duration: 0.16, gain: 0.19, wave: 'sine' },
      { freq: 987.77, delay: 0.08, duration: 0.28, gain: 0.18, wave: 'sine' },
      { freq: 1318.51, delay: 0.16, duration: 0.34, gain: 0.1, wave: 'triangle' },
    ],
  },

  'notify.group': {
    category: 'notifications',
    cooldownMs: 650,
    priority: 3,
    steps: [
      { freq: 440, duration: 0.11, gain: 0.16 },
      { freq: 554.37, delay: 0.06, duration: 0.13, gain: 0.16 },
      { freq: 659.25, delay: 0.12, duration: 0.24, gain: 0.17 },
    ],
  },

  'notify.friend_request': {
    category: 'notifications',
    cooldownMs: 400,
    priority: 3,
    steps: [
      { freq: 523.25, duration: 0.12, gain: 0.17 },
      { freq: 659.25, delay: 0.075, duration: 0.14, gain: 0.17 },
      { freq: 783.99, delay: 0.15, duration: 0.24, gain: 0.18 },
    ],
  },

  'notify.friend_accepted': {
    category: 'notifications',
    cooldownMs: 350,
    priority: 3,
    hapticMs: 12,
    steps: [
      { freq: 392, duration: 0.11, gain: 0.17 },
      { freq: 493.88, delay: 0.065, duration: 0.13, gain: 0.17 },
      { freq: 587.33, delay: 0.13, duration: 0.15, gain: 0.18 },
      { freq: 783.99, delay: 0.2, duration: 0.32, gain: 0.2 },
    ],
  },

  'notify.mention': {
    category: 'notifications',
    cooldownMs: 350,
    priority: 4,
    steps: [
      { freq: 880, duration: 0.1, gain: 0.2 },
      { freq: 1318.51, delay: 0.07, duration: 0.26, gain: 0.2 },
    ],
  },

  'notify.story_new': {
    category: 'notifications',
    cooldownMs: 500,
    priority: 2,
    steps: [
      { freq: 587.33, freqEnd: 880, duration: 0.2, gain: 0.14, wave: 'sine' },
      { freq: 1174.66, delay: 0.09, duration: 0.24, gain: 0.12, wave: 'sine' },
    ],
  },

  'notify.story_reply': {
    category: 'notifications',
    cooldownMs: 450,
    priority: 3,
    steps: [
      { freq: 659.25, duration: 0.12, gain: 0.17 },
      { freq: 987.77, delay: 0.08, duration: 0.24, gain: 0.17 },
    ],
  },

  'notify.streak_milestone': {
    category: 'achievements',
    cooldownMs: 800,
    priority: 4,
    hapticMs: 16,
    steps: [
      { freq: 523.25, duration: 0.11, gain: 0.18, filterFreq: 3800 },
      { freq: 659.25, delay: 0.07, duration: 0.12, gain: 0.18, filterFreq: 4200 },
      { freq: 783.99, delay: 0.14, duration: 0.13, gain: 0.19, filterFreq: 4400 },
      { freq: 987.77, delay: 0.21, duration: 0.15, gain: 0.2, filterFreq: 4800 },
      { freq: 1046.5, delay: 0.28, duration: 0.42, gain: 0.22, filterFreq: 5400 },
    ],
  },

  'notify.security_alert': {
    category: 'notifications',
    cooldownMs: 600,
    priority: 5,
    hapticMs: 20,
    ignorePackPitch: true,
    steps: [
      { freq: 329.63, duration: 0.15, gain: 0.22, wave: 'triangle' },
      { freq: 261.63, delay: 0.14, duration: 0.17, gain: 0.2, wave: 'triangle' },
      { freq: 329.63, delay: 0.29, duration: 0.22, gain: 0.18, wave: 'sine' },
    ],
  },

  // Voice UI (only played before/after recording, never during active recording!)
  'voice.record_start': {
    category: 'voiceUi',
    cooldownMs: 200,
    priority: 4,
    hapticMs: 12,
    steps: [
      { freq: 440, duration: 0.07, gain: 0.13 },
      { freq: 660, delay: 0.055, duration: 0.1, gain: 0.14 },
    ],
  },

  'voice.record_stop': {
    category: 'voiceUi',
    cooldownMs: 200,
    priority: 4,
    hapticMs: 10,
    steps: [
      { freq: 660, duration: 0.07, gain: 0.12 },
      { freq: 493.88, delay: 0.055, duration: 0.12, gain: 0.12 },
    ],
  },

  // Sending a voice message: Soft send confirmation
  'voice.send': {
    category: 'voiceUi',
    cooldownMs: 120,
    priority: 3,
    hapticMs: 10,
    steps: [
      { freq: 440, freqEnd: 740, duration: 0.13, gain: 0.18, wave: 'sine', filterFreq: 4000 },
    ],
  },

  // Receiving a voice message: Incoming message notification
  'voice.receive': {
    category: 'messages',
    cooldownMs: 250,
    priority: 4,
    hapticMs: 12,
    steps: [
      { freq: 523.25, duration: 0.15, gain: 0.19, wave: 'sine', filterFreq: 4200 },
      { freq: 783.99, delay: 0.07, duration: 0.26, gain: 0.17, wave: 'sine', filterFreq: 4800 },
      { freq: 1046.5, delay: 0.14, duration: 0.32, gain: 0.1, wave: 'triangle', filterFreq: 5200 },
    ],
  },

  'voice.play_start': {
    category: 'voiceUi',
    cooldownMs: 150,
    priority: 2,
    steps: [{ freq: 520, freqEnd: 640, duration: 0.055, gain: 0.085 }],
  },

  'voice.play_end': {
    category: 'voiceUi',
    cooldownMs: 150,
    priority: 1,
    steps: [{ freq: 620, freqEnd: 480, duration: 0.08, gain: 0.075 }],
  },

  'voice.delete': {
    category: 'voiceUi',
    cooldownMs: 150,
    priority: 2,
    steps: [{ freq: 420, freqEnd: 180, duration: 0.14, gain: 0.11 }],
  },

  // Media
  'media.menu_open': {
    category: 'ui',
    cooldownMs: 120,
    priority: 1,
    steps: [{ freq: 420, freqEnd: 580, duration: 0.08, gain: 0.09 }],
  },

  'media.select': {
    category: 'ui',
    cooldownMs: 120,
    priority: 1,
    steps: [{ freq: 640, duration: 0.06, gain: 0.09 }],
  },

  'media.preview_open': {
    category: 'ui',
    cooldownMs: 140,
    priority: 2,
    steps: [
      { freq: 380, freqEnd: 620, duration: 0.14, gain: 0.11 },
      { freq: 760, delay: 0.04, duration: 0.14, gain: 0.08 },
    ],
  },

  'media.preview_close': {
    category: 'ui',
    cooldownMs: 140,
    priority: 1,
    steps: [{ freq: 540, freqEnd: 320, duration: 0.12, gain: 0.09 }],
  },

  // Uploading media: Subtle upload start sound
  'media.upload_start': {
    category: 'messages',
    cooldownMs: 150,
    priority: 2,
    steps: [{ freq: 440, freqEnd: 620, duration: 0.08, gain: 0.09, wave: 'sine', filterFreq: 3800 }],
  },

  // Media upload completed: Bright confirmation chime
  'media.upload_success': {
    category: 'messages',
    cooldownMs: 180,
    priority: 3,
    hapticMs: 10,
    steps: [
      { freq: 659.25, duration: 0.1, gain: 0.15, wave: 'sine', filterFreq: 4600 },
      { freq: 987.77, delay: 0.05, duration: 0.14, gain: 0.14, wave: 'sine', filterFreq: 5200 },
      { freq: 1318.51, delay: 0.11, duration: 0.24, gain: 0.13, wave: 'triangle', filterFreq: 5800 },
    ],
  },

  'media.upload_error': {
    category: 'messages',
    cooldownMs: 300,
    priority: 4,
    ignorePackPitch: true,
    steps: [{ freq: 220, freqEnd: 155, duration: 0.18, gain: 0.18, wave: 'triangle' }],
  },

  'media.download': {
    category: 'ui',
    cooldownMs: 200,
    priority: 2,
    steps: [
      { freq: 659.25, duration: 0.08, gain: 0.11 },
      { freq: 880, delay: 0.05, duration: 0.14, gain: 0.11 },
    ],
  },

  // Stories
  'story.open': {
    category: 'stories',
    cooldownMs: 180,
    priority: 2,
    steps: [
      { freq: 329.63, freqEnd: 659.25, duration: 0.22, gain: 0.13, wave: 'sine' },
      { freq: 987.77, delay: 0.06, duration: 0.22, gain: 0.09, wave: 'sine' },
    ],
  },

  'story.next': {
    category: 'stories',
    cooldownMs: 90,
    priority: 1,
    steps: [{ freq: 620, freqEnd: 780, duration: 0.065, gain: 0.08, wave: 'sine' }],
  },

  'story.prev': {
    category: 'stories',
    cooldownMs: 90,
    priority: 1,
    steps: [{ freq: 720, freqEnd: 560, duration: 0.065, gain: 0.08, wave: 'sine' }],
  },

  'story.loaded': {
    category: 'stories',
    cooldownMs: 250,
    priority: 1,
    steps: [{ freq: 880, duration: 0.07, gain: 0.055, wave: 'sine' }],
  },

  'story.reaction': {
    category: 'stories',
    cooldownMs: 110,
    priority: 2,
    hapticMs: 8,
    steps: [
      { freq: 880, duration: 0.07, gain: 0.12 },
      { freq: 1318.51, delay: 0.045, duration: 0.12, gain: 0.11 },
    ],
  },

  'story.reply': {
    category: 'stories',
    cooldownMs: 150,
    priority: 3,
    hapticMs: 10,
    steps: [
      { freq: 523.25, freqEnd: 783.99, duration: 0.14, gain: 0.16 },
    ],
  },

  'story.upload': {
    category: 'stories',
    cooldownMs: 250,
    priority: 3,
    steps: [
      { freq: 587.33, duration: 0.1, gain: 0.14 },
      { freq: 880, delay: 0.06, duration: 0.18, gain: 0.15 },
    ],
  },

  'story.delete': {
    category: 'stories',
    cooldownMs: 200,
    priority: 2,
    steps: [{ freq: 440, freqEnd: 200, duration: 0.16, gain: 0.12 }],
  },

  'story.close': {
    category: 'stories',
    cooldownMs: 180,
    priority: 1,
    steps: [{ freq: 520, freqEnd: 290, duration: 0.15, gain: 0.1 }],
  },

  // Friends
  'friend.request_send': {
    category: 'notifications',
    cooldownMs: 250,
    priority: 2,
    hapticMs: 10,
    steps: [
      { freq: 523.25, duration: 0.1, gain: 0.14 },
      { freq: 783.99, delay: 0.06, duration: 0.16, gain: 0.15 },
    ],
  },

  'friend.request_accept': {
    category: 'notifications',
    cooldownMs: 300,
    priority: 3,
    hapticMs: 12,
    steps: [
      { freq: 440, duration: 0.1, gain: 0.15 },
      { freq: 554.37, delay: 0.06, duration: 0.12, gain: 0.15 },
      { freq: 880, delay: 0.12, duration: 0.22, gain: 0.17 },
    ],
  },

  'friend.request_decline': {
    category: 'ui',
    cooldownMs: 200,
    priority: 1,
    steps: [{ freq: 392, freqEnd: 280, duration: 0.12, gain: 0.09 }],
  },

  'friend.profile_open': {
    category: 'ui',
    cooldownMs: 150,
    priority: 1,
    steps: [{ freq: 460, freqEnd: 620, duration: 0.09, gain: 0.09 }],
  },

  // Achievements
  'achievement.streak_started': {
    category: 'achievements',
    cooldownMs: 600,
    priority: 3,
    steps: [
      { freq: 523.25, duration: 0.1, gain: 0.15 },
      { freq: 659.25, delay: 0.07, duration: 0.12, gain: 0.15 },
      { freq: 1046.5, delay: 0.14, duration: 0.24, gain: 0.16 },
    ],
  },

  'achievement.streak_milestone': {
    category: 'achievements',
    cooldownMs: 800,
    priority: 4,
    hapticMs: 16,
    steps: [
      { freq: 523.25, duration: 0.11, gain: 0.18 },
      { freq: 659.25, delay: 0.07, duration: 0.12, gain: 0.18 },
      { freq: 783.99, delay: 0.14, duration: 0.13, gain: 0.19 },
      { freq: 1046.5, delay: 0.21, duration: 0.36, gain: 0.21 },
    ],
  },

  'achievement.celestial_unlock': {
    category: 'achievements',
    cooldownMs: 600,
    priority: 4,
    hapticMs: 14,
    steps: [
      { freq: 523.25, duration: 0.12, gain: 0.17 },
      { freq: 659.25, delay: 0.06, duration: 0.12, gain: 0.17 },
      { freq: 783.99, delay: 0.12, duration: 0.14, gain: 0.18 },
      { freq: 1046.5, delay: 0.18, duration: 0.22, gain: 0.2 },
      { freq: 1318.51, delay: 0.24, duration: 0.32, gain: 0.17 },
    ],
  },

  // Liquid Glass UI & Transitions
  // Button click & glass touch: Soft tactile click
  'ui.glass_touch': {
    category: 'ui',
    cooldownMs: 40,
    priority: 1,
    hapticMs: 5,
    ignorePackPitch: true,
    steps: [
      { freq: 780, freqEnd: 420, duration: 0.028, gain: 0.065, wave: 'sine', filterFreq: 3200 },
    ],
  },

  'ui.click': {
    category: 'ui',
    cooldownMs: 40,
    priority: 1,
    hapticMs: 5,
    ignorePackPitch: true,
    steps: [
      { freq: 780, freqEnd: 420, duration: 0.028, gain: 0.065, wave: 'sine', filterFreq: 3200 },
    ],
  },

  // Opening a feature / glass dialog: Subtle magical transition
  'ui.feature_open': {
    category: 'ui',
    cooldownMs: 120,
    priority: 2,
    hapticMs: 8,
    steps: [
      { freq: 440, duration: 0.11, gain: 0.12, wave: 'sine', filterFreq: 3800 },
      { freq: 659.25, delay: 0.05, duration: 0.14, gain: 0.11, wave: 'sine', filterFreq: 4400 },
      { freq: 880, delay: 0.1, duration: 0.22, gain: 0.1, wave: 'triangle', filterFreq: 5200 },
    ],
  },

  'ui.glass_open': {
    category: 'ui',
    cooldownMs: 120,
    priority: 2,
    hapticMs: 8,
    steps: [
      { freq: 440, duration: 0.11, gain: 0.12, wave: 'sine', filterFreq: 3800 },
      { freq: 659.25, delay: 0.05, duration: 0.14, gain: 0.11, wave: 'sine', filterFreq: 4400 },
      { freq: 880, delay: 0.1, duration: 0.22, gain: 0.1, wave: 'triangle', filterFreq: 5200 },
    ],
  },

  'ui.glass_close': {
    category: 'ui',
    cooldownMs: 120,
    priority: 1,
    steps: [{ freq: 587.33, freqEnd: 392.0, duration: 0.14, gain: 0.095, wave: 'sine', filterFreq: 3400 }],
  },

  // Opening a chat: Gentle glass-like opening sound
  'ui.chat_open': {
    category: 'ui',
    cooldownMs: 120,
    priority: 2,
    hapticMs: 8,
    steps: [
      { freq: 392.0, freqEnd: 587.33, duration: 0.16, gain: 0.13, wave: 'sine', filterFreq: 3600 },
      { freq: 783.99, delay: 0.04, duration: 0.2, gain: 0.1, wave: 'sine', filterFreq: 4400 },
    ],
  },

  // Closing a chat: Soft closing sound
  'ui.chat_close': {
    category: 'ui',
    cooldownMs: 120,
    priority: 1,
    steps: [{ freq: 587.33, freqEnd: 392.0, duration: 0.14, gain: 0.1, wave: 'sine', filterFreq: 3400 }],
  },

  'ui.menu_open': {
    category: 'ui',
    cooldownMs: 100,
    priority: 1,
    steps: [{ freq: 420, freqEnd: 620, duration: 0.095, gain: 0.1, wave: 'sine' }],
  },

  // Switching navigation tabs: Short transition sound
  'ui.nav_switch': {
    category: 'ui',
    cooldownMs: 60,
    priority: 1,
    hapticMs: 6,
    steps: [{ freq: 520, freqEnd: 740, duration: 0.06, gain: 0.085, wave: 'sine', filterFreq: 3800 }],
  },

  'ui.tab_switch': {
    category: 'ui',
    cooldownMs: 60,
    priority: 1,
    hapticMs: 5,
    steps: [{ freq: 520, freqEnd: 720, duration: 0.055, gain: 0.08, wave: 'sine', filterFreq: 3600 }],
  },

  'ui.theme_change': {
    category: 'ui',
    cooldownMs: 220,
    priority: 2,
    steps: [
      { freq: 440, duration: 0.15, gain: 0.13 },
      { freq: 659.25, delay: 0.06, duration: 0.17, gain: 0.12 },
      { freq: 880, delay: 0.12, duration: 0.24, gain: 0.11 },
    ],
  },

  'ui.theme_unlock': {
    category: 'achievements',
    cooldownMs: 300,
    priority: 3,
    hapticMs: 12,
    steps: [
      { freq: 523.25, duration: 0.11, gain: 0.16 },
      { freq: 659.25, delay: 0.06, duration: 0.11, gain: 0.16 },
      { freq: 783.99, delay: 0.12, duration: 0.14, gain: 0.17 },
      { freq: 1046.5, delay: 0.18, duration: 0.24, gain: 0.19 },
    ],
  },

  'ui.settings_saved': {
    category: 'ui',
    cooldownMs: 220,
    priority: 2,
    hapticMs: 8,
    steps: [
      { freq: 523.25, duration: 0.095, gain: 0.14 },
      { freq: 783.99, delay: 0.065, duration: 0.16, gain: 0.15 },
    ],
  },

  'ui.logout': {
    category: 'ui',
    cooldownMs: 400,
    priority: 2,
    steps: [
      { freq: 587.33, freqEnd: 293.66, duration: 0.22, gain: 0.13 },
    ],
  },
};
