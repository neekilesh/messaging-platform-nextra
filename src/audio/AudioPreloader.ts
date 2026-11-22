import { adaptPlaybackPattern, SOUND_REGISTRY, type SoundEventId } from './SoundRegistry';
import type { SoundPackMeta, SoundThemeId } from './SoundSettings';

const PRELOAD_EVENTS: SoundEventId[] = [
  'app.awakening',
  'ui.click',
  'ui.glass_touch',
  'ui.nav_switch',
  'ui.tab_switch',
  'ui.chat_open',
  'ui.chat_close',
  'ui.feature_open',
  'ui.glass_open',
  'ui.glass_close',
  'ui.menu_open',
  'ui.settings_saved',
  'ui.logout',
  'message.send',
  'message.receive',
  'message.delivered',
  'message.read',
  'message.react',
  'message.reply',
  'message.failed',
  'message.deleted',
  'message.copy',
  'group.send',
  'group.receive',
  'group.create',
  'voice.send',
  'voice.receive',
  'media.select',
  'media.upload_start',
  'media.upload_success',
  'media.upload_error',
  'media.menu_open',
  'media.preview_open',
  'media.preview_close',
  'story.open',
  'story.close',
  'story.upload',
  'notify.private',
  'notify.group',
  'notify.friend_request',
  'notify.friend_accepted',
  'notify.story_new',
  'achievement.streak_milestone',
];

class AudioPreloader {
  private bufferCache = new Map<string, AudioBuffer>();
  private inFlight = new Map<string, Promise<AudioBuffer | null>>();

  private key(packId: string, event: SoundEventId): string {
    return `${packId}:${event}`;
  }

  getCached(packId: string, event: SoundEventId): AudioBuffer | null {
    return this.bufferCache.get(this.key(packId, event)) || null;
  }

  hasCached(packId: string, event: SoundEventId): boolean {
    return this.bufferCache.has(this.key(packId, event));
  }

  getCachedCount(): number {
    return this.bufferCache.size;
  }

  clear(): void {
    this.bufferCache.clear();
    this.inFlight.clear();
  }

  async renderBuffer(
    sampleRate: number,
    pack: SoundPackMeta,
    event: SoundEventId,
    themeId: SoundThemeId = 'magical'
  ): Promise<AudioBuffer | null> {
    if (pack.id === 'silent' || pack.gainScale <= 0) return null;
    const cacheKey = this.key(pack.id, event);
    const existing = this.bufferCache.get(cacheKey);
    if (existing) return existing;

    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;

    const def = SOUND_REGISTRY[event];
    if (!def || def.steps.length === 0) return null;

    if (typeof OfflineAudioContext === 'undefined') return null;

    const adaptedSteps = adaptPlaybackPattern(def.steps, themeId, def.ignorePackPitch);

    const task = (async () => {
      try {
        let maxEnd = 0.08;
        for (const s of adaptedSteps) {
          maxEnd = Math.max(maxEnd, (s.delay ?? 0) + s.duration + 0.06);
        }
        const totalFrames = Math.ceil(maxEnd * sampleRate);
        const offline = new OfflineAudioContext(1, totalFrames, sampleRate);
        const pScale = def.ignorePackPitch ? 1 : pack.pitchScale;

        for (const step of adaptedSteps) {
          const start = step.delay ?? 0;
          const dur = Math.max(0.02, step.duration);
          const osc = offline.createOscillator();
          const gain = offline.createGain();

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
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.018, dur * 0.25));
          gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

          if (step.filterFreq) {
            const filter = offline.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(step.filterFreq, start);
            filter.Q.setValueAtTime(0.8, start);
            osc.connect(filter);
            filter.connect(gain);
          } else {
            osc.connect(gain);
          }

          gain.connect(offline.destination);
          osc.start(start);
          osc.stop(start + dur + 0.02);
        }

        const rendered = await offline.startRendering();
        this.bufferCache.set(cacheKey, rendered);
        return rendered;
      } catch {
        return null;
      } finally {
        this.inFlight.delete(cacheKey);
      }
    })();

    this.inFlight.set(cacheKey, task);
    return task;
  }

  preloadCore(sampleRate: number, pack: SoundPackMeta, themeId: SoundThemeId = 'magical'): void {
    if (pack.id === 'silent') return;
    for (const ev of PRELOAD_EVENTS) {
      void this.renderBuffer(sampleRate, pack, ev, themeId);
    }
  }

  async preloadEvents(
    events: SoundEventId[],
    sampleRate: number,
    resolveMeta: (event: SoundEventId) => { pack: SoundPackMeta; themeId: SoundThemeId }
  ): Promise<number> {
    if (typeof OfflineAudioContext === 'undefined') return this.bufferCache.size;
    await Promise.all(
      events.map((ev) => {
        const { pack, themeId } = resolveMeta(ev);
        return this.renderBuffer(sampleRate, pack, ev, themeId);
      })
    );
    return this.bufferCache.size;
  }
}

export const audioPreloader = new AudioPreloader();
