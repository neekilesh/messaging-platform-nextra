import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Layers,
  Lock,
  MessageSquarePlus,
  Pause,
  Play,
  Send,
  SkipForward,
  Sparkles,
  StopCircle,
  X,
} from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { apiRequest } from '../../lib/api';
import {
  decryptDeepTalkSession,
  encryptConnectionAnswerPayload,
} from '../../lib/connection-games-crypto';
import type { StoredLocalKeyBundle } from '../../lib/crypto';
import { useVisualPrefs } from '../../lib/theme';
import type {
  DeepTalkSession as DeepTalkSessionData,
  PublicUser,
} from '../../types/nexora';
import { GlassButton, GlassCard, ProfileAvatar } from '../ui/LiquidGlass';

const QUICK_REACTIONS = ['❤️', '🔥', '😂', '✨', '🙏'];

export interface DeepTalkSessionProps {
  conversationId: string;
  session: DeepTalkSessionData;
  currentUserId: string;
  currentUserDisplayName: string;
  currentUserAvatar: string | null;
  peerUser: PublicUser;
  myKeys: StoredLocalKeyBundle;
  variant?: 'inline' | 'drawer';
  onSessionUpdated: (session: DeepTalkSessionData) => void;
  onDiscussInChat: (quoteText: string) => void;
  onRefreshOverview?: () => void;
  onOpenDrawer?: () => void;
}

