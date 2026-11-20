import { audioManager } from '../audio/AudioManager';
import type { SoundEventId } from '../audio/SoundRegistry';
import {
  NEXORA_SOUND_PACKS,
  type SoundPackId,
  type SoundPackMeta,
} from '../audio/SoundSettings';

export { NEXORA_SOUND_PACKS, type SoundPackId, type SoundPackMeta };

export type MagicalSoundEvent =
  | 'send-message'
  | 'receive-message'
  | 'portal-activation'
  | 'streak-milestone'
  | 'reaction'
  | 'notification'
  | 'friend_accept';

const EVENT_MAP: Record<MagicalSoundEvent, SoundEventId> = {
  'send-message': 'message.send',
  'receive-message': 'message.receive',
  'portal-activation': 'ui.chat_open',
  'streak-milestone': 'achievement.streak_milestone',
  reaction: 'message.react',
  notification: 'notify.private',
  friend_accept: 'friend.request_accept',
};

export function playMagicalSound(
  event: MagicalSoundEvent,
  pack?: SoundPackId,
  enabled = true,
  forcePreview = false
): void {
  if (!enabled && !forcePreview) return;
  const mapped = EVENT_MAP[event] || 'notify.private';
  audioManager.play(mapped, {
    force: forcePreview,
    packOverride: pack,
  });
}
