import { useCallback, useEffect, useState } from 'react';
import { globalSoundManager, audioManager } from '../audio/GlobalSoundManager';
import type { SoundEventId as UnifiedSoundEventId } from '../audio/SoundRegistry';
import {
  NEXORA_SOUND_PACKS as UNIFIED_PACKS,
  type SoundPackId,
  type SoundSettings,
} from '../audio/SoundSettings';

export { globalSoundManager, audioManager };
export type NexoraSoundPackId = SoundPackId;
export type SoundEventId = UnifiedSoundEventId;

export const NEXORA_SOUND_PACKS = UNIFIED_PACKS;

const EXPLORED_THEMES_KEY = 'nexora_explored_themes_v1';

export function markThemeExploredAndCheckNew(themeId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(EXPLORED_THEMES_KEY);
    const explored: string[] = raw ? JSON.parse(raw) : ['dreamy-lavender'];
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

export function playSound(
  event: SoundEventId,
  options?: { force?: boolean; packOverride?: NexoraSoundPackId }
) {
  globalSoundManager.play(event, options);
}

// Dedicated helpers matching NEXORA sound specification
export const playMessageSend = () => globalSoundManager.playMessageSend();
export const playMessageReceive = (isGroup?: boolean) => globalSoundManager.playMessageReceive(isGroup);
export const playMessageDelivered = () => globalSoundManager.playMessageDelivered();
export const playMessageRead = () => globalSoundManager.playMessageRead();
export const playButtonClick = () => globalSoundManager.playButtonClick();
export const playGlassTouch = () => globalSoundManager.playGlassTouch();
export const playTabSwitch = () => globalSoundManager.playTabSwitch();
export const playChatOpen = () => globalSoundManager.playChatOpen();
export const playChatClose = () => globalSoundManager.playChatClose();
export const playFeatureOpen = () => globalSoundManager.playFeatureOpen();
export const playVoiceSend = () => globalSoundManager.playVoiceSend();
export const playVoiceReceive = () => globalSoundManager.playVoiceReceive();
export const playMediaUploadStart = () => globalSoundManager.playMediaUploadStart();
export const playMediaUploadCompleted = () => globalSoundManager.playMediaUploadCompleted();

export function useSoundPrefs() {
  const [settings, setSettings] = useState<SoundSettings>(() => globalSoundManager.getSettings());

  useEffect(() => {
    return globalSoundManager.subscribe(setSettings);
  }, []);

  const setSoundEnabled = useCallback((masterEnabled: boolean) => {
    globalSoundManager.updateSettings({ masterEnabled });
  }, []);

  const setSoundVolume = useCallback((volume: number) => {
    globalSoundManager.updateSettings({ volume });
  }, []);

  const setReadSoundEnabled = useCallback((readSoundEnabled: boolean) => {
    globalSoundManager.updateSettings({ readSoundEnabled });
  }, []);

  const setUiClickEnabled = useCallback((uiEnabled: boolean) => {
    globalSoundManager.updateSettings({ uiEnabled });
  }, []);

  const setSoundPack = useCallback((soundPack: NexoraSoundPackId) => {
    globalSoundManager.updateSettings({ soundPack });
  }, []);

  const previewPack = useCallback((packId: NexoraSoundPackId) => {
    globalSoundManager.play('notify.friend_accepted', { force: true, packOverride: packId });
  }, []);

  return {
    soundEnabled: settings.masterEnabled,
    soundVolume: settings.volume,
    readSoundEnabled: settings.readSoundEnabled,
    uiClickEnabled: settings.uiEnabled,
    soundPack: settings.soundPack,
    setSoundEnabled,
    setSoundVolume,
    setReadSoundEnabled,
    setUiClickEnabled,
    setSoundPack,
    previewPack,
  };
}
