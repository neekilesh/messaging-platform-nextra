import React, { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Lock, ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { useVisualPrefs } from '../../lib/theme';

interface CosmicLoaderProps {
  label: string;
  sublabel?: string;
  compact?: boolean;
}

export function CosmicLoader({ label, sublabel, compact = false }: CosmicLoaderProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6 gap-2.5' : 'py-12 gap-4'}`}>
      <div className={`relative flex items-center justify-center ${compact ? 'w-10 h-10' : 'w-14 h-14'}`}>
        <motion.span
          animate={effectiveReducedMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 rounded-full border border-transparent border-t-violet-500 dark:border-t-violet-400 border-r-sky-500/75 dark:border-r-cyan-400/70"
        />
        <motion.span
          animate={effectiveReducedMotion ? undefined : { rotate: -360 }}
          transition={{ duration: 4.8, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-1.5 rounded-full border border-transparent border-b-indigo-500/80 dark:border-b-indigo-400/80 border-l-sky-400/55"
        />
        <motion.span
          animate={effectiveReducedMotion ? undefined : { scale: [0.85, 1.15, 0.85], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          className="w-2.5 h-2.5 rounded-full bg-violet-500 dark:bg-cyan-300 shadow-[0_0_12px_rgba(124,92,246,0.7)]"
        />
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium text-[var(--nx-text-primary)]">{label}</div>
        {sublabel && <div className="text-[11px] text-[var(--nx-text-secondary)] max-w-xs">{sublabel}</div>}
      </div>
    </div>
  );
}

interface ReactionParticleBurstProps {
  burstKey: number | null;
}

const SPARK_OFFSETS = [
  { x: -16, y: -18 },
  { x: 16, y: -16 },
  { x: -20, y: 4 },
  { x: 18, y: 6 },
  { x: 0, y: -24 },
];

export function ReactionParticleBurst({ burstKey }: ReactionParticleBurstProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  if (!burstKey || effectiveReducedMotion) return null;

  return (
    <span key={burstKey} aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible">
      {SPARK_OFFSETS.map((pos, idx) => (
        <motion.span
          key={idx}
          initial={{ x: 0, y: 0, scale: 0.4, opacity: 0.95 }}
          animate={{ x: pos.x, y: pos.y, scale: 1.1, opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: idx * 0.025 }}
          className="absolute w-1.5 h-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.85)]"
        />
      ))}
    </span>
  );
}

const FINGERPRINT_STORE_KEY = 'nexora_known_fingerprints_v1';

function checkAndRememberFingerprint(
  peerId: string | undefined,
  fingerprint: string | null | undefined
): 'verified' | 'encrypted' | 'changed' {
  if (!peerId || !fingerprint) return 'encrypted';
  try {
    const raw = localStorage.getItem(FINGERPRINT_STORE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    const prev = map[peerId];
    if (!prev) {
      map[peerId] = fingerprint;
      localStorage.setItem(FINGERPRINT_STORE_KEY, JSON.stringify(map));
      return 'encrypted';
    }
    if (prev !== fingerprint) {
      return 'changed';
    }
    return 'verified';
  } catch {
    return 'encrypted';
  }
}

export function acceptUpdatedFingerprint(peerId: string, fingerprint: string) {
  try {
    const raw = localStorage.getItem(FINGERPRINT_STORE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[peerId] = fingerprint;
    localStorage.setItem(FINGERPRINT_STORE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

interface EncryptionShieldBadgeProps {
  conversationId: string;
  isGroup: boolean;
  peerId?: string;
  peerFingerprint?: string | null;
  hasKeyMaterial: boolean;
  onClickVerify?: () => void;
}

export function EncryptionShieldBadge({
  conversationId,
  isGroup,
  peerId,
  peerFingerprint,
  hasKeyMaterial,
  onClickVerify,
}: EncryptionShieldBadgeProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  const alertedKeyRef = useRef<string | null>(null);

  const state = useMemo(() => {
    if (!hasKeyMaterial) return 'unverified' as const;
    if (isGroup) return 'encrypted' as const;
    return checkAndRememberFingerprint(peerId, peerFingerprint);
  }, [hasKeyMaterial, isGroup, peerId, peerFingerprint]);

  useEffect(() => {
    if (state === 'changed') {
      const token = `${conversationId}:${peerFingerprint || ''}`;
      if (alertedKeyRef.current !== token) {
        alertedKeyRef.current = token;
        audioManager.play('notify.security_alert');
      }
    }
  }, [state, conversationId, peerFingerprint]);

  if (state === 'changed') {
    return (
      <button
        type="button"
        onClick={onClickVerify}
        title="Contact encryption identity key changed — click to verify Safety Number"
        className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-300 hover:text-amber-500 dark:hover:text-amber-200 transition-colors cursor-pointer"
      >
        <span className="relative inline-flex items-center justify-center w-4 h-4">
          <ShieldAlert className="w-3.5 h-3.5" />
        </span>
        <span className="text-[11px] font-medium">Key changed · Verify</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClickVerify}
      disabled={!onClickVerify}
      title={
        state === 'verified'
          ? 'End-to-end encrypted · Identity key matches previously seen fingerprint'
          : 'End-to-end encrypted (AES-256-GCM)'
      }
      className={`inline-flex items-center gap-1.5 text-[var(--nx-text-secondary)] ${
        onClickVerify ? 'hover:text-violet-600 dark:hover:text-cyan-300 cursor-pointer' : 'cursor-default'
      } transition-colors`}
    >
      <motion.span
        key={conversationId}
        initial={effectiveReducedMotion ? false : { scale: 0.7, rotate: -18, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 24 }}
        className="relative inline-flex items-center justify-center w-4 h-4"
      >
        {!effectiveReducedMotion && (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            className="absolute inset-0 rounded-full border border-transparent border-t-sky-500/80 dark:border-t-cyan-400/75 border-l-violet-500/60 dark:border-l-violet-400/50"
          />
        )}
        {state === 'verified' ? (
          <ShieldCheck className="w-3 h-3 text-sky-600 dark:text-cyan-300" />
        ) : (
          <Lock className="w-2.5 h-2.5 text-violet-600 dark:text-violet-300" />
        )}
      </motion.span>
      <span className="text-xs text-[var(--nx-text-secondary)]">
        {hasKeyMaterial ? 'End-to-end encrypted' : 'Key unavailable'}
      </span>
    </button>
  );
}

interface ConnectionStatusBannerProps {
  isOnline: boolean;
  socketStatus: 'connected' | 'connecting' | 'disconnected';
}

export function ConnectionStatusBanner({ isOnline, socketStatus }: ConnectionStatusBannerProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  const show = !isOnline || socketStatus !== 'connected';

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={effectiveReducedMotion ? false : { y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={effectiveReducedMotion ? undefined : { y: -24, opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl nexora-glass border border-amber-500/35 shadow-xl flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-200 pointer-events-none"
        >
          {!isOnline ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-rose-500 dark:text-rose-300 shrink-0" />
              <span>No internet connection · Waiting to reconnect</span>
            </>
          ) : (
            <>
              <motion.span
                animate={effectiveReducedMotion ? undefined : { rotate: 360 }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                className="w-3.5 h-3.5 rounded-full border-2 border-transparent border-t-sky-500 dark:border-t-cyan-300 border-r-violet-500 dark:border-r-violet-400 shrink-0"
              />
              <span>Connecting to encrypted messaging server...</span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DeliveryWarningIcon() {
  return <AlertTriangle className="w-3 h-3 text-rose-500 dark:text-rose-300" />;
}
