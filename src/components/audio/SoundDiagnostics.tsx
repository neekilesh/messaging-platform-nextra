import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Volume2,
  VolumeX,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import {
  globalSoundManager,
  type AudioDiagnosticSnapshot,
  type DiagnosticPlayResult,
} from '../../audio/GlobalSoundManager';
import { useAudio } from '../../audio/AudioProvider';
import {
  SOUND_REGISTRY,
  type SoundDefinition,
  type SoundEventId,
} from '../../audio/SoundRegistry';
import type { SoundCategory } from '../../audio/SoundSettings';
import { GlassButton, GlassCard, GlassInput } from '../ui/LiquidGlass';

type CategoryFilter = 'all' | SoundCategory;

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: 'All',
  app: 'App',
  messages: 'Messages',
  notifications: 'Notifications',
  stories: 'Stories',
  voiceUi: 'Voice UI',
  achievements: 'Achievements',
  ui: 'UI & Glass',
};

const VOLUME_PRESETS = [0, 25, 50, 75, 100] as const;

function computeSoundMetrics(def: SoundDefinition) {
  let maxEndSec = 0;
  let minFreq = Infinity;
  let maxFreq = 0;
  for (const step of def.steps) {
    const end = (step.delay ?? 0) + step.duration;
    if (end > maxEndSec) maxEndSec = end;
    if (step.freq < minFreq) minFreq = step.freq;
    if (step.freq > maxFreq) maxFreq = step.freq;
    if (step.freqEnd) {
      if (step.freqEnd < minFreq) minFreq = step.freqEnd;
      if (step.freqEnd > maxFreq) maxFreq = step.freqEnd;
    }
  }
  return {
    durationMs: Math.round(maxEndSec * 1000),
    minFreq: Number.isFinite(minFreq) ? Math.round(minFreq) : 0,
    maxFreq: Math.round(maxFreq),
    stepCount: def.steps.length,
  };
}

function formatTraceReason(reason: DiagnosticPlayResult['reason']): string {
  switch (reason) {
    case 'played-buffer':
      return 'Played from pre-rendered AudioBuffer cache';
    case 'played-synthesized':
      return 'Played via live Web Audio oscillator synthesis';
    case 'resumed-and-played':
      return 'Resumed suspended AudioContext and played';
    case 'muted':
      return 'Blocked: Master sound toggle is muted';
    case 'silent-profile':
      return 'Blocked: Active sound profile is set to Silent';
    case 'silent-pack':
      return 'Blocked: Active sound pack is set to Silent';
    case 'volume-zero':
      return 'Blocked: Master volume is at 0%';
    case 'category-disabled':
      return 'Blocked: Sound category is disabled in settings';
    case 'read-sound-disabled':
      return 'Blocked: Read Receipt Sound is disabled';
    case 'recording-interlock':
      return 'Blocked: Voice recording interlock is active';
    case 'cooldown-active':
      return 'Blocked: Event cooldown window active';
    case 'unsupported':
      return 'Blocked: Browser Web Audio API unavailable or denied';
    case 'unknown-event':
    default:
      return 'Unknown sound event';
  }
}