export function DeepTalkSession({
  conversationId,
  session,
  currentUserId,
  currentUserDisplayName,
  currentUserAvatar,
  peerUser,
  myKeys,
  variant = 'inline',
  onSessionUpdated,
  onDiscussInChat,
  onRefreshOverview,
  onOpenDrawer,
}: DeepTalkSessionProps) {
  const { effectiveReducedMotion: prefersReducedMotion } = useVisualPrefs();
  const [answerText, setAnswerText] = useState('');
  const [busy, setBusy] = useState(false);
  const [rippleKey, setRippleKey] = useState<number | null>(null);
  const [revealGlowKey, setRevealGlowKey] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const card = session.currentCard;
  const currentQuestionId = card?.question.id ?? null;
  const isRevealed = Boolean(card?.revealed);

  // Detect live transition from unrevealed -> revealed so both peers get synchronized reveal choreography
  const prevRevealStateRef = useRef<{ sessionId: string; questionId: string | null; revealed: boolean }>({
    sessionId: session.id,
    questionId: currentQuestionId,
    revealed: isRevealed,
  });

  useEffect(() => {
    const prev = prevRevealStateRef.current;
    const sameQuestion =
      prev.sessionId === session.id && prev.questionId === currentQuestionId;

    if (sameQuestion && !prev.revealed && isRevealed && !prefersReducedMotion) {
      setRevealGlowKey(Date.now());
      setCollapsed(false);
    }

    if (prev.questionId !== currentQuestionId) {
      setAnswerText('');
      setError(null);
    }

    if (session.status === 'invited' && session.peerId === currentUserId) {
      setCollapsed(false);
    }

    prevRevealStateRef.current = {
      sessionId: session.id,
      questionId: currentQuestionId,
      revealed: isRevealed,
    };
  }, [session.id, session.status, session.peerId, currentUserId, currentQuestionId, isRevealed, prefersReducedMotion]);

  const syncDecryptedSession = async (raw: DeepTalkSessionData) => {
    const decrypted = await decryptDeepTalkSession(raw, currentUserId, myKeys);
    onSessionUpdated(decrypted);
    return decrypted;
  };

  const handleRespondInvite = async (action: 'accept' | 'decline') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ session: DeepTalkSessionData }>(
        `/api/v1/connection-games/deep-talk/sessions/${session.id}/respond`,
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        }
      );
      audioManager.play(action === 'accept' ? 'friend.request_accept' : 'friend.request_decline');
      await syncDecryptedSession(res.session);
      onRefreshOverview?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not respond to invitation.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card || !answerText.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const clean = answerText.trim();
      const qId = card.question.id;
      const enc = await encryptConnectionAnswerPayload({
        text: clean,
        aad: `deep_talk:${conversationId}:${session.id}:${qId}`,
        myUserId: currentUserId,
        myKeys,
        peerUser,
      });

      const res = await apiRequest<{ revealed: boolean; session: DeepTalkSessionData }>(
        `/api/v1/connection-games/deep-talk/sessions/${session.id}/answer`,
        {
          method: 'POST',
          body: JSON.stringify({
            questionId: qId,
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            aad: enc.aad,
            recipientEnvelopes: enc.recipientEnvelopes,
          }),
        }
      );

      setAnswerText('');
      if (!prefersReducedMotion) {
        setRippleKey(Date.now());
        if (res.revealed) {
          setRevealGlowKey(Date.now() + 1);
        }
      }
      audioManager.play(res.revealed ? 'achievement.streak_milestone' : 'message.send');
      await syncDecryptedSession(res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer.');
    } finally {
      setBusy(false);
    }
  };

  const handleReact = async (answerId: string, emoji: string) => {
    if (busy) return;
    try {
      const res = await apiRequest<{ session: DeepTalkSessionData }>(
        `/api/v1/connection-games/deep-talk/sessions/${session.id}/react`,
        {
          method: 'POST',
          body: JSON.stringify({ answerId, emoji }),
        }
      );
      audioManager.play('ui.glass_touch');
      await syncDecryptedSession(res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add reaction.');
    }
  };

  const handleNextQuestion = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ advanced: boolean; session: DeepTalkSessionData }>(
        `/api/v1/connection-games/deep-talk/sessions/${session.id}/next`,
        { method: 'POST' }
      );
      audioManager.play('ui.tab_switch');
      await syncDecryptedSession(res.session);
      if (res.session.status === 'completed') onRefreshOverview?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not advance question.');
    } finally {
      setBusy(false);
    }
  };

  const handleSkipQuestion = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ session: DeepTalkSessionData }>(
        `/api/v1/connection-games/deep-talk/sessions/${session.id}/skip`,
        { method: 'POST' }
      );
      audioManager.play('ui.glass_touch');
      setAnswerText('');
      await syncDecryptedSession(res.session);
      if (res.session.status === 'completed') onRefreshOverview?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not skip question.');
    } finally {
      setBusy(false);
    }
  };

  const handleSessionStatus = async (action: 'pause' | 'resume' | 'end') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ session: DeepTalkSessionData }>(
        `/api/v1/connection-games/deep-talk/sessions/${session.id}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        }
      );
      audioManager.play(action === 'end' ? 'ui.glass_close' : 'ui.glass_touch');
      await syncDecryptedSession(res.session);
      if (action === 'end') onRefreshOverview?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} session.`);
    } finally {
      setBusy(false);
    }
  };

  const iAmReady = session.readyUserIds.includes(currentUserId);
  const peerIsReady = session.readyUserIds.includes(peerUser.id);
  const myAnswer = card?.answers.find((a) => a.userId === currentUserId) || null;
  const peerAnswer = card?.answers.find((a) => a.userId === peerUser.id) || null;

  // Compact minimized bar when collapsed inline in ChatWindow
  if (variant === 'inline' && collapsed) {
    return (
      <div className="rounded-[20px] nexora-glass-elevated border border-violet-400/35 dark:border-cyan-400/25 px-3.5 py-2 flex items-center justify-between gap-3 shadow-[0_10px_28px_rgba(98,74,238,0.14)]">
        <button
          type="button"
          onClick={() => {
            audioManager.play('ui.glass_open');
            setCollapsed(false);
          }}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer min-h-[40px]"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/25 via-sky-400/20 to-cyan-400/25 flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4 text-violet-600 dark:text-cyan-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-violet-700 dark:text-cyan-300 truncate">
              <span>Deep Talk Cards</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">
                {session.status === 'invited'
                  ? 'Invitation'
                  : session.status === 'paused'
                  ? 'Paused'
                  : `Card ${session.currentQuestionIndex + 1}${session.questionLimit ? `/${session.questionLimit}` : ''}`}
              </span>
              {card?.revealed && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-600 dark:text-emerald-300">Revealed</span>
                </>
              )}
            </div>
            <div className="text-xs text-[var(--nx-text-primary)] truncate">
              {card?.question.questionText || session.categoryName}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              audioManager.play('ui.glass_open');
              setCollapsed(false);
            }}
            aria-label="Expand Deep Talk card"
            className="min-h-[40px] px-3 rounded-xl bg-gradient-to-br from-[#7c5cf6] to-[#566ee6] text-white text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>{card?.revealed ? 'View Reveal' : 'Open Card'}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {error && (
        <div className="rounded-[16px] bg-rose-500/12 border border-rose-500/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="min-h-[32px] min-w-[32px] flex items-center justify-center cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {session.status === 'invited' ? (
          <motion.div
            key={`invite-${session.id}`}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          >
            <GlassCard
              intensity="elevated"
              padding={variant === 'inline' ? 'md' : 'lg'}
              className="rounded-[24px] space-y-3.5 border border-violet-400/35 dark:border-cyan-400/25 shadow-[0_14px_40px_rgba(104,72,240,0.18)]"
            >
              <div className="relative z-10 flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-violet-700 dark:text-cyan-300">
                    <span>Deep Talk Cards</span>
                    <span aria-hidden="true">·</span>
                    <span>Invitation</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-display font-bold text-[var(--nx-text-primary)]">
                    {session.initiatorId === currentUserId
                      ? `Waiting for ${peerUser.displayName}`
                      : `${peerUser.displayName} invited you to play`}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
                    <span className="font-medium text-[var(--nx-text-primary)]">{session.categoryName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {session.questionLimit ? `${session.questionLimit} questions` : 'Unlimited questions'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {variant === 'inline' && (
                    <button
                      type="button"
                      onClick={() => {
                        audioManager.play('ui.glass_touch');
                        setCollapsed(true);
                      }}
                      aria-label="Minimize Deep Talk card"
                      className="min-h-[40px] min-w-[40px] rounded-xl hover:bg-[var(--nx-surface-hover)] text-[var(--nx-text-secondary)] flex items-center justify-center cursor-pointer"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {session.peerId === currentUserId ? (
                <div className="relative z-10 flex flex-wrap items-center gap-2.5">
                  <GlassButton
                    type="button"
                    variant="primary"
                    size="md"
                    disabled={busy}
                    onClick={() => handleRespondInvite('accept')}
                    className="flex-1 min-h-[44px] whitespace-nowrap"
                  >
                    <Check className="w-4 h-4" />
                    <span>Accept & Start</span>
                  </GlassButton>
                  <GlassButton
                    type="button"
                    variant="secondary"
                    size="md"
                    disabled={busy}
                    onClick={() => handleRespondInvite('decline')}
                    className="min-h-[44px] whitespace-nowrap"
                  >
                    <X className="w-4 h-4" />
                    <span>Decline</span>
                  </GlassButton>
                </div>
              ) : (
                <div className="relative z-10 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
                    <Clock className="w-3.5 h-3.5 text-violet-500 dark:text-cyan-300 shrink-0" />
                    <span>Invitation sent in real time. They can join anytime.</span>
                  </div>
                  <GlassButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleSessionStatus('end')}
                    className="min-h-[40px] whitespace-nowrap shrink-0"
                  >
                    Cancel
                  </GlassButton>
                </div>
              )}
            </GlassCard>
          </motion.div>
        ) : (
          <motion.div
            key={`active-${session.id}-${card?.question.id || 'done'}`}
            initial={
              prefersReducedMotion
                ? false
                : { opacity: 0, y: 18, scale: 0.95, filter: 'blur(8px)' }
            }
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={
              prefersReducedMotion
                ? undefined
                : { opacity: 0, y: -10, scale: 0.96, filter: 'blur(4px)' }
            }
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 290, damping: 24 }
            }
          >
            {/* Floating Glossy Liquid-Glass Question Card */}
            <div
              className={`relative rounded-[26px] ${
                variant === 'inline' ? 'p-4 sm:p-5' : 'p-5 sm:p-6'
              } nexora-glass-elevated border ${
                card?.revealed
                  ? 'border-cyan-400/50 dark:border-cyan-300/40 shadow-[0_20px_54px_rgba(92,118,248,0.26)]'
                  : 'border-violet-400/35 dark:border-cyan-400/25 shadow-[0_18px_46px_rgba(98,74,238,0.18)]'
              } overflow-hidden transition-shadow duration-300`}
            >
              {/* Soft Ambient Liquid-Glass Illumination */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -right-24 w-56 h-56 rounded-full bg-gradient-to-br from-violet-500/22 via-sky-400/16 to-cyan-300/12 blur-2xl"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-24 -left-20 w-48 h-48 rounded-full bg-gradient-to-tr from-cyan-400/14 via-violet-500/12 to-transparent blur-2xl"
              />

              {/* Glossy Liquid-Glass Entry Specular Sweep */}
              {!prefersReducedMotion && (
                <motion.div
                  key={`entry-gloss-${session.id}-${card?.question.id || 'done'}`}
                  initial={{ x: '-130%', opacity: 0.65 }}
                  animate={{ x: '170%', opacity: 0 }}
                  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/35 dark:via-cyan-200/18 to-transparent"
                />
              )}

              {/* Answer Submit Energy Ripple */}
              {rippleKey && !prefersReducedMotion && (
                <motion.div
                  key={rippleKey}
                  initial={{ scale: 0.65, opacity: 0.6 }}
                  animate={{ scale: 2.15, opacity: 0 }}
                  transition={{ duration: 0.62, ease: 'easeOut' }}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[26px] border-2 border-cyan-300/65"
                />
              )}

              {/* Synchronized Mutual Reveal Luminous Sweep + Expanding Aura Ring */}
              {revealGlowKey && !prefersReducedMotion && (
                <>
                  <motion.div
                    key={`sweep-${revealGlowKey}`}
                    initial={{ x: '-120%', opacity: 0.85 }}
                    animate={{ x: '140%', opacity: 0 }}
                    transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 w-2/3 -skew-x-12 bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent"
                  />
                  <motion.div
                    key={`aura-${revealGlowKey}`}
                    initial={{ scale: 0.82, opacity: 0.7 }}
                    animate={{ scale: 1.06, opacity: 0 }}
                    transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-[26px] border-2 border-cyan-300/75 shadow-[inset_0_0_28px_rgba(34,211,238,0.28)]"
                  />
                </>
              )}

              <div className="relative z-10 space-y-3.5">
                {/* Card Metadata & Session Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-cyan-300">
                      <span>{card?.question.categoryName || session.categoryName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular text-[var(--nx-text-secondary)]">
                        Card {session.currentQuestionIndex + 1}
                        {session.questionLimit ? ` / ${session.questionLimit}` : ' / Unlimited'}
                      </span>
                      {session.status === 'paused' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-sky-600 dark:text-sky-300">Paused</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {session.status === 'paused' ? (
                      <GlassButton
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleSessionStatus('resume')}
                        className="min-h-[40px] whitespace-nowrap"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Resume</span>
                      </GlassButton>
                    ) : (
                      <GlassButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleSessionStatus('pause')}
                        title="Pause without losing completed answers"
                        className="min-h-[40px] whitespace-nowrap"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        <span>Pause</span>
                      </GlassButton>
                    )}

                    <GlassButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleSessionStatus('end')}
                      title="End session"
                      className="min-h-[40px] text-rose-600 dark:text-rose-300 whitespace-nowrap"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      <span>End</span>
                    </GlassButton>

                    {variant === 'inline' && onOpenDrawer && (
                      <button
                        type="button"
                        onClick={() => {
                          audioManager.play('ui.glass_open');
                          onOpenDrawer();
                        }}
                        title="Open Connection Games drawer"
                        aria-label="Open Connection Games drawer"
                        className="min-h-[40px] min-w-[40px] rounded-xl hover:bg-[var(--nx-surface-hover)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] flex items-center justify-center cursor-pointer"
                      >
                        <Layers className="w-4 h-4" />
                      </button>
                    )}

                    {variant === 'inline' && (
                      <button
                        type="button"
                        onClick={() => {
                          audioManager.play('ui.glass_touch');
                          setCollapsed(true);
                        }}
                        title="Minimize Deep Talk card"
                        aria-label="Minimize Deep Talk card"
                        className="min-h-[40px] min-w-[40px] rounded-xl hover:bg-[var(--nx-surface-hover)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] flex items-center justify-center cursor-pointer"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Paused Banner */}
                {session.status === 'paused' && (
                  <div className="rounded-2xl bg-sky-500/10 border border-sky-400/25 px-3.5 py-2.5 text-xs text-[var(--nx-text-secondary)]">
                    Session paused — completed answers stay encrypted and saved. Tap{' '}
                    <strong className="text-[var(--nx-text-primary)]">Resume</strong> anytime to continue.
                  </div>
                )}

                {card && (
                  <>
                    {/* Question Prompt */}
                    <motion.h3
                      key={card.question.id}
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                      className="text-base sm:text-xl font-display font-semibold text-[var(--nx-text-primary)] leading-snug tracking-tight"
                    >
                      “{card.question.questionText}”
                    </motion.h3>

                    {/* Participant Avatars & Live Submission Indicators */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="flex items-center gap-2.5 rounded-2xl nexora-glass-subtle px-3 py-2 border border-white/40 dark:border-white/10">
                        <ProfileAvatar
                          src={currentUserAvatar}
                          name={currentUserDisplayName}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--nx-text-primary)] truncate">
                            You
                          </div>
                          <div className="text-[11px] text-[var(--nx-text-secondary)] flex items-center gap-1">
                            {card.myAnswered ? (
                              <>
                                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                                <span>Answered</span>
                              </>
                            ) : (
                              <span>Reflecting...</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 rounded-2xl nexora-glass-subtle px-3 py-2 border border-white/40 dark:border-white/10">
                        <ProfileAvatar
                          src={peerUser.avatarUrl}
                          name={peerUser.displayName}
                          size="sm"
                          isOnline={peerUser.isOnline}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--nx-text-primary)] truncate">
                            {peerUser.displayName}
                          </div>
                          <div className="text-[11px] text-[var(--nx-text-secondary)] flex items-center gap-1">
                            {card.peerAnswered ? (
                              <>
                                <CheckCircle2 className="w-3 h-3 text-cyan-500 shrink-0" />
                                <span>Ready & answered</span>
                              </>
                            ) : (
                              <span>Waiting...</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* State Transitions: Unanswered -> Locked/Waiting -> Synchronized Animated Reveal */}
                    <AnimatePresence mode="wait">
                      {!card.myAnswered && session.status === 'active' ? (
                        <motion.form
                          key={`compose-${card.question.id}`}
                          initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
                          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                          onSubmit={handleSubmitAnswer}
                          className="space-y-2.5"
                        >
                          <textarea
                            rows={variant === 'inline' ? 2 : 3}
                            value={answerText}
                            onChange={(e) => setAnswerText(e.target.value)}
                            placeholder="Write your honest thoughts... End-to-end encrypted & revealed together."
                            className="w-full rounded-[18px] bg-white/65 dark:bg-black/30 border border-white/75 dark:border-white/[0.14] px-3.5 py-2.5 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-none"
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <GlassButton
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={handleSkipQuestion}
                              className="min-h-[44px] whitespace-nowrap"
                            >
                              <SkipForward className="w-3.5 h-3.5" />
                              <span>Skip card</span>
                            </GlassButton>

                            <GlassButton
                              type="submit"
                              variant="primary"
                              size="md"
                              disabled={busy || !answerText.trim()}
                              className="min-h-[44px] whitespace-nowrap"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{busy ? 'Encrypting...' : 'Submit Answer'}</span>
                            </GlassButton>
                          </div>
                        </motion.form>
                      ) : card.myAnswered && !card.revealed ? (
                        <motion.div
                          key={`waiting-${card.question.id}`}
                          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.95, y: -8 }}
                          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                          className="rounded-[20px] nexora-glass-subtle p-4 space-y-2 border border-violet-400/30 dark:border-cyan-400/20"
                        >
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-violet-700 dark:text-cyan-300">
                            <Lock className="w-3 h-3 shrink-0" />
                            <span>Your encrypted answer is locked in</span>
                          </div>
                          <p className="text-sm text-[var(--nx-text-primary)] leading-relaxed break-words">
                            “{myAnswer?.localText}”
                          </p>
                          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-[var(--nx-text-secondary)]">
                            <span>
                              Waiting for {peerUser.displayName} so both answers reveal together...
                            </span>
                            {session.status === 'active' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={handleSkipQuestion}
                                className="min-h-[36px] px-2 text-xs font-medium text-violet-600 dark:text-cyan-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Skip card
                              </button>
                            )}
                          </div>
                        </motion.div>
                      ) : card.revealed ? (
                        <motion.div
                          key={`revealed-${card.question.id}`}
                          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.94, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
                          transition={{ type: 'spring', stiffness: 310, damping: 24 }}
                          className="space-y-3"
                        >
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-cyan-300">
                            <Sparkles className="w-3.5 h-3.5 shrink-0" />
                            <span>Synchronized Reveal</span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {[
                              {
                                label: 'You',
                                avatar: currentUserAvatar,
                                name: currentUserDisplayName,
                                answer: myAnswer,
                                delay: 0.04,
                              },
                              {
                                label: peerUser.displayName,
                                avatar: peerUser.avatarUrl,
                                name: peerUser.displayName,
                                answer: peerAnswer,
                                delay: 0.14,
                              },
                            ].map(({ label, avatar, name, answer, delay }) =>
                              answer ? (
                                <motion.div
                                  key={answer.id}
                                  initial={
                                    prefersReducedMotion
                                      ? false
                                      : { opacity: 0, y: 14, scale: 0.93, filter: 'blur(4px)' }
                                  }
                                  animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                                  transition={
                                    prefersReducedMotion
                                      ? { duration: 0 }
                                      : {
                                          delay,
                                          type: 'spring',
                                          stiffness: 330,
                                          damping: 24,
                                        }
                                  }
                                  className="rounded-[20px] nexora-glass p-3.5 space-y-2.5 border border-violet-400/35 dark:border-cyan-400/25 shadow-[0_10px_28px_rgba(124,92,246,0.16)]"
                                >
                                  <div className="flex items-center gap-2">
                                    <ProfileAvatar src={avatar} name={name} size="xs" />
                                    <span className="text-xs font-semibold text-violet-700 dark:text-cyan-300 truncate">
                                      {label}
                                    </span>
                                  </div>
                                  <p className="text-sm text-[var(--nx-text-primary)] leading-relaxed break-words">
                                    {answer.localText}
                                  </p>
                                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                                    <div className="flex items-center gap-1">
                                      {QUICK_REACTIONS.map((em) => {
                                        const count = answer.reactions.filter((r) => r.emoji === em).length;
                                        const mine = answer.reactions.some(
                                          (r) => r.emoji === em && r.userId === currentUserId
                                        );
                                        return (
                                          <button
                                            key={em}
                                            type="button"
                                            onClick={() => handleReact(answer.id, em)}
                                            aria-label={`React ${em} to ${label}'s answer`}
                                            aria-pressed={mine}
                                            className={`min-h-[32px] px-1.5 py-0.5 rounded-lg text-xs transition-colors cursor-pointer ${
                                              mine
                                                ? 'bg-violet-500/25 border border-violet-400/45'
                                                : 'hover:bg-[var(--nx-surface-hover)]'
                                            }`}
                                          >
                                            {em}
                                            {count > 0 && (
                                              <span className="ml-0.5 text-[10px] font-mono-tabular">
                                                {count}
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onDiscussInChat(
                                          `Deep Talk "${card.question.questionText}" — ${label}: "${answer.localText}"`
                                        )
                                      }
                                      className="min-h-[32px] inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-cyan-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                                    >
                                      <MessageSquarePlus className="w-3 h-3" />
                                      <span>Discuss</span>
                                    </button>
                                  </div>
                                </motion.div>
                              ) : null
                            )}
                          </div>

                          {session.status === 'active' && (
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <div className="text-xs text-[var(--nx-text-secondary)]">
                                {iAmReady && !peerIsReady
                                  ? `Ready! Waiting for ${peerUser.displayName} to continue...`
                                  : !iAmReady && peerIsReady
                                  ? `${peerUser.displayName} is ready for the next card.`
                                  : 'Both participants confirm before advancing.'}
                              </div>
                              <GlassButton
                                type="button"
                                variant={iAmReady ? 'secondary' : 'primary'}
                                size="md"
                                disabled={busy || iAmReady}
                                onClick={handleNextQuestion}
                                className="min-h-[44px] whitespace-nowrap"
                              >
                                <span>
                                  {iAmReady ? 'Ready · Waiting' : 'Continue to Next Question'}
                                </span>
                                <ChevronRight className="w-4 h-4" />
                              </GlassButton>
                            </div>
                          )}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
