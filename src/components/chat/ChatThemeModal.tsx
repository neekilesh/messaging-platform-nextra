import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  CheckCheck,
  Palette,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { audioManager } from '../../audio/GlobalSoundManager';
import {
  buildBubbleGradientCss,
  buildBubbleShadowCss,
  buildChatBackgroundCss,
  CHAT_THEME_PRESETS,
  DEFAULT_CUSTOM_CHAT_THEME,
  getBubbleInkPalette,
  getIncomingBubbleStyle,
  isBackgroundDark,
  normalizeHexColor,
  type ChatThemeConfig,
  type IncomingBubbleTint,
} from '../../lib/chat-theme';
import { GlassButton, GlassModal } from '../ui/LiquidGlass';

interface ChatThemeModalProps {
  conversationTitle: string;
  initialTheme: ChatThemeConfig | null;
  saving?: boolean;
  onSave: (theme: ChatThemeConfig | null) => Promise<void> | void;
  onClose: () => void;
}

const INCOMING_TINT_OPTIONS: Array<{ id: IncomingBubbleTint; label: string }> = [
  { id: 'glass-default', label: 'Glass Auto' },
  { id: 'frosted-light', label: 'Frosted Light' },
  { id: 'frosted-dark', label: 'Frosted Dark' },
  { id: 'warm-silk', label: 'Warm Silk' },
];

interface ColorStopControlProps {
  label: string;
  value: string;
  onChange: (nextHex: string) => void;
}

function ColorStopControl({ label, value, onChange }: ColorStopControlProps) {
  const [hexInput, setHexInput] = useState(value);

  React.useEffect(() => {
    setHexInput(value);
  }, [value]);

  const handleTextChange = (raw: string) => {
    setHexInput(raw);
    const normalized = normalizeHexColor(raw);
    if (normalized) {
      onChange(normalized);
    }
  };

  const handleBlur = () => {
    const normalized = normalizeHexColor(hexInput);
    if (normalized) {
      setHexInput(normalized);
      onChange(normalized);
    } else {
      setHexInput(value);
    }
  };

  return (
    <label className="flex items-center justify-between gap-2.5 px-3 py-2 rounded-[14px] bg-[var(--nx-input-bg)] border border-[var(--nx-input-border)] min-h-[44px]">
      <span className="text-xs font-medium text-[var(--nx-text-secondary)] shrink-0">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={hexInput}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          maxLength={7}
          aria-label={`${label} hex color`}
          className="w-[74px] bg-transparent text-xs font-mono-tabular text-[var(--nx-text-primary)] text-right uppercase focus:outline-none"
        />
        <span className="relative w-7 h-7 rounded-lg overflow-hidden border border-white/60 dark:border-white/25 shadow-sm shrink-0">
          <input
            type="color"
            value={value}
            onChange={(e) => {
              const next = e.target.value.toLowerCase();
              setHexInput(next);
              onChange(next);
            }}
            aria-label={`${label} color picker`}
            className="absolute -inset-2 w-12 h-12 cursor-pointer border-0 bg-transparent p-0"
          />
        </span>
      </div>
    </label>
  );
}

