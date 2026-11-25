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

declare global {
  interface Window {
    __nexora_global_sound_manager__?: GlobalSoundManager;
  }
}

export interface AudioDiagnosticSnapshot {
  audioContextSupported: boolean;
  offlineContextSupported: boolean;
  contextState: 'uninitialized' | AudioContextState;
  sampleRate: number | null;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  masterGainValue: number;
  targetGainValue: number;
  effectiveVolume: number;
  activeVoices: number;
  maxPolyphony: number;
  voiceRecordingInterlock: boolean;
  cachedBufferCount: number;
  totalRegisteredSounds: number;
  isMuted: boolean;
  awakeningPlayed: boolean;
}

export type DiagnosticBlockReason =
  | 'played-buffer'
  | 'played-synthesized'
  | 'resumed-and-played'
  | 'muted'
  | 'silent-profile'
  | 'silent-pack'
  | 'volume-zero'
  | 'category-disabled'
  | 'read-sound-disabled'
  | 'recording-interlock'
  | 'cooldown-active'
  | 'unsupported'
  | 'unknown-event';

export interface DiagnosticPlayResult {
  event: SoundEventId;
  played: boolean;
  reason: DiagnosticBlockReason;
  contextState: 'uninitialized' | AudioContextState;
  effectiveGain: number;
  timestamp: number;
}

export class GlobalSoundManager {
  private settings: SoundSettings = loadSoundSettings();
  private subscribers = new Set<(s: SoundSettings) => void>();
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private lastPlayedAt = new Map<string, number>();
  private voiceRecordingActive = false;
  private voiceRecordingTimeout: number | null = null;
  private awakeningPlayed = false;
  private unlockListenersBound = false;
  private delegatedClickListenerBound = false;
  private lastDelegatedClickTime = 0;
  private activeOscillatorsCount = 0;
  private maxPolyphony = 12;

  constructor() {
    if (typeof window !== 'undefined') {
      this.bindUnlockListeners();
      this.bindDelegatedClickListener();
      // Pre-warm all core sound buffers in the background with OfflineAudioContext
      setTimeout(() => {
        this.preloadAll();
      }, 50);
    }
  }

  // ---------------------------------------------------------------------------
  // Settings & Subscription Management
  // ---------------------------------------------------------------------------

  getSettings(): SoundSettings {
    return this.settings;
  }

