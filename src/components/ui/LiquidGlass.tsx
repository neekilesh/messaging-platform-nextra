import React from 'react';
import { motion } from 'motion/react';
import { Check, Moon, Sun, X } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import type { SoundEventId } from '../../audio/SoundRegistry';
import { NEXORA_THEMES, useVisualPrefs } from '../../lib/theme';

/* -------------------------------------------------------------------------- */
/* GlassCard                                                                  */
/* -------------------------------------------------------------------------- */
export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  intensity?: 'subtle' | 'medium' | 'elevated';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const INTENSITY_CLASS = {
  subtle: 'nexora-glass-subtle',
  medium: 'nexora-glass',
  elevated: 'nexora-glass-elevated',
} as const;

const PADDING_CLASS = {
  none: '',
  sm: 'p-3.5',
  md: 'p-5',
  lg: 'p-6',
} as const;

export function GlassCard({
  intensity = 'medium',
  padding = 'md',
  className = '',
  children,
  ...rest
}: GlassCardProps) {
  return (
    <div
      className={`rounded-[24px] ${INTENSITY_CLASS[intensity]} ${PADDING_CLASS[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassHeader                                                                */
/* -------------------------------------------------------------------------- */
export interface GlassHeaderProps {
  children: React.ReactNode;
  variant?: 'hero' | 'compact';
  className?: string;
}

export function GlassHeader({ children, variant = 'compact', className = '' }: GlassHeaderProps) {
  return (
    <header
      className={`relative shrink-0 z-20 ${
        variant === 'hero'
          ? 'nexora-glass-header rounded-b-[28px] px-5 pt-5 pb-4'
          : 'nexora-glass border-x-0 border-t-0 px-4 sm:px-6 py-3'
      } ${className}`}
    >
      {children}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassButton                                                                */
/* -------------------------------------------------------------------------- */
export interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  soundEvent?: SoundEventId | false;
}

const BTN_VARIANT = {
  primary:
    'bg-gradient-to-br from-[#7c5cf6] to-[#566ee6] hover:from-[#896cf8] hover:to-[#667deb] text-white border border-white/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.34),0_8px_20px_rgba(88,80,236,0.28)]',
  secondary:
    'bg-white/60 hover:bg-white/80 dark:bg-white/[0.08] dark:hover:bg-white/[0.14] text-slate-900 dark:text-slate-100 border border-white/75 dark:border-white/[0.16] shadow-[inset_0_1px_1px_rgba(255,255,255,0.65),0_4px_14px_rgba(30,24,70,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
  ghost:
    'bg-transparent hover:bg-white/45 dark:hover:bg-white/[0.08] text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white border border-transparent',
  danger:
    'bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-200 border border-rose-500/30 dark:border-rose-400/25',
} as const;

const BTN_SIZE = {
  sm: 'h-9 px-3.5 rounded-[14px] text-xs',
  md: 'h-10 px-4 rounded-[16px] text-xs',
  lg: 'h-12 px-5 rounded-[18px] text-sm',
  icon: 'min-h-[44px] min-w-[44px] rounded-full',
} as const;

export function GlassButton({
  variant = 'secondary',
  size = 'md',
  soundEvent = 'ui.glass_touch',
  onClick,
  className = '',
  children,
  ...rest
}: GlassButtonProps) {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (soundEvent) {
      audioManager.play(soundEvent);
    }
    onClick?.(e);
  };

  return (
    <button
      onClick={handleClick}
      className={`relative z-10 inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassInput                                                                 */
/* -------------------------------------------------------------------------- */
export interface GlassInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: React.ReactNode;
  trailingAction?: React.ReactNode;
  containerClassName?: string;
}

export function GlassInput({
  leadingIcon,
  trailingAction,
  containerClassName = '',
  className = '',
  ...rest
}: GlassInputProps) {
  return (
    <div className={`relative z-10 flex items-center ${containerClassName}`}>
      {leadingIcon && (
        <span className="absolute left-3.5 text-slate-500 dark:text-slate-400 pointer-events-none flex items-center">
          {leadingIcon}
        </span>
      )}
      <input
        className={`w-full h-10 rounded-[16px] bg-[var(--nx-input-bg)] border border-[var(--nx-input-border)] text-sm text-[var(--nx-text-primary)] placeholder:text-slate-500 dark:placeholder:text-slate-400/80 shadow-[inset_0_1px_1px_var(--nx-glass-specular)] focus:outline-none focus:bg-white/75 dark:focus:bg-white/[0.11] focus:border-violet-500/65 dark:focus:border-violet-400/60 transition-all ${
          leadingIcon ? 'pl-10' : 'pl-3.5'
        } ${trailingAction ? 'pr-10' : 'pr-3.5'} ${className}`}
        {...rest}
      />
      {trailingAction && (
        <span className="absolute right-2 flex items-center">{trailingAction}</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassBadge                                                                 */
/* -------------------------------------------------------------------------- */
export function GlassBadge({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/55 dark:bg-white/[0.1] border border-white/70 dark:border-white/[0.16] text-[11px] font-medium text-[var(--nx-text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] ${className}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* ProfileAvatar (GlassAvatar) & StoryRing                                    */
/* -------------------------------------------------------------------------- */
export interface ProfileAvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
  isGroup?: boolean;
  cosmicRing?: boolean;
}

const AVATAR_SIZE_MAP = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
} as const;

export function ProfileAvatar({
  src,
  name,
  size = 'md',
  isOnline,
  isGroup,
  cosmicRing,
}: ProfileAvatarProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || 'N';

  const showRing = cosmicRing && !effectiveReducedMotion;

  return (
    <div className={`relative shrink-0 ${AVATAR_SIZE_MAP[size]}`}>
      {showRing && (
        <motion.span
          aria-hidden="true"
          animate={{ rotate: 360 }}
          transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
          className="pointer-events-none absolute -inset-[2.5px] rounded-full bg-[conic-gradient(from_0deg,rgba(139,92,246,0.8),rgba(91,124,250,0.7),rgba(56,189,248,0.7),rgba(139,92,246,0.8))] opacity-90"
        />
      )}
      {cosmicRing && effectiveReducedMotion && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[2.5px] rounded-full bg-gradient-to-br from-violet-500/75 to-sky-400/70"
        />
      )}
      {src ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          className="relative w-full h-full rounded-full object-cover border border-white/60 dark:border-white/20 bg-white/80 dark:bg-[#0c0f1a] shadow-[0_4px_12px_rgba(30,20,60,0.18)]"
        />
      ) : (
        <div
          className={`relative w-full h-full rounded-full flex items-center justify-center font-display font-semibold text-white border border-white/50 dark:border-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_4px_12px_rgba(40,30,90,0.2)] ${
            isGroup
              ? 'bg-gradient-to-br from-[#4c62d6] to-[#2e85b8]'
              : 'bg-gradient-to-br from-[#7c5cf6] to-[#4f67df]'
          }`}
        >
          {initials}
        </div>
      )}
      {isOnline && (
        <span
          title="Online"
          className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-[#090c16]"
        />
      )}
    </div>
  );
}

export const GlassAvatar = ProfileAvatar;

export interface StoryRingProps {
  hasUnviewed: boolean;
  children: React.ReactNode;
  sizeClass?: string;
}

export function StoryRing({ hasUnviewed, children, sizeClass = 'w-14 h-14' }: StoryRingProps) {
  return (
    <div className={`relative rounded-full p-[2.5px] ${sizeClass}`}>
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full ${
          hasUnviewed ? 'nexora-story-ring-unviewed' : 'nexora-story-ring-viewed'
        }`}
      />
      <div className="relative z-10 w-full h-full rounded-full bg-[var(--nx-ring-inner-bg)] p-[2px] flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassNavigation (Mobile Floating Pill Dock)                                */
/* -------------------------------------------------------------------------- */
export interface GlassNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export interface GlassNavigationProps {
  items: GlassNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  layoutIdPrefix?: string;
}

export function GlassNavigation({
  items,
  activeId,
  onSelect,
  layoutIdPrefix = 'glass-nav',
}: GlassNavigationProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  return (
    <nav
      aria-label="Primary navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 px-4 pb-safe pt-1 pointer-events-none flex justify-center"
    >
      <div className="pointer-events-auto w-full max-w-md nexora-glass-dock rounded-full px-2 py-1.5 flex items-center justify-between gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex-1 min-h-[44px] py-1 px-1 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                active
                  ? 'text-violet-950 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {active && (
                <motion.span
                  layoutId={effectiveReducedMotion ? undefined : `${layoutIdPrefix}-pill`}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-white/70 dark:bg-gradient-to-b dark:from-white/[0.18] dark:to-white/[0.06] border border-white/80 dark:border-white/[0.18] shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),0_4px_12px_rgba(40,30,90,0.08)] pointer-events-none"
                />
              )}
              <Icon
                className={`w-[18px] h-[18px] relative z-10 transition-transform ${
                  active ? 'text-violet-600 dark:text-violet-200 scale-105' : ''
                }`}
              />
              <span className="text-[10px] font-medium tracking-tight relative z-10 leading-none">
                {item.label}
              </span>
              {item.badge && item.badge > 0 ? (
                <span className="absolute top-1 right-2.5 z-10 min-w-[15px] h-4 px-1 rounded-full bg-[#7c5cf6] text-white text-[9px] font-mono-tabular font-semibold flex items-center justify-center shadow-sm">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassMessageBubble                                                         */
/* -------------------------------------------------------------------------- */
export interface GlassMessageBubbleProps extends React.HTMLAttributes<HTMLDivElement> {
  isMine: boolean;
  deleted?: boolean;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  highlightClassName?: string;
}

export function GlassMessageBubble({
  isMine,
  deleted = false,
  isFirstInGroup = true,
  isLastInGroup = true,
  highlightClassName = '',
  className = '',
  children,
  ...rest
}: GlassMessageBubbleProps) {
  const radiusClass = isMine
    ? [
        'rounded-2xl',
        !isFirstInGroup ? 'rounded-tr-md' : '',
        !isLastInGroup ? 'rounded-br-md' : 'rounded-br-[6px]',
      ].join(' ')
    : [
        'rounded-2xl',
        !isFirstInGroup ? 'rounded-tl-md' : '',
        !isLastInGroup ? 'rounded-bl-md' : 'rounded-bl-[6px]',
      ].join(' ');

  return (
    <div
      className={`px-4 py-2.5 text-sm leading-relaxed relative overflow-hidden transition-[box-shadow,transform] duration-150 select-none sm:select-text touch-pan-y ${radiusClass} ${
        deleted
          ? 'bg-white/40 dark:bg-white/[0.04] border border-white/50 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 italic'
          : isMine
          ? 'nexora-glass-bubble-out text-white'
          : 'nexora-glass-bubble-in text-[var(--nx-bubble-in-text)]'
      } ${highlightClassName} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassComposer                                                              */
/* -------------------------------------------------------------------------- */
export interface GlassComposerProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassComposer({ children, className = '' }: GlassComposerProps) {
  return (
    <div
      className={`nexora-glass-composer rounded-[28px] px-2.5 py-1.5 flex items-center gap-1.5 transition-all ${className}`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassModal                                                                 */
/* -------------------------------------------------------------------------- */
export interface GlassModalProps {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
}

export function GlassModal({
  title,
  onClose,
  children,
  maxWidthClass = 'max-w-md',
}: GlassModalProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  return (
    <motion.div
      initial={effectiveReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={effectiveReducedMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 bg-slate-950/45 dark:bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => {
        audioManager.play('ui.glass_close');
        onClose();
      }}
    >
      <motion.div
        initial={effectiveReducedMotion ? false : { scale: 0.94, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={effectiveReducedMotion ? undefined : { scale: 0.96, opacity: 0 }}
        transition={
          effectiveReducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 380, damping: 30 }
        }
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidthClass} nexora-glass-elevated rounded-[28px] p-6 space-y-4`}
      >
        {title && (
          <div className="relative z-10 flex items-center justify-between gap-3">
            <h3 className="text-lg font-display font-semibold text-[var(--nx-text-primary)]">{title}</h3>
            <button
              type="button"
              onClick={() => {
                audioManager.play('ui.glass_close');
                onClose();
              }}
              aria-label="Close modal"
              className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[var(--nx-surface-hover)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="relative z-10 space-y-4">{children}</div>
      </motion.div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* NotificationCard                                                           */
/* -------------------------------------------------------------------------- */
export interface NotificationCardProps {
  title: string;
  body: string;
  timestamp: string;
  isRead: boolean;
  icon?: React.ReactNode;
}

export function NotificationCard({
  title,
  body,
  timestamp,
  isRead,
  icon,
}: NotificationCardProps) {
  return (
    <div
      className={`rounded-[20px] p-4 transition-colors flex items-start gap-3.5 ${
        isRead
          ? 'nexora-glass-subtle opacity-85'
          : 'nexora-glass border-violet-500/35 dark:border-violet-400/30'
      }`}
    >
      {icon && (
        <div
          className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${
            isRead
              ? 'bg-white/45 dark:bg-white/[0.06] border-white/60 dark:border-white/[0.1] text-slate-600 dark:text-slate-400'
              : 'bg-violet-500/18 border-violet-400/40 text-violet-700 dark:text-violet-200'
          }`}
        >
          {icon}
        </div>
      )}
      <div className="relative z-10 min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[var(--nx-text-primary)] truncate">{title}</div>
          <span className="text-[11px] font-mono-tabular text-[var(--nx-text-secondary)] shrink-0">
            {timestamp}
          </span>
        </div>
        <p className="text-xs text-[var(--nx-text-secondary)] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ThemeSelector                                                              */
/* -------------------------------------------------------------------------- */
export function ThemeSelector({
  onSelectFeedback,
}: {
  onSelectFeedback?: (msg: string) => void;
}) {
  const { theme, setTheme, appearanceMode, setAppearanceMode } = useVisualPrefs();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--nx-text-primary)]">Glass Appearance</div>
          <div className="text-xs text-[var(--nx-text-secondary)]">
            Switch between luminous pastel iPhone Light Glass and atmospheric Dark Glass.
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-[14px] bg-white/45 dark:bg-white/[0.06] border border-white/65 dark:border-white/[0.12]">
          <button
            type="button"
            onClick={() => {
              setAppearanceMode('light');
              audioManager.play('ui.theme_change');
              onSelectFeedback?.('Switched to Light Liquid Glass.');
            }}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-medium inline-flex items-center gap-1.5 transition-all cursor-pointer ${
              appearanceMode === 'light'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-500" />
            <span>Light Glass</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAppearanceMode('dark');
              audioManager.play('ui.theme_change');
              onSelectFeedback?.('Switched to Dark Liquid Glass.');
            }}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-medium inline-flex items-center gap-1.5 transition-all cursor-pointer ${
              appearanceMode === 'dark'
                ? 'bg-[#7c5cf6] text-white shadow-sm'
                : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span>Dark Glass</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {NEXORA_THEMES.map((t) => {
          const selected = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTheme(t.id);
                audioManager.play('ui.theme_change');
                onSelectFeedback?.(`Theme switched to ${t.name}.`);
              }}
              className={`rounded-[20px] p-4 text-left border transition-all cursor-pointer space-y-2.5 ${
                selected
                  ? 'bg-violet-500/18 dark:bg-violet-500/20 border-violet-500/60 dark:border-violet-300/55 shadow-[inset_0_1px_1px_rgba(255,255,255,0.45)]'
                  : 'bg-white/40 dark:bg-white/[0.04] border-white/65 dark:border-white/[0.1] hover:border-violet-400/50 dark:hover:border-white/[0.24]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  className="h-5 w-16 rounded-full border border-white/60 dark:border-white/25 shadow-inner"
                  style={{
                    background: `linear-gradient(135deg, ${t.swatches[0]}, ${t.swatches[1]}, ${t.swatches[2]})`,
                  }}
                />
                {selected && <Check className="w-4 h-4 text-violet-600 dark:text-sky-300" />}
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--nx-text-primary)]">{t.name}</div>
                <div className="text-[11px] text-[var(--nx-text-secondary)] leading-snug mt-0.5">
                  {t.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
