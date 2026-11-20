import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { Download, Lock, X } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { useVisualPrefs } from '../../lib/theme';

interface MediaLightboxProps {
  url: string;
  mimeType: string;
  fileName?: string | null;
  onClose: () => void;
}

export function MediaLightbox({ url, mimeType, fileName, onClose }: MediaLightboxProps) {
  const { effectiveReducedMotion } = useVisualPrefs();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isVideo = mimeType.startsWith('video/');

  return (
    <motion.div
      initial={effectiveReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={effectiveReducedMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.24 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200 truncate max-w-md">
          <Lock className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
          <span className="truncate">{fileName || 'Encrypted Media'}</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={url}
            download={fileName || 'nexora-media'}
            onClick={() => audioManager.play('media.download')}
            className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close media viewer"
            className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 flex items-center justify-center p-4 sm:p-8 overflow-hidden" onClick={onClose}>
        {!effectiveReducedMotion && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0.6 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            aria-hidden="true"
            className="pointer-events-none absolute w-72 h-72 rounded-full bg-gradient-to-tr from-violet-500/25 via-cyan-400/20 to-transparent blur-2xl"
          />
        )}
        <motion.div
          initial={effectiveReducedMotion ? false : { scale: 0.88, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={effectiveReducedMotion ? undefined : { scale: 0.92, opacity: 0 }}
          transition={
            effectiveReducedMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 320, damping: 26 }
          }
          onClick={(e) => e.stopPropagation()}
          className="relative max-w-5xl max-h-full flex items-center justify-center rounded-2xl p-[1px] bg-gradient-to-br from-violet-500/35 via-cyan-400/25 to-indigo-500/30 shadow-[0_0_50px_rgba(139,92,246,0.2)]"
        >
          {isVideo ? (
            <video src={url} controls autoPlay className="max-h-[82vh] max-w-full rounded-2xl bg-black" />
          ) : (
            <img
              src={url}
              alt={fileName || 'Encrypted image'}
              className="max-h-[82vh] max-w-full rounded-2xl object-contain bg-black"
            />
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}
