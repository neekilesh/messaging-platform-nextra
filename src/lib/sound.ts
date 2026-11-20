import { useCallback, useEffect, useState } from 'react';
import { audioManager } from '../audio/AudioManager';
import type { SoundEventId as UnifiedSoundEventId } from '../audio/SoundRegistry';
import {
  NEXORA_SOUND_PACKS as UNIFIED_PACKS,
  type SoundPackId,
  type SoundSettings,
} from '../audio/SoundSettings';

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
  audioManager.play(event, options);
}

export function useSoundPrefs() {
  const [settings, setSettings] = useState<SoundSettings>(() => audioManager.getSettings());

  useEffect(() => {
    return audioManager.subscribe(setSettings);
  }, []);

  const setSoundEnabled = useCallback((masterEnabled: boolean) => {
    audioManager.updateSettings({ masterEnabled });
  }, []);

  const setSoundVolume = useCallback((volume: number) => {
    audioManager.updateSettings({ volume });
  }, []);

  const setReadSoundEnabled = useCallback((readSoundEnabled: boolean) => {
    audioManager.updateSettings({ readSoundEnabled });
  }, []);

  const setUiClickEnabled = useCallback((uiEnabled: boolean) => {
    audioManager.updateSettings({ uiEnabled });
  }, []);

  const setSoundPack = useCallback((soundPack: NexoraSoundPackId) => {
    audioManager.updateSettings({ soundPack });
  }, []);

  const previewPack = useCallback((packId: NexoraSoundPackId) => {
    audioManager.play('notify.friend_accepted', { force: true, packOverride: packId });
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