  subscribe(cb: (s: SoundSettings) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private emitSettings(): void {
    this.subscribers.forEach((cb) => {
      try {
        cb(this.settings);
      } catch {
        // ignore subscriber error
      }
    });
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
    this.applyMasterGain();

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

  setMasterEnabled(enabled: boolean): void {
    this.updateSettings({ masterEnabled: enabled });
  }

  isMuted(): boolean {
    return !this.settings.masterEnabled || this.settings.volume <= 0.01;
  }

  setVolume(volume: number): void {
    this.updateSettings({ volume: Math.min(1, Math.max(0, volume)) });
  }

  getVolume(): number {
    return this.settings.volume;
  }

  // ---------------------------------------------------------------------------
  // Voice Recording Interlock Safety
  // ---------------------------------------------------------------------------

  setVoiceRecordingActive(active: boolean): void {
    this.voiceRecordingActive = active;
    if (this.voiceRecordingTimeout) {
      clearTimeout(this.voiceRecordingTimeout);
      this.voiceRecordingTimeout = null;
    }
    if (active) {
      // Safety auto-reset after 3 minutes so a stuck recorder never silences the app permanently
      this.voiceRecordingTimeout = setTimeout(() => {
        this.voiceRecordingActive = false;
        this.voiceRecordingTimeout = null;
      }, 180_000) as unknown as number;
    }
  }

  isVoiceRecordingActive(): boolean {
    return this.voiceRecordingActive;
  }

  // ---------------------------------------------------------------------------
  // Theme & Pack Metadata Resolution
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Haptics
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Audio Initialization & Browser Autoplay Unlock
  // ---------------------------------------------------------------------------

  private bindUnlockListeners(): void {
    if (this.unlockListenersBound) return;
    this.unlockListenersBound = true;

    const unlockGesture = () => {
      try {
        this.ensureContext();
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        if (!this.awakeningPlayed && this.ctx && this.ctx.state === 'running') {
          this.awakeningPlayed = true;
          this.play('app.awakening');
        }
      } catch {
        // never let audio initialization interfere with user gestures
      }
    };

    const events = ['click', 'pointerdown', 'touchend', 'keydown'] as const;
    events.forEach((ev) => {
      window.addEventListener(ev, unlockGesture, { passive: true, capture: true });
    });

    // Auto-resume when tab/window recovers visibility
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    });

    window.addEventListener('focus', () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    });
  }

  private bindDelegatedClickListener(): void {
    if (this.delegatedClickListenerBound) return;
    this.delegatedClickListenerBound = true;

    document.addEventListener(
      'click',
      (e) => {
        try {
          if (!this.settings.masterEnabled || !this.settings.uiEnabled) return;
          if (!(e.target instanceof Element)) return;

          const interactive = e.target.closest(
            'button, [role="button"], a[href], summary, [data-sound-click="true"]'
          ) as HTMLElement | null;
          if (!interactive) return;

          // Skip disabled elements or those marked to suppress default sound
          if (
            interactive.getAttribute('aria-disabled') === 'true' ||
            (interactive as HTMLButtonElement).disabled ||
            interactive.getAttribute('data-sound-none') === 'true' ||
            interactive.getAttribute('data-sound-custom') === 'true'
          ) {
            return;
          }

          const now = performance.now();
          if (now - this.lastDelegatedClickTime < 45) return;
          this.lastDelegatedClickTime = now;

          this.play('ui.click');
        } catch {
          // audio playback must never interrupt click dispatch
        }
      },
      { capture: true, passive: true }
    );
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
        compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
        compressor.knee.setValueAtTime(8, this.ctx.currentTime);
        compressor.ratio.setValueAtTime(5, this.ctx.currentTime);
        compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
        compressor.release.setValueAtTime(0.2, this.ctx.currentTime);
        this.compressor = compressor;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(8500, this.ctx.currentTime);
        filter.Q.setValueAtTime(0.7, this.ctx.currentTime);
        this.filter = filter;

        this.masterGain = this.ctx.createGain();
        this.applyMasterGain();

        this.masterGain.connect(this.filter);
        this.filter.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);

        this.ctx.onstatechange = () => {
          if (this.ctx?.state === 'running' && !this.awakeningPlayed) {
            this.awakeningPlayed = true;
          }
        };
      } catch {
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    this.applyMasterGain();

    return this.ctx && this.masterGain ? { ctx: this.ctx, master: this.masterGain } : null;
  }

  private applyMasterGain(): void {
    if (!this.masterGain || !this.ctx) return;
    try {
      const targetVolume = this.settings.masterEnabled ? this.settings.volume * 0.45 : 0;
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ctx.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(targetVolume, this.ctx.currentTime + 0.02);
    } catch {
      // ignore audio param ramp error
    }
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

  // ---------------------------------------------------------------------------
  // Central Playback Engine
  // ---------------------------------------------------------------------------

  play(
    event: SoundEventId,
    options?: { force?: boolean; packOverride?: SoundPackId; themeOverride?: SoundThemeId }
  ): void {
    const def = SOUND_REGISTRY[event];
    if (!def) return;

    // Never play ambient audio over active voice recording
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
      return;
    }

    if (def.hapticMs) {
      this.triggerHaptic(def.hapticMs);
    }

    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx } = audio;

    const resolvedThemeId = this.resolveCategoryThemeId(def.category, options?.themeOverride);

    // If AudioContext is suspended (e.g. background socket notification or early user click),
    // resume it and schedule the sound immediately after it enters 'running' state
    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => {
          this.executeSoundPlayback(event, def, pack, resolvedThemeId, options);
        })
        .catch(() => {});
      return;
    }

    this.executeSoundPlayback(event, def, pack, resolvedThemeId, options);
  }

  private executeSoundPlayback(
    event: SoundEventId,
    def: (typeof SOUND_REGISTRY)[SoundEventId],
    pack: SoundPackMeta,
    resolvedThemeId: SoundThemeId,
    options?: { force?: boolean }
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const master = this.masterGain;

    if (options?.force) {
      try {
        master.gain.setValueAtTime(Math.max(0.24, this.settings.volume * 0.45), ctx.currentTime);
      } catch {
        // ignore param schedule error
      }
    }

    // Check pre-rendered buffer cache for zero-latency execution
    const cached = audioPreloader.getCached(pack.id, event);
    if (cached) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = cached;
        src.connect(master);
        src.start(ctx.currentTime + 0.003);
        return;
      } catch {
        // fallback to procedural oscillator synthesis
      }
    }

    // Polyphony governor: if too many oscillators are playing simultaneously, drop oldest/new low-priority sound
    if (this.activeOscillatorsCount >= this.maxPolyphony && def.priority < 3) {
      return;
    }

    const baseTime = ctx.currentTime + 0.005;
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
        env.gain.linearRampToValueAtTime(peak, start + Math.min(0.016, dur * 0.25));
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
        this.activeOscillatorsCount += 1;
        osc.onended = () => {
          this.activeOscillatorsCount = Math.max(0, this.activeOscillatorsCount - 1);
        };

        osc.start(start);
        osc.stop(start + dur + 0.02);
      } catch {
        // ignore isolated oscillator error
      }
    }

    void audioPreloader.renderBuffer(ctx.sampleRate, pack, event, resolvedThemeId);
  }

  // ---------------------------------------------------------------------------
  // Dedicated Named API matching NEXORA Specification
  // ---------------------------------------------------------------------------

  /** Sending a text message: Soft outgoing message pop */
  playMessageSend(isGroup = false): void {
    this.play(isGroup ? 'group.send' : 'message.send');
  }

  /** Receiving a text message: Gentle incoming message notification */
  playMessageReceive(isGroup = false): void {
    this.play(isGroup ? 'group.receive' : 'message.receive');
  }

  /** Message successfully delivered: Subtle delivery confirmation */
  playMessageDelivered(): void {
    this.play('message.delivered');
  }

  /** Message read: Very subtle read confirmation, if enabled */
  playMessageRead(): void {
    this.play('message.read');
  }

  /** Failed message send or network error */
  playMessageFailed(): void {
    this.play('message.failed');
  }

  /** Deleted message tone */
  playMessageDeleted(): void {
    this.play('message.deleted');
  }

  /** Message reaction pop */
  playMessageReact(): void {
    this.play('message.react');
  }

  /** Message reply prompt */
  playMessageReply(): void {
    this.play('message.reply');
  }

  /** Message copy to clipboard confirmation */
  playMessageCopy(): void {
    this.play('message.copy');
  }

  /** Streak & milestone celebration */
  playStreakMilestone(): void {
    this.play('achievement.streak_milestone');
  }

  /** Button click: Soft tactile click */
  playButtonClick(): void {
    this.play('ui.click');
  }

  /** Tactile glass touch */
  playGlassTouch(): void {
    this.play('ui.glass_touch');
  }

  /** Switching navigation tabs: Short transition sound */
  playTabSwitch(): void {
    this.play('ui.tab_switch');
  }

  /** Opening a chat: Gentle glass-like opening sound */
  playChatOpen(): void {
    this.play('ui.chat_open');
  }

  /** Closing a chat: Soft closing sound */
  playChatClose(): void {
    this.play('ui.chat_close');
  }

  /** Opening a feature: Subtle magical transition */
  playFeatureOpen(): void {
    this.play('ui.feature_open');
  }

  /** Glass card or modal close */
  playGlassClose(): void {
    this.play('ui.glass_close');
  }

  /** Context menu or quick menu open */
  playMenuOpen(): void {
    this.play('ui.menu_open');
  }

  /** Sending a voice message: Soft send confirmation */
  playVoiceSend(): void {
    this.play('voice.send');
  }

  /** Receiving a voice message: Incoming message notification */
  playVoiceReceive(): void {
    this.play('voice.receive');
  }

  /** Uploading media: Subtle upload start sound */
  playMediaUploadStart(): void {
    this.play('media.upload_start');
  }

  /** Media upload completed: Bright confirmation chime */
  playMediaUploadCompleted(): void {
    this.play('media.upload_success');
  }

  /** Media file selection */
  playMediaSelect(): void {
    this.play('media.select');
  }

  /** Media upload error */
  playMediaUploadError(): void {
    this.play('media.upload_error');
  }

  /** Media attachment drawer open */
  playMediaMenuOpen(): void {
    this.play('media.menu_open');
  }

  /** Media lightbox preview open */
  playMediaPreviewOpen(): void {
    this.play('media.preview_open');
  }

  /** Media lightbox preview close */
  playMediaPreviewClose(): void {
    this.play('media.preview_close');
  }

  /** Incoming private chat notification */
  playNotificationPrivate(): void {
    this.play('notify.private');
  }

  /** Incoming group chat notification */
  playNotificationGroup(): void {
    this.play('notify.group');
  }

  /** Friend request received */
  playFriendRequest(): void {
    this.play('notify.friend_request');
  }

  /** Friend request accepted */
  playFriendAccepted(): void {
    this.play('notify.friend_accepted');
  }

  /** New friend story published */
  playStoryNew(): void {
    this.play('notify.story_new');
  }

  /** Open full-screen story viewer */
  playStoryOpen(): void {
    this.play('story.open');
  }

  /** Close full-screen story viewer */
  playStoryClose(): void {
    this.play('story.close');
  }

  /** Story upload completed */
  playStoryUpload(): void {
    this.play('story.upload');
  }

  /** Group successfully created */
  playGroupCreate(): void {
    this.play('group.create');
  }

  /** Settings saved confirmation */
  playSettingsSaved(): void {
    this.play('ui.settings_saved');
  }

  /** User logout */
  playLogout(): void {
    this.play('ui.logout');
  }

  /** Preload all core audio buffers to eliminate playback latency */
  preloadAll(sampleRate = 44100): void {
    if (typeof window === 'undefined') return;
    const effectiveRate = this.ctx?.sampleRate || sampleRate;
    audioPreloader.preloadCore(
      effectiveRate,
      this.getEffectiveCategoryMeta('notifications', this.settings.soundPack, this.settings.soundTheme),
      this.settings.soundTheme
    );
  }

  // ---------------------------------------------------------------------------
  // Diagnostics & Browser Environment Testing API
  // ---------------------------------------------------------------------------

  getDiagnostics(): AudioDiagnosticSnapshot {
    const hasWindow = typeof window !== 'undefined';
    const audioContextSupported =
      hasWindow &&
      Boolean(
        window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      );
    const offlineContextSupported = typeof OfflineAudioContext !== 'undefined';

    const ctx = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    const targetGainValue = this.settings.masterEnabled ? Number((this.settings.volume * 0.45).toFixed(3)) : 0;

    return {
      audioContextSupported,
      offlineContextSupported,
      contextState: ctx ? ctx.state : 'uninitialized',
      sampleRate: ctx?.sampleRate ?? null,
      baseLatencyMs:
        ctx && typeof ctx.baseLatency === 'number' && Number.isFinite(ctx.baseLatency)
          ? Number((ctx.baseLatency * 1000).toFixed(1))
          : null,
      outputLatencyMs:
        ctx && typeof ctx.outputLatency === 'number' && Number.isFinite(ctx.outputLatency)
          ? Number((ctx.outputLatency * 1000).toFixed(1))
          : null,
      masterGainValue: this.masterGain ? Number(this.masterGain.gain.value.toFixed(3)) : 0,
      targetGainValue,
      effectiveVolume: this.settings.masterEnabled ? this.settings.volume : 0,
      activeVoices: this.activeOscillatorsCount,
      maxPolyphony: this.maxPolyphony,
      voiceRecordingInterlock: this.voiceRecordingActive,
      cachedBufferCount: audioPreloader.getCachedCount(),
      totalRegisteredSounds: Object.keys(SOUND_REGISTRY).length,
      isMuted: this.isMuted(),
      awakeningPlayed: this.awakeningPlayed,
    };
  }

  isSoundCached(event: SoundEventId): boolean {
    const def = SOUND_REGISTRY[event];
    if (!def) return false;
    const pack = this.getEffectiveCategoryMeta(def.category, this.settings.soundPack, this.settings.soundTheme);
    return audioPreloader.hasCached(pack.id, event);
  }

  getEventBlockingReason(event: SoundEventId): DiagnosticBlockReason | null {
    const def = SOUND_REGISTRY[event];
    if (!def) return 'unknown-event';
    if (this.voiceRecordingActive && def.category !== 'voiceUi') return 'recording-interlock';
    if (!this.settings.masterEnabled) return 'muted';
    if (this.settings.profile === 'silent') return 'silent-profile';
    if (this.settings.soundPack === 'silent') return 'silent-pack';
    if (this.settings.volume <= 0.01) return 'volume-zero';
    if (event === 'message.read' && !this.settings.readSoundEnabled) return 'read-sound-disabled';
    if (!this.isCategoryAllowed(def.category, event)) return 'category-disabled';
    return null;
  }

  async initializeAudio(): Promise<AudioDiagnosticSnapshot> {
    const audio = this.ensureContext();
    if (audio && audio.ctx.state === 'suspended') {
      try {
        await audio.ctx.resume();
      } catch {
        // ignore browser autoplay rejection
      }
    }
    this.preloadAll();
    return this.getDiagnostics();
  }

  async preloadAllRegistered(): Promise<AudioDiagnosticSnapshot> {
    const audio = this.ensureContext();
    const sampleRate = audio?.ctx.sampleRate || 44100;
    const events = Object.keys(SOUND_REGISTRY) as SoundEventId[];
    await audioPreloader.preloadEvents(events, sampleRate, (ev) => {
      const def = SOUND_REGISTRY[ev];
      const themeId = this.resolveCategoryThemeId(def.category);
      const pack = this.getEffectiveCategoryMeta(def.category, this.settings.soundPack, themeId);
      return { pack, themeId };
    });
    return this.getDiagnostics();
  }

  resetDiagnosticsState(): void {
    this.lastPlayedAt.clear();
    if (this.voiceRecordingActive) {
      this.setVoiceRecordingActive(false);
    }
  }

  async playDiagnostic(
    event: SoundEventId,
    options?: { bypassFilters?: boolean }
  ): Promise<DiagnosticPlayResult> {
    const def = SOUND_REGISTRY[event];
    const timestamp = Date.now();
    if (!def) {
      return {
        event,
        played: false,
        reason: 'unknown-event',
        contextState: this.ctx ? this.ctx.state : 'uninitialized',
        effectiveGain: 0,
        timestamp,
      };
    }

    const bypass = Boolean(options?.bypassFilters);
    if (!bypass) {
      const blockReason = this.getEventBlockingReason(event);
      if (blockReason) {
        return {
          event,
          played: false,
          reason: blockReason,
          contextState: this.ctx ? this.ctx.state : 'uninitialized',
          effectiveGain: 0,
          timestamp,
        };
      }
      const now = performance.now();
      const prev = this.lastPlayedAt.get(event) ?? 0;
      if (now - prev < def.cooldownMs) {
        return {
          event,
          played: false,
          reason: 'cooldown-active',
          contextState: this.ctx ? this.ctx.state : 'uninitialized',
          effectiveGain: 0,
          timestamp,
        };
      }
      this.lastPlayedAt.set(event, now);
    }

    const effectivePackId: SoundPackId =
      bypass && this.settings.soundPack === 'silent' ? 'nexora-default' : this.settings.soundPack;
    const resolvedThemeId = this.resolveCategoryThemeId(def.category);
    const pack = this.getEffectiveCategoryMeta(def.category, effectivePackId, resolvedThemeId);

    const audio = this.ensureContext();
    if (!audio) {
      return {
        event,
        played: false,
        reason: 'unsupported',
        contextState: 'uninitialized',
        effectiveGain: 0,
        timestamp,
      };
    }

    const { ctx, master } = audio;
    let wasResumed = false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
        wasResumed = true;
      } catch {
        return {
          event,
          played: false,
          reason: 'unsupported',
          contextState: ctx.state,
          effectiveGain: 0,
          timestamp,
        };
      }
    }

    // In diagnostic mode, honor the live volume slider so users can directly test volume controls
    const gainMultiplier = bypass
      ? Math.max(0.02, this.settings.volume) * 0.45
      : this.settings.masterEnabled
      ? this.settings.volume * 0.45
      : 0;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(gainMultiplier, ctx.currentTime);
    } catch {
      // ignore audio param error
    }

    const hadCache = Boolean(audioPreloader.getCached(pack.id, event));
    this.executeSoundPlayback(event, def, pack, resolvedThemeId);

    return {
      event,
      played: true,
      reason: wasResumed ? 'resumed-and-played' : hadCache ? 'played-buffer' : 'played-synthesized',
      contextState: ctx.state,
      effectiveGain: Number(gainMultiplier.toFixed(3)),
      timestamp,
    };
  }
}

// Preserve global singleton instance
export const globalSoundManager =
  (typeof window !== 'undefined' && window.__nexora_global_sound_manager__) ||
  new GlobalSoundManager();

if (typeof window !== 'undefined') {
  window.__nexora_global_sound_manager__ = globalSoundManager;
}

// Aliased as audioManager for complete backward compatibility
export const audioManager = globalSoundManager;