export function SoundDiagnostics() {
  const { settings, updateSettings } = useAudio();
  const [snapshot, setSnapshot] = useState<AudioDiagnosticSnapshot>(() =>
    globalSoundManager.getDiagnostics()
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [bypassFilters, setBypassFilters] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [preloading, setPreloading] = useState(false);
  const [lastTriggeredId, setLastTriggeredId] = useState<SoundEventId | null>(null);
  const [lastResult, setLastResult] = useState<DiagnosticPlayResult | null>(null);

  const refreshSnapshot = useCallback(() => {
    setSnapshot(globalSoundManager.getDiagnostics());
  }, []);

  useEffect(() => {
    refreshSnapshot();
    const timer = window.setInterval(refreshSnapshot, 500);
    return () => window.clearInterval(timer);
  }, [refreshSnapshot, settings]);

  const registeredEntries = useMemo(() => {
    return (Object.keys(SOUND_REGISTRY) as SoundEventId[]).map((id) => {
      const def = SOUND_REGISTRY[id];
      const metrics = computeSoundMetrics(def);
      return {
        id,
        def,
        ...metrics,
      };
    });
  }, []);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = {
      all: registeredEntries.length,
      app: 0,
      messages: 0,
      notifications: 0,
      stories: 0,
      voiceUi: 0,
      achievements: 0,
      ui: 0,
    };
    for (const entry of registeredEntries) {
      counts[entry.def.category] += 1;
    }
    return counts;
  }, [registeredEntries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return registeredEntries.filter((entry) => {
      if (categoryFilter !== 'all' && entry.def.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        entry.id.toLowerCase().includes(q) ||
        CATEGORY_LABELS[entry.def.category].toLowerCase().includes(q) ||
        `${entry.minFreq}`.includes(q) ||
        `${entry.maxFreq}`.includes(q)
      );
    });
  }, [registeredEntries, categoryFilter, searchQuery]);

  const handleInitializeAudio = async () => {
    setInitializing(true);
    try {
      const next = await globalSoundManager.initializeAudio();
      setSnapshot(next);
      const res = await globalSoundManager.playDiagnostic('app.awakening', { bypassFilters: true });
      setLastResult(res);
      setLastTriggeredId('app.awakening');
      refreshSnapshot();
    } finally {
      setInitializing(false);
    }
  };

  const handlePreloadAll = async () => {
    setPreloading(true);
    try {
      const next = await globalSoundManager.preloadAllRegistered();
      setSnapshot(next);
    } finally {
      setPreloading(false);
    }
  };

  const handleResetState = () => {
    globalSoundManager.resetDiagnosticsState();
    setLastResult(null);
    setLastTriggeredId(null);
    refreshSnapshot();
  };

  const handlePlayEvent = async (eventId: SoundEventId) => {
    setLastTriggeredId(eventId);
    const res = await globalSoundManager.playDiagnostic(eventId, { bypassFilters });
    setLastResult(res);
    refreshSnapshot();
  };

  const volumePercent = Math.round(settings.volume * 100);
  const contextRunning = snapshot.contextState === 'running';

  return (
    <GlassCard
      intensity="medium"
      padding="lg"
      className="space-y-5"
      data-testid="sound-diagnostics-panel"
    >
      {/* Header & Engine Initialization Actions */}
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-[var(--nx-border)]">
        <div className="min-w-0">
          <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)] flex items-center gap-2">
            <Activity className="w-4 h-4 text-violet-600 dark:text-sky-300 shrink-0" />
            <span>Audio Engine &amp; Sound Registry Diagnostics</span>
          </h3>
          <p className="text-xs text-[var(--nx-text-secondary)] mt-0.5">
            Inspect live browser Web Audio initialization, verify master volume scaling, and audition all{' '}
            <span className="font-mono-tabular tabular-nums font-medium text-[var(--nx-text-primary)]">
              {snapshot.totalRegisteredSounds}
            </span>{' '}
            registered sound effects.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <GlassButton
            type="button"
            variant="primary"
            size="sm"
            soundEvent={false}
            disabled={initializing}
            onClick={handleInitializeAudio}
            data-testid="diag-init-audio-btn"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{initializing ? 'Initializing...' : 'Initialize / Resume Audio'}</span>
          </GlassButton>

          <GlassButton
            type="button"
            variant="secondary"
            size="sm"
            soundEvent={false}
            disabled={preloading}
            onClick={handlePreloadAll}
            data-testid="diag-preload-all-btn"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${preloading ? 'animate-spin' : ''}`} />
            <span>{preloading ? 'Caching...' : `Preload All (${snapshot.totalRegisteredSounds})`}</span>
          </GlassButton>

          <GlassButton
            type="button"
            variant="ghost"
            size="sm"
            soundEvent={false}
            onClick={handleResetState}
            data-testid="diag-reset-btn"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Cooldowns</span>
          </GlassButton>
        </div>
      </div>

      {/* Live Browser Audio Environment Readout (Single-elevation bordered row) */}
      <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-3 pb-4 border-b border-[var(--nx-border)]">
        <div className="space-y-1">
          <div className="text-[11px] text-[var(--nx-text-secondary)]">AudioContext State</div>
          <div
            data-testid="diag-context-state"
            className={`text-sm font-mono-tabular tabular-nums font-semibold flex items-center gap-1.5 ${
              contextRunning
                ? 'text-emerald-600 dark:text-emerald-300'
                : 'text-amber-600 dark:text-amber-300'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="capitalize">{snapshot.contextState}</span>
          </div>
          <div className="text-[11px] text-[var(--nx-text-muted)]">
            {snapshot.audioContextSupported ? 'Web Audio API supported' : 'Web Audio unsupported'}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-[var(--nx-text-secondary)]">Hardware Rate &amp; Latency</div>
          <div className="text-sm font-mono-tabular tabular-nums font-semibold text-[var(--nx-text-primary)]">
            {snapshot.sampleRate ? `${snapshot.sampleRate} Hz` : 'Pending init'}
          </div>
          <div className="text-[11px] font-mono-tabular tabular-nums text-[var(--nx-text-muted)]">
            {snapshot.baseLatencyMs !== null ? `Base latency ${snapshot.baseLatencyMs} ms` : 'Awaiting AudioContext'}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-[var(--nx-text-secondary)]">Preloaded Buffer Cache</div>
          <div
            data-testid="diag-cache-count"
            className="text-sm font-mono-tabular tabular-nums font-semibold text-[var(--nx-text-primary)]"
          >
            {snapshot.cachedBufferCount} / {snapshot.totalRegisteredSounds}
          </div>
          <div className="text-[11px] text-[var(--nx-text-muted)]">
            {snapshot.offlineContextSupported ? 'OfflineAudioContext ready' : 'Live oscillator fallback'}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-[var(--nx-text-secondary)]">Polyphony &amp; Interlock</div>
          <div className="text-sm font-mono-tabular tabular-nums font-semibold text-[var(--nx-text-primary)]">
            {snapshot.activeVoices} / {snapshot.maxPolyphony} voices
          </div>
          <div className="text-[11px] text-[var(--nx-text-muted)]">
            Mic interlock: {snapshot.voiceRecordingInterlock ? 'Active (muted)' : 'Clear'}
          </div>
        </div>
      </div>

      {/* Volume & Pipeline Diagnostic Controls */}
      <div className="relative z-10 space-y-3 pb-4 border-b border-[var(--nx-border)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              data-sound-custom="true"
              onClick={() => updateSettings({ masterEnabled: !settings.masterEnabled })}
              aria-label={settings.masterEnabled ? 'Mute master audio' : 'Unmute master audio'}
              data-testid="diag-mute-toggle"
              className={`min-h-[40px] px-3.5 rounded-[12px] text-xs font-medium inline-flex items-center gap-2 border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                settings.masterEnabled
                  ? 'bg-white/60 dark:bg-white/[0.08] border-[var(--nx-input-border)] text-[var(--nx-text-primary)]'
                  : 'bg-rose-500/15 border-rose-500/35 text-rose-700 dark:text-rose-200'
              }`}
            >
              {settings.masterEnabled ? (
                <Volume2 className="w-4 h-4 text-violet-600 dark:text-sky-300" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
              <span>{settings.masterEnabled ? 'Master Audio On' : 'Master Muted'}</span>
            </button>

            <div className="text-xs text-[var(--nx-text-secondary)] font-mono-tabular tabular-nums">
              Vol <strong className="text-[var(--nx-text-primary)]">{volumePercent}%</strong> · Target Gain{' '}
              <strong className="text-[var(--nx-text-primary)]">{snapshot.targetGainValue.toFixed(3)}</strong>
            </div>
          </div>

          {/* Pipeline Mode Segmented Control */}
          <div
            role="group"
            aria-label="Diagnostic playback filter mode"
            className="inline-flex items-center gap-1 p-1 rounded-[12px] bg-white/45 dark:bg-white/[0.06] border border-[var(--nx-input-border)] self-start sm:self-auto"
          >
            <button
              type="button"
              data-sound-custom="true"
              onClick={() => setBypassFilters(false)}
              className={`min-h-[34px] px-3 rounded-[9px] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                !bypassFilters
                  ? 'bg-[#7c5cf6] text-white shadow-sm'
                  : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
              }`}
            >
              Respect Settings
            </button>
            <button
              type="button"
              data-sound-custom="true"
              onClick={() => setBypassFilters(true)}
              className={`min-h-[34px] px-3 rounded-[9px] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                bypassFilters
                  ? 'bg-[#7c5cf6] text-white shadow-sm'
                  : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
              }`}
            >
              Bypass Category Locks
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            aria-label="Diagnostic master volume control"
            data-testid="diag-volume-slider"
            onChange={(e) => {
              const nextVol = Math.min(1, Math.max(0, Number(e.target.value) / 100));
              updateSettings({ volume: nextVol });
            }}
            onPointerUp={() => handlePlayEvent('ui.click')}
            onKeyUp={() => handlePlayEvent('ui.click')}
            className="flex-1 accent-[#7c5cf6] cursor-pointer"
          />

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {VOLUME_PRESETS.map((pct) => (
              <button
                key={pct}
                type="button"
                data-sound-custom="true"
                onClick={() => {
                  updateSettings({
                    volume: pct / 100,
                    ...(pct > 0 && !settings.masterEnabled ? { masterEnabled: true } : {}),
                  });
                  if (pct > 0) {
                    void handlePlayEvent('ui.glass_touch');
                  }
                }}
                className={`min-h-[32px] px-2.5 rounded-[9px] text-xs font-mono-tabular tabular-nums border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  volumePercent === pct
                    ? 'bg-violet-500/20 border-violet-400/50 text-violet-700 dark:text-sky-300 font-semibold'
                    : 'bg-white/40 dark:bg-white/[0.04] border-[var(--nx-input-border)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Live Trace Output */}
        {lastResult && (
          <div
            data-testid="diag-last-trace"
            className={`rounded-[14px] px-3.5 py-2.5 border text-xs flex flex-wrap items-center justify-between gap-2 ${
              lastResult.played
                ? 'bg-sky-500/10 border-sky-500/30 text-[var(--nx-text-primary)]'
                : 'bg-amber-500/12 border-amber-500/35 text-amber-900 dark:text-amber-100'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Waves className="w-3.5 h-3.5 text-violet-600 dark:text-sky-300 shrink-0" />
              <span className="font-mono-tabular font-semibold truncate">{lastResult.event}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{formatTraceReason(lastResult.reason)}</span>
            </div>
            <div className="text-[11px] font-mono-tabular tabular-nums text-[var(--nx-text-secondary)] shrink-0">
              Context {lastResult.contextState} · Gain {lastResult.effectiveGain.toFixed(3)}
            </div>
          </div>
        )}
      </div>

      {/* Registry Search & Category Filters */}
      <div className="relative z-10 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex-1">
            <GlassInput
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter registered sounds by event ID, category, or Hz..."
              aria-label="Filter registered sounds"
              leadingIcon={<Search className="w-4 h-4" />}
              trailingAction={
                searchQuery ? (
                  <button
                    type="button"
                    data-sound-custom="true"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear sound filter"
                    className="p-1 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : undefined
              }
            />
          </div>

          <div className="text-xs font-mono-tabular tabular-nums text-[var(--nx-text-secondary)] shrink-0">
            Showing {filteredEntries.length} of {registeredEntries.length}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                data-sound-custom="true"
                onClick={() => setCategoryFilter(cat)}
                className={`min-h-[34px] px-3 rounded-[10px] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                  active
                    ? 'bg-[#7c5cf6] text-white border-violet-400/50 shadow-sm'
                    : 'bg-white/45 dark:bg-white/[0.05] border-[var(--nx-input-border)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                {CATEGORY_LABELS[cat]}{' '}
                <span className="font-mono-tabular tabular-nums opacity-80">
                  ({categoryCounts[cat]})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* All Registered Sound Effects List */}
      <div className="relative z-10 border border-[var(--nx-border)] rounded-[18px] overflow-hidden">
        {filteredEntries.length === 0 ? (
          <div className="py-10 px-4 text-center space-y-2.5">
            <p className="text-xs text-[var(--nx-text-secondary)]">
              No registered sound effects match “{searchQuery}”.
            </p>
            <GlassButton
              type="button"
              variant="secondary"
              size="sm"
              soundEvent={false}
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('all');
              }}
            >
              Clear filters
            </GlassButton>
          </div>
        ) : (
          <div className="max-h-[440px] overflow-y-auto divide-y divide-[var(--nx-border)]">
            {filteredEntries.map((entry) => {
              const cached = globalSoundManager.isSoundCached(entry.id);
              const blockingReason = globalSoundManager.getEventBlockingReason(entry.id);
              const isJustPlayed = lastTriggeredId === entry.id;

              return (
                <div
                  key={entry.id}
                  data-testid={`sound-row-${entry.id}`}
                  className={`px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                    isJustPlayed
                      ? 'bg-violet-500/10 dark:bg-violet-500/12'
                      : 'hover:bg-white/35 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono-tabular text-xs font-semibold text-[var(--nx-text-primary)] truncate">
                        {entry.id}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--nx-text-secondary)] font-mono-tabular tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span>{CATEGORY_LABELS[entry.def.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {entry.stepCount} {entry.stepCount === 1 ? 'step' : 'steps'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{entry.durationMs} ms</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {entry.minFreq === entry.maxFreq
                          ? `${entry.minFreq} Hz`
                          : `${entry.minFreq}–${entry.maxFreq} Hz`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Cooldown {entry.def.cooldownMs} ms</span>
                      <span aria-hidden="true">·</span>
                      <span className={cached ? 'text-sky-700 dark:text-sky-300 font-medium' : ''}>
                        {cached ? 'Cached' : 'Live synth'}
                      </span>
                      {blockingReason && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-700 dark:text-amber-300">
                            Gated ({blockingReason})
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    data-sound-custom="true"
                    data-testid={`play-sound-${entry.id}`}
                    onClick={() => handlePlayEvent(entry.id)}
                    aria-label={`Play ${entry.id}`}
                    className="min-h-[36px] px-3 rounded-[12px] bg-white/65 hover:bg-white/90 dark:bg-white/[0.08] dark:hover:bg-white/[0.16] border border-[var(--nx-input-border)] text-xs font-medium text-[var(--nx-text-primary)] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
                  >
                    <Play className="w-3 h-3 text-violet-600 dark:text-sky-300" />
                    <span>Play</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