export function ChatThemeModal({
  conversationTitle,
  initialTheme,
  saving = false,
  onSave,
  onClose,
}: ChatThemeModalProps) {
  const [draft, setDraft] = useState<ChatThemeConfig | null>(initialTheme);

  const effectiveDraft = draft ?? DEFAULT_CUSTOM_CHAT_THEME;
  const isCustomActive = draft !== null;

  const bubbleInk = useMemo(
    () =>
      draft
        ? getBubbleInkPalette(draft.outgoingBubbleStart, draft.outgoingBubbleEnd)
        : null,
    [draft]
  );

  const previewBgIsDark = useMemo(
    () => (draft ? isBackgroundDark(draft) : null),
    [draft]
  );

  const incomingPreviewStyle = useMemo(
    () => (draft ? getIncomingBubbleStyle(draft.incomingBubbleTint) : {}),
    [draft]
  );

  const updateCustomDraft = (updater: (prev: ChatThemeConfig) => ChatThemeConfig) => {
    setDraft((prev) => {
      const base = prev ?? DEFAULT_CUSTOM_CHAT_THEME;
      return {
        ...updater(base),
        presetId: 'custom',
      };
    });
  };

  const handleSelectPreset = (config: ChatThemeConfig) => {
    audioManager.play('ui.theme_change');
    setDraft({ ...config });
  };

  const handleSelectGlobalDefault = () => {
    audioManager.play('ui.theme_change');
    setDraft(null);
  };

  const handleApply = async () => {
    await onSave(draft);
  };

  const handleReset = async () => {
    setDraft(null);
    await onSave(null);
  };

  return (
    <GlassModal
      title="Chat Theme & Gradients"
      onClose={onClose}
      maxWidthClass="max-w-2xl"
    >
      <div className="max-h-[58vh] sm:max-h-[64vh] overflow-y-auto pr-1 space-y-5">
        <p className="text-xs text-[var(--nx-text-secondary)] leading-relaxed">
          Customize the background and message bubble gradients for{' '}
          <span className="font-semibold text-[var(--nx-text-primary)]">{conversationTitle}</span>.
          Everyone in this chat sees the updated theme while other conversations keep their own.
        </p>

        {/* Live Miniature Chat Preview */}
        <section aria-label="Live chat theme preview" className="space-y-2">
          <div
            data-testid="chat-theme-preview"
            className="rounded-[22px] border border-[var(--nx-glass-border)] p-4 space-y-3 transition-all overflow-hidden relative shadow-inner"
            style={
              draft
                ? { background: buildChatBackgroundCss(draft) }
                : undefined
            }
          >
            {!draft && (
              <div className="absolute inset-0 nexora-cosmos opacity-90 pointer-events-none" />
            )}

            <div className="relative z-10 flex items-center justify-between gap-2 pb-2 border-b border-white/15">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                  {conversationTitle.slice(0, 1).toUpperCase() || 'N'}
                </span>
                <span
                  className={`text-xs font-semibold truncate ${
                    previewBgIsDark === null
                      ? 'text-[var(--nx-text-primary)]'
                      : previewBgIsDark
                      ? 'text-white'
                      : 'text-slate-900'
                  }`}
                >
                  {conversationTitle}
                </span>
              </div>
              <span
                className={`text-[11px] font-medium shrink-0 ${
                  previewBgIsDark === null
                    ? 'text-[var(--nx-text-secondary)]'
                    : previewBgIsDark
                    ? 'text-white/75'
                    : 'text-slate-700'
                }`}
              >
                {draft
                  ? draft.presetId === 'custom'
                    ? 'Custom Gradient'
                    : CHAT_THEME_PRESETS.find((p) => p.id === draft.presetId)?.name || 'Custom'
                  : 'Global Workspace Theme'}
              </span>
            </div>

            <div className="relative z-10 space-y-2.5">
              <div className="flex justify-start">
                <div
                  className="nexora-glass-bubble-in px-3.5 py-2 rounded-2xl rounded-bl-[6px] text-xs max-w-[82%]"
                  style={
                    draft && incomingPreviewStyle.background
                      ? {
                          background: incomingPreviewStyle.background,
                          borderColor: incomingPreviewStyle.borderColor,
                          color: incomingPreviewStyle.color,
                        }
                      : undefined
                  }
                >
                  <div>Ready to plan tonight&apos;s catch-up?</div>
                  <div className="mt-1 text-[10px] opacity-70 text-right font-mono-tabular">
                    8:41 PM
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <div
                  className={`px-3.5 py-2 rounded-2xl rounded-br-[6px] text-xs max-w-[82%] border ${
                    !draft ? 'nexora-glass-bubble-out text-white' : ''
                  }`}
                  style={
                    draft && bubbleInk
                      ? {
                          background: buildBubbleGradientCss(draft),
                          color: bubbleInk.textColor,
                          borderColor: bubbleInk.borderColor,
                          boxShadow: buildBubbleShadowCss(draft),
                        }
                      : undefined
                  }
                >
                  <div>Always — love the new look in this chat!</div>
                  <div
                    className="mt-1 flex items-center justify-end gap-1 text-[10px] font-mono-tabular"
                    style={bubbleInk ? { color: bubbleInk.mutedTextColor } : undefined}
                  >
                    <span>8:42 PM</span>
                    <CheckCheck
                      className="w-3.5 h-3.5"
                      style={bubbleInk ? { color: bubbleInk.checkReadColor } : undefined}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {bubbleInk && (
            <div className="text-[11px] text-[var(--nx-text-secondary)] flex items-center justify-between gap-2 px-1">
              <span>
                Contrast guard:{' '}
                <strong className="font-medium text-[var(--nx-text-primary)]">
                  {bubbleInk.isLightSurface ? 'Dark slate ink' : 'Crisp white ink'}
                </strong>{' '}
                auto-selected for outgoing bubble legibility.
              </span>
            </div>
          )}
        </section>

        {/* Curated Gradient Presets */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--nx-text-secondary)]">
              Gradient Presets
            </h4>
            <button
              type="button"
              onClick={handleSelectGlobalDefault}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                draft === null
                  ? 'bg-violet-500/20 border-violet-500/55 text-violet-700 dark:text-violet-200'
                  : 'bg-[var(--nx-input-bg)] border-[var(--nx-input-border)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Use Global Default</span>
              {draft === null && <Check className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {CHAT_THEME_PRESETS.map((preset) => {
              const selected = draft?.presetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`chat-theme-preset-${preset.id}`}
                  onClick={() => handleSelectPreset(preset.config)}
                  className={`min-h-[68px] rounded-[18px] p-3 text-left border transition-all cursor-pointer flex items-start gap-3 ${
                    selected
                      ? 'bg-violet-500/18 border-violet-500/60 dark:border-violet-300/60 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]'
                      : 'bg-[var(--nx-input-bg)] border-[var(--nx-input-border)] hover:border-violet-400/50'
                  }`}
                >
                  <div
                    className="w-10 h-10 rounded-xl border border-white/50 dark:border-white/20 shrink-0 relative overflow-hidden shadow-sm"
                    style={{ background: buildChatBackgroundCss(preset.config) }}
                  >
                    <span
                      className="absolute bottom-1 right-1 w-4 h-3 rounded-md border border-white/50 shadow"
                      style={{ background: buildBubbleGradientCss(preset.config) }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-[var(--nx-text-primary)] truncate">
                        {preset.name}
                      </span>
                      {selected && (
                        <Check className="w-3.5 h-3.5 text-violet-600 dark:text-cyan-300 shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--nx-text-secondary)] leading-snug line-clamp-2 mt-0.5">
                      {preset.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Custom Gradient Builder */}
        <section className="space-y-3 pt-1 border-t border-[var(--nx-hairline)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-violet-600 dark:text-cyan-300" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--nx-text-secondary)]">
                Custom Gradient Colors
              </h4>
            </div>
            {!isCustomActive && (
              <span className="text-[11px] text-[var(--nx-text-muted)]">
                Adjust any control below to customize
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Chat Window Background Controls */}
            <div className="rounded-[18px] p-3.5 nexora-glass-subtle space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--nx-text-primary)]">
                  Chat Background Gradient
                </span>
                <button
                  type="button"
                  onClick={() => {
                    audioManager.play('ui.theme_change');
                    updateCustomDraft((prev) => ({
                      ...prev,
                      backgroundStart: prev.backgroundEnd,
                      backgroundEnd: prev.backgroundStart,
                    }));
                  }}
                  title="Swap background colors"
                  aria-label="Swap background gradient colors"
                  className="min-h-[34px] min-w-[34px] px-2 rounded-lg text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] hover:bg-[var(--nx-surface-hover)] inline-flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>Swap</span>
                </button>
              </div>

              <div className="space-y-2">
                <ColorStopControl
                  label="Start"
                  value={effectiveDraft.backgroundStart}
                  onChange={(hex) =>
                    updateCustomDraft((prev) => ({ ...prev, backgroundStart: hex }))
                  }
                />

                {effectiveDraft.backgroundVia ? (
                  <div className="space-y-1.5">
                    <ColorStopControl
                      label="Middle"
                      value={effectiveDraft.backgroundVia}
                      onChange={(hex) =>
                        updateCustomDraft((prev) => ({ ...prev, backgroundVia: hex }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateCustomDraft((prev) => {
                          const next = { ...prev };
                          delete next.backgroundVia;
                          return next;
                        })
                      }
                      className="text-[11px] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] underline cursor-pointer"
                    >
                      Use 2-color gradient instead
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      updateCustomDraft((prev) => ({
                        ...prev,
                        backgroundVia: '#1f1638',
                      }))
                    }
                    className="text-[11px] font-medium text-violet-700 dark:text-cyan-300 hover:underline cursor-pointer"
                  >
                    + Add middle gradient stop
                  </button>
                )}

                <ColorStopControl
                  label="End"
                  value={effectiveDraft.backgroundEnd}
                  onChange={(hex) =>
                    updateCustomDraft((prev) => ({ ...prev, backgroundEnd: hex }))
                  }
                />
              </div>

              <label className="block space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-secondary)]">
                  <span>Gradient Angle</span>
                  <span className="font-mono-tabular text-[var(--nx-text-primary)]">
                    {effectiveDraft.backgroundAngle}°
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={5}
                  value={effectiveDraft.backgroundAngle}
                  onChange={(e) =>
                    updateCustomDraft((prev) => ({
                      ...prev,
                      backgroundAngle: Number(e.target.value),
                    }))
                  }
                  aria-label="Background gradient angle"
                  className="w-full accent-violet-500 cursor-pointer"
                />
              </label>
            </div>

            {/* Outgoing Chat Bubble Gradient Controls */}
            <div className="rounded-[18px] p-3.5 nexora-glass-subtle space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--nx-text-primary)]">
                  Outgoing Bubble Gradient
                </span>
                <button
                  type="button"
                  onClick={() => {
                    audioManager.play('ui.theme_change');
                    updateCustomDraft((prev) => ({
                      ...prev,
                      outgoingBubbleStart: prev.outgoingBubbleEnd,
                      outgoingBubbleEnd: prev.outgoingBubbleStart,
                    }));
                  }}
                  title="Swap bubble colors"
                  aria-label="Swap bubble gradient colors"
                  className="min-h-[34px] min-w-[34px] px-2 rounded-lg text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] hover:bg-[var(--nx-surface-hover)] inline-flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>Swap</span>
                </button>
              </div>

              <div className="space-y-2">
                <ColorStopControl
                  label="Start"
                  value={effectiveDraft.outgoingBubbleStart}
                  onChange={(hex) =>
                    updateCustomDraft((prev) => ({ ...prev, outgoingBubbleStart: hex }))
                  }
                />
                <ColorStopControl
                  label="End"
                  value={effectiveDraft.outgoingBubbleEnd}
                  onChange={(hex) =>
                    updateCustomDraft((prev) => ({ ...prev, outgoingBubbleEnd: hex }))
                  }
                />
              </div>

              <label className="block space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-secondary)]">
                  <span>Bubble Angle</span>
                  <span className="font-mono-tabular text-[var(--nx-text-primary)]">
                    {effectiveDraft.outgoingAngle}°
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={5}
                  value={effectiveDraft.outgoingAngle}
                  onChange={(e) =>
                    updateCustomDraft((prev) => ({
                      ...prev,
                      outgoingAngle: Number(e.target.value),
                    }))
                  }
                  aria-label="Bubble gradient angle"
                  className="w-full accent-violet-500 cursor-pointer"
                />
              </label>

              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] font-medium text-[var(--nx-text-secondary)] block">
                  Incoming Bubble Surface
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {INCOMING_TINT_OPTIONS.map((opt) => {
                    const active =
                      (effectiveDraft.incomingBubbleTint || 'glass-default') === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          audioManager.play('ui.theme_change');
                          setDraft((prev) => {
                            const base = prev ?? DEFAULT_CUSTOM_CHAT_THEME;
                            return {
                              ...base,
                              incomingBubbleTint: opt.id,
                            };
                          });
                        }}
                        className={`min-h-[38px] px-2.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-violet-500/22 border-violet-500/55 text-[var(--nx-text-primary)]'
                            : 'bg-[var(--nx-input-bg)] border-[var(--nx-input-border)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Footer Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-[var(--nx-hairline)]">
        <GlassButton
          type="button"
          variant="ghost"
          size="md"
          disabled={saving || (initialTheme === null && draft === null)}
          onClick={handleReset}
          className="min-h-[44px] whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset to Default</span>
        </GlassButton>

        <div className="flex items-center gap-2 ml-auto">
          <GlassButton
            type="button"
            variant="secondary"
            size="md"
            disabled={saving}
            onClick={onClose}
            className="min-h-[44px] whitespace-nowrap shrink-0"
          >
            Cancel
          </GlassButton>
          <GlassButton
            type="button"
            variant="primary"
            size="md"
            disabled={saving}
            onClick={handleApply}
            data-testid="save-chat-theme-btn"
            className="min-h-[44px] whitespace-nowrap shrink-0"
          >
            <Check className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Apply Theme'}</span>
          </GlassButton>
        </div>
      </div>
    </GlassModal>
  );
}
