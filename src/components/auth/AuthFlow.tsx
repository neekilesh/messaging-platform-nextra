import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, firebaseProjectId, googleAuthProvider } from '../../lib/firebase';
import { CosmicBackdrop } from '../ui/CosmicBackdrop';
import { GlassButton, GlassCard, GlassInput } from '../ui/LiquidGlass';
import { NexoraLogo } from '../ui/NexoraLogo';
import { PWAInstallButton } from '../ui/PWAInstallButton';
import { apiRequest, setStoredToken } from '../../lib/api';
import {
  generateIdentityKeyPair,
  loadLocalKeyBundle,
  saveLocalKeyBundle,
  type StoredLocalKeyBundle,
} from '../../lib/crypto';
import type { AuthUser } from '../../types/nexora';

type AuthScreen = 'splash' | 'welcome' | 'access_key';

interface AuthFlowProps {
  onAuthenticated: (user: AuthUser, keys: StoredLocalKeyBundle) => void;
}

export function AuthFlow({ onAuthenticated }: AuthFlowProps) {
  const [screen, setScreen] = useState<AuthScreen>('splash');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [instantLoading, setInstantLoading] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);
  const [accessKeyInput, setAccessKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unauthorizedHost, setUnauthorizedHost] = useState<string | null>(null);

  useEffect(() => {
    if (screen === 'splash') {
      const t = setTimeout(() => setScreen('welcome'), 1000);
      return () => clearTimeout(t);
    }
  }, [screen]);

  const deviceMeta = () => ({
    deviceName: navigator.userAgent.includes('Mobile') ? 'Mobile Browser' : 'Desktop Browser',
    platform: navigator.platform || 'Web',
  });

  const handleGoogleSignIn = async () => {
    setError(null);
    setUnauthorizedHost(null);
    setGoogleLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const rawKeys = await generateIdentityKeyPair();

      const res = await apiRequest<{
        sessionToken: string;
        user: AuthUser;
      }>('/api/v1/auth/firebase', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          ...deviceMeta(),
          keys: {
            ecdhPublicJwk: JSON.stringify(rawKeys.ecdhPublicJwk),
            ecdsaPublicJwk: JSON.stringify(rawKeys.ecdsaPublicJwk),
            fingerprint: rawKeys.fingerprint,
          },
        }),
      });

      setStoredToken(res.sessionToken);

      const existingLocal = await loadLocalKeyBundle(res.user.id);
      if (existingLocal) {
        onAuthenticated(res.user, existingLocal);
        return;
      }

      const bundle: StoredLocalKeyBundle = {
        userId: res.user.id,
        ...rawKeys,
      };
      await saveLocalKeyBundle(bundle);
      await apiRequest('/api/v1/users/me/keys', {
        method: 'POST',
        body: JSON.stringify({
          ecdhPublicJwk: JSON.stringify(rawKeys.ecdhPublicJwk),
          ecdsaPublicJwk: JSON.stringify(rawKeys.ecdsaPublicJwk),
          fingerprint: rawKeys.fingerprint,
        }),
      }).catch(() => {});

      onAuthenticated(res.user, bundle);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setUnauthorizedHost(host);
        setError(
          `Google Sign-In is blocked on this domain (${host}) because it is not listed under Firebase Authorized Domains for project "${firebaseProjectId}". Add this domain in Firebase Console → Authentication → Settings → Authorized domains, or use Instant Device Pass below.`
        );
      } else if (code === 'auth/popup-blocked') {
        setError('Your browser blocked the Google sign-in popup. Please allow popups for this site and try again, or use Instant Device Pass.');
      } else if (code === 'auth/operation-not-allowed') {
        setError(
          `Google Sign-In is not enabled in Firebase project "${firebaseProjectId}". Enable Google under Authentication → Sign-in method in Firebase Console.`
        );
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError(err instanceof Error ? err.message : 'Google sign-in failed.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleInstantPass = async () => {
    setError(null);
    setUnauthorizedHost(null);
    setInstantLoading(true);
    try {
      const rawKeys = await generateIdentityKeyPair();
      const res = await apiRequest<{
        sessionToken: string;
        accessKey: string;
        user: AuthUser;
      }>('/api/v1/auth/instant', {
        method: 'POST',
        body: JSON.stringify({
          ...deviceMeta(),
          keys: {
            ecdhPublicJwk: JSON.stringify(rawKeys.ecdhPublicJwk),
            ecdsaPublicJwk: JSON.stringify(rawKeys.ecdsaPublicJwk),
            fingerprint: rawKeys.fingerprint,
          },
        }),
      });

      const bundle: StoredLocalKeyBundle = {
        userId: res.user.id,
        ...rawKeys,
      };
      await saveLocalKeyBundle(bundle);
      setStoredToken(res.sessionToken);
      try {
        localStorage.setItem(`nexora_access_key_${res.user.id}`, res.accessKey);
      } catch {
        // ignore storage quota error
      }
      onAuthenticated(res.user, bundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Instant Device Pass.');
    } finally {
      setInstantLoading(false);
    }
  };

  const handleAccessKeyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setKeyLoading(true);
    try {
      const cleanKey = accessKeyInput.trim();
      const res = await apiRequest<{
        sessionToken: string;
        user: AuthUser;
      }>('/api/v1/auth/access-key', {
        method: 'POST',
        body: JSON.stringify({
          accessKey: cleanKey,
          ...deviceMeta(),
        }),
      });

      setStoredToken(res.sessionToken);
      try {
        localStorage.setItem(`nexora_access_key_${res.user.id}`, cleanKey);
      } catch {
        // ignore
      }

      let bundle = await loadLocalKeyBundle(res.user.id);
      if (!bundle) {
        const fresh = await generateIdentityKeyPair();
        bundle = { userId: res.user.id, ...fresh };
        await saveLocalKeyBundle(bundle);
        await apiRequest('/api/v1/users/me/keys', {
          method: 'POST',
          body: JSON.stringify({
            ecdhPublicJwk: JSON.stringify(fresh.ecdhPublicJwk),
            ecdsaPublicJwk: JSON.stringify(fresh.ecdsaPublicJwk),
            fingerprint: fresh.fingerprint,
          }),
        });
      }

      onAuthenticated(res.user, bundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Access Key sign-in failed.');
    } finally {
      setKeyLoading(false);
    }
  };

  const busy = googleLoading || instantLoading || keyLoading;

  return (
    <div className="min-h-screen w-full nexora-cosmos flex items-center justify-center p-4 sm:p-8 relative overflow-hidden">
      <CosmicBackdrop />

      <AnimatePresence mode="wait">
        {screen === 'splash' && (
          <motion.div
            key="splash"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex flex-col items-center text-center gap-5"
          >
            <NexoraLogo size={76} />
            <div>
              <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-[var(--nx-text-primary)]">
                NEXORA
              </h1>
              <p className="text-sm text-[var(--nx-text-secondary)] mt-1.5">
                Zero-form entry. End-to-end encrypted messaging.
              </p>
            </div>
          </motion.div>
        )}

        {screen === 'welcome' && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-center"
          >
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <NexoraLogo size={42} />
                <span className="text-2xl font-display font-bold tracking-tight text-[var(--nx-text-primary)]">
                  NEXORA
                </span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-display font-bold tracking-tight text-[var(--nx-text-primary)] leading-[1.08]">
                Private connections, effortless clarity.
              </h1>
              <p className="text-base text-[var(--nx-text-secondary)] leading-relaxed max-w-md">
                Enter immediately with Google or a one-click Instant Device Pass. Your @handle and ECDH P-256 device keys are provisioned automatically.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--nx-text-muted)]">
                <span>1-click Google Sign-In</span>
                <span aria-hidden="true">·</span>
                <span>Instant Device Pass</span>
                <span aria-hidden="true">·</span>
                <span>25-member encrypted groups</span>
              </div>
              <PWAInstallButton />
            </div>

            <GlassCard intensity="elevated" padding="lg" className="space-y-5 rounded-[28px] sm:p-8">
              <div className="relative z-10 space-y-1.5">
                <h2 className="text-xl font-display font-semibold text-[var(--nx-text-primary)]">
                  Enter NEXORA
                </h2>
                <p className="text-sm text-[var(--nx-text-secondary)]">
                  Choose Google or start an Instant Device Pass right away. You can customize your @handle anytime inside Profile.
                </p>
              </div>

              {error && (
                <div className="relative z-10 rounded-[18px] bg-rose-500/12 border border-rose-500/35 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-200 space-y-2">
                  <p>{error}</p>
                  {unauthorizedHost && (
                    <div className="rounded-[14px] bg-white/60 dark:bg-black/45 border border-rose-500/25 dark:border-rose-400/20 px-3 py-2 text-xs text-[var(--nx-text-secondary)] space-y-1">
                      <div className="font-medium text-rose-700 dark:text-rose-200">Domain to authorize:</div>
                      <code className="block break-all font-mono-tabular text-sky-700 dark:text-sky-300 select-all">
                        {unauthorizedHost}
                      </code>
                    </div>
                  )}
                </div>
              )}

              <div className="relative z-10 space-y-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGoogleSignIn}
                  className="w-full h-12 rounded-[18px] bg-white/95 hover:bg-white disabled:opacity-60 text-slate-900 font-medium text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] cursor-pointer border border-white/80 shadow-[0_8px_22px_rgba(30,24,70,0.12)]"
                >
                  <GoogleIcon />
                  <span>{googleLoading ? 'Connecting Google...' : 'Continue with Google'}</span>
                </button>

                <GlassButton
                  type="button"
                  variant="primary"
                  size="lg"
                  disabled={busy}
                  onClick={handleInstantPass}
                  className="w-full"
                >
                  <Zap className="w-4 h-4 text-sky-200" />
                  <span>{instantLoading ? 'Activating Instant Pass...' : 'Enter with Instant Device Pass'}</span>
                </GlassButton>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--nx-hairline)]" />
                  </div>
                  <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                    <span className="nexora-glass-subtle px-3 py-0.5 rounded-full text-[var(--nx-text-secondary)]">
                      returning on a new browser?
                    </span>
                  </div>
                </div>

                <GlassButton
                  type="button"
                  variant="secondary"
                  size="lg"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setScreen('access_key');
                  }}
                  className="w-full text-xs"
                >
                  <KeyRound className="w-3.5 h-3.5 text-violet-600 dark:text-sky-300" />
                  <span>Restore with Access Key</span>
                </GlassButton>
              </div>

              <div className="relative z-10 pt-4 border-t border-[var(--nx-hairline)] grid grid-cols-2 gap-4 text-xs text-[var(--nx-text-secondary)]">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
                  <span>ECDH P-256 &amp; AES-256-GCM device keys</span>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0 mt-0.5" />
                  <span>Auto-generated identity, zero forms</span>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {screen === 'access_key' && (
          <motion.div
            key="access_key"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-md"
          >
            <GlassCard intensity="elevated" padding="lg" className="space-y-5 rounded-[28px] sm:p-8">
              <div className="relative z-10 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setScreen('welcome');
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] transition-colors min-h-[44px] cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <NexoraLogo size={28} />
              </div>

              {error && (
                <div className="relative z-10 rounded-[18px] bg-rose-500/12 border border-rose-500/35 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
                  {error}
                </div>
              )}

              <form onSubmit={handleAccessKeyLogin} className="relative z-10 space-y-4">
                <div>
                  <h2 className="text-2xl font-display font-bold text-[var(--nx-text-primary)] flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-violet-600 dark:text-sky-300" />
                    <span>Restore Session</span>
                  </h2>
                  <p className="text-sm text-[var(--nx-text-secondary)] mt-1">
                    Paste the <span className="font-mono-tabular text-[var(--nx-text-primary)] font-medium">nxk_...</span> Access Key saved from your Instant Device Pass in Profile.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--nx-text-secondary)]">Access Key</label>
                  <GlassInput
                    type="text"
                    required
                    value={accessKeyInput}
                    onChange={(e) => setAccessKeyInput(e.target.value)}
                    placeholder="nxk_..."
                    leadingIcon={<KeyRound className="w-4 h-4" />}
                    className="h-11 font-mono-tabular"
                  />
                </div>

                <GlassButton
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={keyLoading}
                  className="w-full"
                >
                  {keyLoading ? 'Restoring Device Session...' : 'Reconnect Session'}
                </GlassButton>
              </form>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.08.73-2.46 1.16-4.22 1.16-3.24 0-5.99-2.19-6.97-5.14H1.02v3.14C3.03 21.14 7.19 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.03 14.01A7.18 7.18 0 0 1 4.65 12c0-.7.13-1.38.38-2.01V6.85H1.02A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.02 5.15l4.01-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.19 15.3 0 12 0 7.19 0 3.03 2.86 1.02 6.85l4.01 3.14c.98-2.95 3.73-5.24 6.97-5.24Z"
      />
    </svg>
  );
}
