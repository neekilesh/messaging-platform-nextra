import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export function PWAInstallButton({ className = '' }: { className?: string }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          audioManager.play('ui.glass_touch');
          install();
        }}
        className={`h-9 px-3.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 dark:border-cyan-400/35 text-sky-700 dark:text-cyan-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${className}`}
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            audioManager.play('ui.glass_open');
            setShowIOSGuide(true);
          }}
          className={`h-9 px-3.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 dark:border-cyan-400/35 text-sky-700 dark:text-cyan-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${className}`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 dark:bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-[24px] nexora-glass-elevated p-6 space-y-4">
              <div className="relative z-10 flex items-center justify-between">
                <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)]">
                  Install NEXORA on iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    audioManager.play('ui.glass_close');
                    setShowIOSGuide(false);
                  }}
                  aria-label="Close install instructions"
                  className="p-1.5 rounded-lg text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] hover:bg-[var(--nx-surface-hover)] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="relative z-10 text-xs text-[var(--nx-text-secondary)] leading-relaxed space-y-1.5">
                <span className="block">1. Tap the <strong className="text-[var(--nx-text-primary)]">Share</strong> icon in Safari&apos;s toolbar.</span>
                <span className="block">2. Scroll down and tap <strong className="text-[var(--nx-text-primary)]">Add to Home Screen</strong>.</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  audioManager.play('ui.glass_close');
                  setShowIOSGuide(false);
                }}
                className="relative z-10 w-full h-10 rounded-xl bg-gradient-to-br from-[#7c5cf6] to-[#566ee6] text-white text-xs font-medium transition-colors cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
