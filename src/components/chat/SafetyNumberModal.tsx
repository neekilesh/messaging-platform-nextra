import React, { useEffect, useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { computeSafetyNumber } from '../../lib/crypto';
import type { PublicUser } from '../../types/nexora';
import { GlassButton, GlassModal } from '../ui/LiquidGlass';
import { acceptUpdatedFingerprint } from '../ui/MagicalEffects';

interface SafetyNumberModalProps {
  myPublicJwk: string;
  peer: PublicUser;
  onClose: () => void;
}

export function SafetyNumberModal({ myPublicJwk, peer, onClose }: SafetyNumberModalProps) {
  const [safetyNumber, setSafetyNumber] = useState<string>('Computing...');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!peer.ecdhPublicJwk) {
      setSafetyNumber('Peer public key unavailable');
      return;
    }
    computeSafetyNumber(myPublicJwk, peer.ecdhPublicJwk)
      .then(setSafetyNumber)
      .catch(() => setSafetyNumber('Unable to verify key fingerprint'));
  }, [myPublicJwk, peer.ecdhPublicJwk]);

  const handleConfirmMatch = () => {
    if (peer.fingerprint) {
      acceptUpdatedFingerprint(peer.id, peer.fingerprint);
    }
    setConfirmed(true);
    setTimeout(() => onClose(), 700);
  };

  return (
    <GlassModal title="Verify End-to-End Encryption" onClose={onClose} maxWidthClass="max-w-md">
      <div className="flex items-center gap-2 text-xs text-sky-600 dark:text-sky-300 -mt-2">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        <span>Cryptographic identity check with @{peer.username}</span>
      </div>

      <p className="text-sm text-[var(--nx-text-secondary)] leading-relaxed">
        Compare this 30-digit safety number with <span className="text-[var(--nx-text-primary)] font-semibold">@{peer.username}</span>. If the numbers match identically on both devices, your private conversation keys are verified.
      </p>

      <div className="rounded-[18px] bg-sky-500/10 dark:bg-black/45 border border-sky-500/35 dark:border-sky-400/25 p-4 text-center font-mono-tabular text-lg tracking-wider text-sky-700 dark:text-sky-300 leading-relaxed">
        {safetyNumber}
      </div>

      <div className="text-xs text-[var(--nx-text-secondary)] space-y-1">
        <div>Algorithm: ECDH P-256 · HKDF-SHA256 · AES-256-GCM</div>
        <div>
          Peer Key Fingerprint:{' '}
          <span className="font-mono-tabular text-[var(--nx-text-primary)]">{peer.fingerprint || 'N/A'}</span>
        </div>
      </div>

      {peer.fingerprint && (
        <GlassButton
          type="button"
          variant="primary"
          size="md"
          soundEvent="ui.settings_saved"
          onClick={handleConfirmMatch}
          className="w-full"
        >
          <Check className="w-4 h-4" />
          <span>{confirmed ? 'Fingerprint Confirmed' : 'Mark Identity Key Verified'}</span>
        </GlassButton>
      )}
    </GlassModal>
  );
}
