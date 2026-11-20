import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { audioManager } from './AudioManager';
import type { SoundEventId } from './SoundRegistry';
import type {
  NotificationCategoryId,
  SoundPackId,
  SoundProfileId,
  SoundSettings,
  SoundThemeId,
} from './SoundSettings';

interface AudioContextValue {
  settings: SoundSettings;
  updateSettings: (patch: Partial<SoundSettings>) => void;
  setProfile: (profile: SoundProfileId) => void;
  setSoundTheme: (theme: SoundThemeId) => void;
  setCategoryTheme: (category: NotificationCategoryId, theme: SoundThemeId) => void;
  play: (
    event: SoundEventId,
    options?: { force?: boolean; packOverride?: SoundPackId; themeOverride?: SoundThemeId }
  ) => void;
  preview: (
    event: SoundEventId,
    packOverride?: SoundPackId,
    themeOverride?: SoundThemeId
  ) => void;
  setVoiceRecordingActive: (active: boolean) => void;
  triggerHaptic: (ms?: number) => void;
}

const AudioContextReact = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SoundSettings>(() => audioManager.getSettings());

  useEffect(() => {
    return audioManager.subscribe(setSettings);
  }, []);

  const updateSettings = useCallback((patch: Partial<SoundSettings>) => {
    audioManager.updateSettings(patch);
  }, []);

  const setProfile = useCallback((profile: SoundProfileId) => {
    audioManager.setProfile(profile);
  }, []);

  const setSoundTheme = useCallback((theme: SoundThemeId) => {
    audioManager.setSoundTheme(theme);
  }, []);

  const setCategoryTheme = useCallback((category: NotificationCategoryId, theme: SoundThemeId) => {
    audioManager.setCategoryTheme(category, theme);
  }, []);

  const play = useCallback(
    (
      event: SoundEventId,
      options?: { force?: boolean; packOverride?: SoundPackId; themeOverride?: SoundThemeId }
    ) => {
      audioManager.play(event, options);
    },
    []
  );

  const preview = useCallback(
    (event: SoundEventId, packOverride?: SoundPackId, themeOverride?: SoundThemeId) => {
      audioManager.play(event, { force: true, packOverride, themeOverride });
    },
    []
  );

  const setVoiceRecordingActive = useCallback((active: boolean) => {
    audioManager.setVoiceRecordingActive(active);
  }, []);

  const triggerHaptic = useCallback((ms?: number) => {
    audioManager.triggerHaptic(ms);
  }, []);

  const value = useMemo<AudioContextValue>(
    () => ({
      settings,
      updateSettings,
      setProfile,
      setSoundTheme,
      setCategoryTheme,
      play,
      preview,
      setVoiceRecordingActive,
      triggerHaptic,
    }),
    [
      settings,
      updateSettings,
      setProfile,
      setSoundTheme,
      setCategoryTheme,
      play,
      preview,
      setVoiceRecordingActive,
      triggerHaptic,
    ]
  );

  return <AudioContextReact.Provider value={value}>{children}</AudioContextReact.Provider>;
}

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioContextReact);
  if (!ctx) {
    return {
      settings: audioManager.getSettings(),
      updateSettings: (patch) => audioManager.updateSettings(patch),
      setProfile: (p) => audioManager.setProfile(p),
      setSoundTheme: (t) => audioManager.setSoundTheme(t),
      setCategoryTheme: (c, t) => audioManager.setCategoryTheme(c, t),
      play: (ev, opt) => audioManager.play(ev, opt),
      preview: (ev, pack, theme) =>
        audioManager.play(ev, { force: true, packOverride: pack, themeOverride: theme }),
      setVoiceRecordingActive: (a) => audioManager.setVoiceRecordingActive(a),
      triggerHaptic: (ms) => audioManager.triggerHaptic(ms),
    };
  }
  return ctx;
}
