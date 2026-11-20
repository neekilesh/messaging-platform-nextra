import { audioPreloader } from './AudioPreloader';
import { adaptPlaybackPattern, SOUND_REGISTRY, type SoundEventId } from './SoundRegistry';
import {
  getProfilePatch,
  getSoundThemeMeta,
  loadSoundSettings,
  NEXORA_SOUND_PACKS,
  saveSoundSettings,
  type NotificationCategoryId,
  type SoundCategory,
  type SoundPackId,
  type SoundPackMeta,
  type SoundProfileId,
  type SoundSettings,
  type SoundThemeId,
} from './SoundSettings';

class NexoraAudioManager {
  private settings: SoundSettings = loadSoundSettings();
  private subscribers = new Set<(s: SoundSettings) => void>();
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private lastPlayedAt = new Map<string, number>();
  private voiceRecordingActive = false;
  private awakeningPlayed = false;
  private unlockListenersBound = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.bindUnlockListeners();
    }
  }

  getSettings(): SoundSettings {
    return this.settings;
  }

  subscribe(cb: (s: SoundSettings) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private emitSettings() {
    this.subscribers.forEach((cb) => cb(this.settings));
  }

  updateSettings(patch: Partial<SoundSettings>): void {
    const prevPack = this.settings.soundPack;
    const prevTheme = this.settings.soundTheme;
    this.settings = {
      ...this.settings,
      ...patch,
      volume:
        patch.volume !== undefined
          ? Math.min(1, Math.max(0, patch.volume))
          : this.settings.volume,
      categoryThemes: patch.categoryThemes
        ? { ...this.settings.categoryThemes, ...patch.categoryThemes }
        : this.settings.categoryThemes,
    };
    saveSoundSettings(this.settings);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.settings.volume * 0.45, this.ctx.currentTime, 0.02);
    }
    if (
      (patch.soundPack && patch.soundPack !== prevPack) ||
      (patch.soundTheme && patch.soundTheme !== prevTheme)
    ) {
      audioPreloader.clear();
      if (this.ctx) {
        audioPreloader.preloadCore(
          this.ctx.sampleRate,
          this.getEffectiveCategoryMeta('notifications', this.settings.soundPack, this.settings.soundTheme),
          this.settings.soundTheme
        );
      }
    }
    this.emitSettings();
  }

  setProfile(profile: SoundProfileId): void {
    this.updateSettings(getProfilePatch(profile));
  }

  getSoundTheme(): SoundThemeId {
    return this.settings.soundTheme;
  }

  setSoundTheme(theme: SoundThemeId): void {
    this.updateSettings({
      ...getProfilePatch(theme),
      soundTheme: theme,
      soundPack: this.settings.soundPack === 'silent' ? 'nexora-default' : this.settings.soundPack,
    });
  }

  setCategoryTheme(category: NotificationCategoryId, theme: SoundThemeId): void {
    this.updateSettings({
      categoryThemes: {
        ...this.settings.categoryThemes,
        [category]: theme,
      },
    });
  }

  setVoiceRecordingActive(active: boolean): void {
    this.voiceRecordingActive = active;
  }

  isVoiceRecordingActive(): boolean {
    return this.voiceRecordingActive;
  }

  getPackMeta(packId: SoundPackId = this.settings.soundPack): SoundPackMeta {
    return NEXORA_SOUND_PACKS.find((p) => p.id === packId) || NEXORA_SOUND_PACKS[0];
  }

  private resolveCategoryThemeId(
    category: SoundCategory,
    themeOverride?: SoundThemeId
  ): SoundThemeId {
    const categoryKey: NotificationCategoryId = category === 'app' ? 'notifications' : category;
    return (
      themeOverride ??
      this.settings.categoryThemes[categoryKey] ??
      this.settings.soundTheme ??
      'magical'
    );
  }

  private getEffectiveCategoryMeta(
    category: SoundCategory,
    packId: SoundPackId,
    themeOverride?: SoundThemeId
  ): SoundPackMeta {
    const basePack = this.getPackMeta(packId);
    if (basePack.id === 'silent') return basePack;

    const themeId = this.resolveCategoryThemeId(category, themeOverride);
    const theme = getSoundThemeMeta(themeId);

    return {
      ...basePack,
      id: `${basePack.id}__${theme.id}` as SoundPackId,
      pitchScale: Number((basePack.pitchScale * theme.pitchMultiplier).toFixed(3)),
      gainScale: Number((basePack.gainScale * theme.gainMultiplier).toFixed(3)),
      wave: theme.waveOverride ?? basePack.wave,
    };
  }

  triggerHaptic(ms = 8): void {
    if (!this.settings.hapticsEnabled) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(ms);
      } catch {
        // ignore unsupported browser gesture constraints
      }
    }
  }

  private bindUnlockListeners(): void {
    if (this.unlockListenersBound) return;
    this.unlockListenersBound = true;

    const onFirstGesture = () => {
      const audio = this.ensureContext();
      if (audio) {
        audioPreloader.preloadCore(
          audio.ctx.sampleRate,
          this.getEffectiveCategoryMeta('notifications', this.settings.soundPack, this.settings.soundTheme),
          this.settings.soundTheme
        );
        if (!this.awakeningPlayed) {
          this.awakeningPlayed = true;
          this.play('app.awakening');
        }
      }
    };

    window.addEventListener('pointerdown', onFirstGesture, { passive: true, once: true });
    window.addEventListener('keydown', onFirstGesture, { passive: true, once: true });
  }

  private ensureContext(): { ctx: AudioContext; master: GainNode } | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-16, this.ctx.currentTime);
        compressor.ratio.setValueAtTime(6, this.ctx.currentTime);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(7500, this.ctx.currentTime);

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.settings.volume * 0.45, this.ctx.currentTime);

        this.masterGain.connect(filter);
        filter.connect(compressor);
        compressor.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.settings.volume * 0.45,
        this.ctx.currentTime,
        0.02
      );
    }

    return this.ctx && this.masterGain ? { ctx: this.ctx, master: this.masterGain } : null;
  }

  private isCategoryAllowed(category: SoundCategory, event: SoundEventId): boolean {
    const s = this.settings;
    if (!s.masterEnabled || s.profile === 'silent' || s.soundPack === 'silent') return false;
    if (s.volume <= 0.01) return false;
    if (event === 'message.read' && !s.readSoundEnabled) return false;

    switch (category) {
      case 'app':
        return s.profile !== 'minimal';
      case 'ui':
        return s.uiEnabled;
      case 'messages':
        return s.messagesEnabled;
      case 'notifications':
        return s.notificationsEnabled;
      case 'stories':
        return s.storiesEnabled;
      case 'voiceUi':
        return s.voiceUiEnabled;
      case 'achievements':
        return s.achievementsEnabled;
      default:
        return true;
    }
  }

  play(
    event: SoundEventId,
    options?: { force?: boolean; packOverride?: SoundPackId; themeOverride?: SoundThemeId }
  ): void {
    const def = SOUND_REGISTRY[event];
    if (!def) return;

    // Never play ambient/interface/notification audio over active voice recording
    if (this.voiceRecordingActive && !options?.force && def.category !== 'voiceUi') {
      return;
    }

    const packId = options?.packOverride ?? this.settings.soundPack;
    const effectivePackId: SoundPackId =
      options?.force && packId === 'silent' && options?.themeOverride ? 'nexora-default' : packId;
    const pack = options?.packOverride
      ? this.getPackMeta(effectivePackId)
      : this.getEffectiveCategoryMeta(def.category, effectivePackId, options?.themeOverride);

    if (!options?.force) {
      if (!this.isCategoryAllowed(def.category, event)) return;
      const now = performance.now();
      const prev = this.lastPlayedAt.get(event) ?? 0;
      if (now - prev < def.cooldownMs) return;
      this.lastPlayedAt.set(event, now);
    } else if (pack.id === 'silent') {
      // Allow previewing Silent pack smoothly as silence
      return;
    }

    if (def.hapticMs) {
      this.triggerHaptic(def.hapticMs);
    }

    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, master } = audio;

    if (options?.force) {
      master.gain.setTargetAtTime(
        Math.max(0.24, this.settings.volume * 0.45),
        ctx.currentTime,
        0.015
      );
    }

    const resolvedThemeId = this.resolveCategoryThemeId(def.category, options?.themeOverride);

    const cached = audioPreloader.getCached(pack.id, event);
    if (cached) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = cached;
        src.connect(master);
        src.start(ctx.currentTime + 0.005);
        return;
      } catch {
        // fall through to live synthesis
      }
    }

    // Live Web Audio synthesis + async buffer warm with dynamically adapted theme playback pattern
    const baseTime = ctx.currentTime + 0.008;
    const pScale = def.ignorePackPitch ? 1 : pack.pitchScale;
    const adaptedSteps = adaptPlaybackPattern(def.steps, resolvedThemeId, def.ignorePackPitch);

    for (const step of adaptedSteps) {
      try {
        const start = baseTime + (step.delay ?? 0);
        const dur = Math.max(0.02, step.duration);
        const osc = ctx.createOscillator();
        const env = ctx.createGain();

        osc.type = step.wave ?? pack.wave;
        const fStart = Math.min(8000, Math.max(60, step.freq * pScale));
        osc.frequency.setValueAtTime(fStart, start);
        if (step.detune) {
          osc.detune.setValueAtTime(step.detune, start);
        }
        if (step.freqEnd) {
          const fEnd = Math.min(8000, Math.max(60, step.freqEnd * pScale));
          osc.frequency.exponentialRampToValueAtTime(fEnd, start + dur);
        }

        const peak = Math.max(0.001, step.gain * pack.gainScale);
        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(peak, start + Math.min(0.018, dur * 0.25));
        env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

        if (step.filterFreq) {
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(step.filterFreq, start);
          filter.Q.setValueAtTime(0.8, start);
          osc.connect(filter);
          filter.connect(env);
        } else {
          osc.connect(env);
        }

        env.connect(master);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      } catch {
        // ignore isolated oscillator failure
      }
    }

    void audioPreloader.renderBuffer(ctx.sampleRate, pack, event, resolvedThemeId);
  }
}

export const audioManager = new NexoraAudioManager();
