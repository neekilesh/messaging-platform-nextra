import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Upload,
  User,
} from 'lucide-react';
import { NexoraLogo } from '../ui/NexoraLogo';
import { apiRequest, setStoredToken } from '../../lib/api';
import {
  createEncryptedKeyBackup,
  generateIdentityKeyPair,
  loadLocalKeyBundle,
  restoreEncryptedKeyBackup,
  saveLocalKeyBundle,
  type StoredLocalKeyBundle,
} from '../../lib/crypto';
import type { AuthUser, EncryptedKeyBackup } from '../../types/nexora';

type AuthScreen = 'splash' | 'welcome' | 'login' | 'register_email' | 'register_otp' | 'register_profile' | 'forgot_email' | 'forgot_otp' | 'forgot_reset';

interface AuthFlowProps {
  onAuthenticated: (user: AuthUser, keys: StoredLocalKeyBundle) => void;
}

export function AuthFlow({ onAuthenticated }: AuthFlowProps) {
  const [screen, setScreen] = useState<AuthScreen>('splash');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Registration & reset state
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [verificationToken, setVerificationToken] = useState('');

  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    reason?: string;
  }>({ checking: false, available: null });
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showRegPw, setShowRegPw] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (screen === 'splash') {
      const t = setTimeout(() => setScreen('welcome'), 1400);
      return () => clearTimeout(t);
    }
  }, [screen]);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setTimeout(() => setCooldownSec((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownSec]);

  useEffect(() => {
    if (screen !== 'register_profile') return;
    const clean = username.trim().replace(/^@+/, '');
    if (clean.length < 3) {
      setUsernameStatus({ checking: false, available: null });
      return;
    }
    setUsernameStatus({ checking: true, available: null });
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest<{ available: boolean; reason?: string }>(
          `/api/v1/auth/check-username?username=${encodeURIComponent(clean)}`
        );
        setUsernameStatus({ checking: false, available: res.available, reason: res.reason });
      } catch {
        setUsernameStatus({ checking: false, available: null });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [username, screen]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Avatar image must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const requestOtp = async (purpose: 'register' | 'reset') => {
    setError(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        cooldownSeconds: number;
        deliveredViaSmtp: boolean;
        devOtpPreview?: string;
      }>('/api/v1/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), purpose }),
      });
      setCooldownSec(res.cooldownSeconds || 30);
      setDevOtpPreview(res.devOtpPreview || null);
      setInfoMsg(
        res.deliveredViaSmtp
          ? 'A 6-digit verification code was sent to your email.'
          : 'Verification code generated. Enter the 6-digit code below.'
      );
      setScreen(purpose === 'register' ? 'register_otp' : 'forgot_otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (purpose: 'register' | 'reset') => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ verified: boolean; verificationToken: string }>('/api/v1/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), otp: otp.trim(), purpose }),
      });
      setVerificationToken(res.verificationToken);
      setDevOtpPreview(null);
      setInfoMsg(null);
      setScreen(purpose === 'register' ? 'register_profile' : 'forgot_reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const completeRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const rawKeys = await generateIdentityKeyPair();
      const backup = await createEncryptedKeyBackup(rawKeys, password);

      const res = await apiRequest<{ sessionToken: string; user: AuthUser }>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          verificationToken,
          username: username.trim().replace(/^@+/, ''),
          displayName: displayName.trim(),
          password,
          avatarUrl,
          deviceName: navigator.userAgent.includes('Mobile') ? 'Mobile Browser' : 'Desktop Browser',
          platform: navigator.platform || 'Web',
          keys: backup,
        }),
      });

      const fullBundle: StoredLocalKeyBundle = {
        userId: res.user.id,
        ...rawKeys,
      };
      await saveLocalKeyBundle(fullBundle);
      setStoredToken(res.sessionToken);
      onAuthenticated(res.user, fullBundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        sessionToken: string;
        user: AuthUser;
        keyBackup: EncryptedKeyBackup | null;
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: loginIdentifier.trim(),
          password: loginPassword,
          deviceName: navigator.userAgent.includes('Mobile') ? 'Mobile Browser' : 'Desktop Browser',
          platform: navigator.platform || 'Web',
        }),
      });

      setStoredToken(res.sessionToken);

      let localKeys = await loadLocalKeyBundle(res.user.id);
      if (!localKeys && res.keyBackup) {
        try {
          localKeys = await restoreEncryptedKeyBackup(res.user.id, loginPassword, res.keyBackup);
        } catch {
          // If backup decryption fails due to password change, generate fresh device keypair
          const fresh = await generateIdentityKeyPair();
          const newBackup = await createEncryptedKeyBackup(fresh, loginPassword);
          await apiRequest('/api/v1/users/me/keys', {
            method: 'POST',
            body: JSON.stringify(newBackup),
          });
          localKeys = { userId: res.user.id, ...fresh };
          await saveLocalKeyBundle(localKeys);
        }
      } else if (!localKeys) {
        const fresh = await generateIdentityKeyPair();
        const newBackup = await createEncryptedKeyBackup(fresh, loginPassword);
        await apiRequest('/api/v1/users/me/keys', {
          method: 'POST',
          body: JSON.stringify(newBackup),
        });
        localKeys = { userId: res.user.id, ...fresh };
        await saveLocalKeyBundle(localKeys);
      }

      onAuthenticated(res.user, localKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequest('/api/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          verificationToken,
          newPassword,
        }),
      });
      setInfoMsg('Password updated. Sign in with your new password.');
      setOtp('');
      setNewPassword('');
      setScreen('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password.');
    } finally {
      setLoading(false);
    }
  };

  const passwordScore = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen w-full nexora-cosmos flex items-center justify-center p-4 sm:p-8 relative overflow-hidden">
      <AnimatePresence mode="wait">
        {screen === 'splash' && (
          <motion.div
            key="splash"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center text-center gap-5"
          >
            <NexoraLogo size={76} />
            <div>
              <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-white">
                NEXORA
              </h1>
              <p className="text-sm text-slate-400 mt-1.5">
                Your Identity. Your World. Your Connections.
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
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-center"
          >
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <NexoraLogo size={42} />
                <span className="text-2xl font-display font-bold tracking-tight text-white">NEXORA</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-display font-bold tracking-tight text-white leading-[1.1]">
                Private connections, encrypted end to end.
              </h1>
              <p className="text-base text-slate-300 leading-relaxed max-w-md">
                Connect using your unique @username without sharing a phone number. Every message, voice note, group chat, and 24-hour story is encrypted on your device before it leaves your browser.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Unique @username</span>
                <span aria-hidden="true">·</span>
                <span>Email OTP verification</span>
                <span aria-hidden="true">·</span>
                <span>25-member encrypted groups</span>
              </div>
            </div>

            <div className="nexora-glass rounded-2xl p-6 sm:p-8 space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-display font-semibold text-white">Enter NEXORA</h2>
                <p className="text-sm text-slate-400">
                  Create a verified identity or sign in to restore your encrypted key vault.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    setError(null);
                    setInfoMsg(null);
                    setScreen('register_email');
                  }}
                  className="w-full h-12 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>Create Account</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setError(null);
                    setInfoMsg(null);
                    setScreen('login');
                  }}
                  className="w-full h-12 rounded-xl bg-slate-800/75 hover:bg-slate-800 text-slate-100 border border-white/10 font-medium text-sm flex items-center justify-center transition-colors cursor-pointer"
                >
                  Sign In
                </button>
              </div>

              <div className="pt-4 border-t border-white/10 grid grid-cols-2 gap-4 text-xs text-slate-400">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span>ECDH P-256 & AES-256-GCM device keys</span>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                  <span>Private email never shown in searches</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {screen !== 'splash' && screen !== 'welcome' && (
          <motion.div
            key={screen}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md nexora-glass rounded-2xl p-6 sm:p-8 space-y-5"
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfoMsg(null);
                  if (screen === 'login' || screen === 'register_email') setScreen('welcome');
                  else if (screen === 'register_otp') setScreen('register_email');
                  else if (screen === 'register_profile') setScreen('register_otp');
                  else if (screen === 'forgot_email') setScreen('login');
                  else if (screen === 'forgot_otp') setScreen('forgot_email');
                  else if (screen === 'forgot_reset') setScreen('forgot_otp');
                }}
                className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors min-h-[40px] cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <NexoraLogo size={28} />
            </div>

            {error && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            )}
            {infoMsg && (
              <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/30 px-4 py-3 text-sm text-cyan-200">
                {infoMsg}
              </div>
            )}

            {screen === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <h2 className="text-2xl font-display font-bold text-white">Sign in to NEXORA</h2>
                  <p className="text-sm text-slate-400 mt-1">Use your @username or verified email address.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Username or Email</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="@ShadowKing or you@gmail.com"
                      className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Password</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showLoginPw ? 'text' : 'password'}
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full h-11 pl-10 pr-11 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPw((v) => !v)}
                      aria-label={showLoginPw ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setScreen('forgot_email');
                    }}
                    className="text-xs text-violet-300 hover:text-violet-200 cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
                >
                  {loading ? 'Unlocking Encrypted Vault...' : 'Sign In'}
                </button>
              </form>
            )}

            {screen === 'register_email' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  requestOtp('register');
                }}
                className="space-y-4"
              >
                <div>
                  <h2 className="text-2xl font-display font-bold text-white">Create your account</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Step 1 of 3 · Verify your Gmail or email address with a 6-digit code.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Email Address</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@gmail.com"
                      className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
                >
                  {loading ? 'Sending Code...' : 'Send Verification Code'}
                </button>
              </form>
            )}

            {(screen === 'register_otp' || screen === 'forgot_otp') && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  verifyOtp(screen === 'register_otp' ? 'register' : 'reset');
                }}
                className="space-y-4"
              >
                <div>
                  <h2 className="text-2xl font-display font-bold text-white">Verify your email</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Enter the 6-digit verification code sent to <span className="text-slate-200">{email}</span>.
                  </p>
                </div>

                {devOtpPreview && (
                  <div className="rounded-xl bg-violet-500/15 border border-violet-500/35 px-4 py-3 text-xs text-violet-200 space-y-1">
                    <div className="font-medium text-violet-100">Development Email Delivery Preview</div>
                    <div>
                      SMTP is not configured in this preview environment. Your verification code is{' '}
                      <span className="font-mono-tabular font-bold text-cyan-300 text-sm">{devOtpPreview}</span>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">6-Digit OTP Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full h-12 px-4 text-center font-mono-tabular text-2xl tracking-[0.4em] rounded-xl bg-slate-900/80 border border-white/10 text-cyan-300 placeholder:text-slate-600 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
                >
                  {loading ? 'Verifying...' : 'Verify Code'}
                </button>

                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={cooldownSec > 0 || loading}
                    onClick={() => requestOtp(screen === 'register_otp' ? 'register' : 'reset')}
                    className="text-xs text-slate-400 hover:text-violet-300 disabled:opacity-50 cursor-pointer"
                  >
                    {cooldownSec > 0 ? `Resend code in ${cooldownSec}s` : 'Resend verification code'}
                  </button>
                </div>
              </form>
            )}

            {screen === 'register_profile' && (
              <form onSubmit={completeRegistration} className="space-y-4">
                <div>
                  <h2 className="text-2xl font-display font-bold text-white">Claim your identity</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Step 3 of 3 · Choose your unique @username and encryption password.
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <label className="relative cursor-pointer group shrink-0">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Profile preview"
                        className="w-16 h-16 rounded-full object-cover border border-violet-400/40"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-slate-900/90 border border-dashed border-slate-600 flex items-center justify-center text-slate-400 group-hover:border-violet-400 transition-colors">
                        <Upload className="w-5 h-5" />
                      </div>
                    )}
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                  </label>
                  <div className="text-xs text-slate-400">
                    <div className="text-slate-200 font-medium">Profile Avatar (Optional)</div>
                    <div>Click to upload a square image under 2 MB.</div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Unique Username</label>
                  <div className="relative">
                    <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="ShadowKing"
                      className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div className="text-xs min-h-[16px]">
                    {usernameStatus.checking && <span className="text-slate-400">Checking availability...</span>}
                    {!usernameStatus.checking && usernameStatus.available === true && (
                      <span className="text-cyan-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> @{username} is available
                      </span>
                    )}
                    {!usernameStatus.checking && usernameStatus.available === false && (
                      <span className="text-rose-300">{usernameStatus.reason || 'Username unavailable'}</span>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Display Name</label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Alex Mercer"
                    className="w-full h-11 px-4 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Password</label>
                  <div className="relative">
                    <input
                      type={showRegPw ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 chars, upper, lower & number"
                      className="w-full h-11 pl-4 pr-11 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPw((v) => !v)}
                      aria-label={showRegPw ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="grid grid-cols-5 gap-1 pt-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`h-1 rounded-full transition-colors ${
                          passwordScore >= i
                            ? passwordScore >= 4
                              ? 'bg-cyan-400'
                              : 'bg-violet-400'
                            : 'bg-slate-800'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || usernameStatus.available === false}
                  className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
                >
                  {loading ? 'Generating E2EE Keys & Creating Account...' : 'Complete Registration'}
                </button>
              </form>
            )}

            {screen === 'forgot_email' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  requestOtp('reset');
                }}
                className="space-y-4"
              >
                <div>
                  <h2 className="text-2xl font-display font-bold text-white">Reset password</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Enter your registered email address to receive a recovery verification code.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@gmail.com"
                    className="w-full h-11 px-4 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
                >
                  {loading ? 'Sending Recovery Code...' : 'Send Recovery Code'}
                </button>
              </form>
            )}

            {screen === 'forgot_reset' && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <h2 className="text-2xl font-display font-bold text-white">Create new password</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Choose a strong new password for your NEXORA account.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">New Password</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 chars, upper, lower & number"
                    className="w-full h-11 px-4 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
                >
                  {loading ? 'Updating Password...' : 'Reset Password'}
                </button>
              </form>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
