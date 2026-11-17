import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Check, ShieldCheck, X } from 'lucide-react';
import { computeSafetyNumber } from '../../lib/crypto';
import type { PublicUser } from '../../types/nexora';
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 28 }}
        className="w-full max-w-md nexora-glass rounded-2xl p-6 space-y-5 border border-cyan-400/25 shadow-[0_0_40px_rgba(34,211,238,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-display font-semibold text-white">Verify End-to-End Encryption</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close safety verification"
            className="p-2 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">
          Compare this 30-digit cryptographic safety number with <span className="text-white font-medium">@{peer.username}</span>. If the numbers match identically on both devices, your private conversation keys are verified.
        </p>

        <div className="rounded-xl bg-slate-950/80 border border-cyan-400/20 p-4 text-center font-mono-tabular text-lg tracking-wider text-cyan-300 leading-relaxed shadow-[inset_0_0_24px_rgba(34,211,238,0.06)]">
          {safetyNumber}
        </div>

        <div className="text-xs text-slate-400 space-y-1">
          <div>Algorithm: ECDH P-256 · HKDF-SHA256 · AES-256-GCM</div>
          <div>Peer Key Fingerprint: <span className="font-mono-tabular text-slate-300">{peer.fingerprint || 'N/A'}</span></div>
        </div>

        {peer.fingerprint && (
          <button
            type="button"
            onClick={handleConfirmMatch}
            className="w-full h-10 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-cyan-200 text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>{confirmed ? 'Fingerprint Confirmed' : 'Mark Identity Key Verified'}</span>
          </button>
        )}
      </motion.div>
    </div>
  );
}
