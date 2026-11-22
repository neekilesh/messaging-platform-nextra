import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Feather,
  Flame,
  Heart,
  History,
  MessageSquarePlus,
  Send,
  SkipForward,
  Smile,
  Sparkles,
  Sun,
  Trophy,
  X,
} from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { apiRequest } from '../../lib/api';
import {
  decryptDailyAssignment,
  encryptConnectionAnswerPayload,
} from '../../lib/connection-games-crypto';
import type { StoredLocalKeyBundle } from '../../lib/crypto';
import { useVisualPrefs } from '../../lib/theme';
import type {
  DailyChallengeAssignment,
  DailyChallengeUserState,
  DailyConnectionStreak,
  PublicUser,
} from '../../types/nexora';
import { GlassButton, GlassCard, ProfileAvatar } from '../ui/LiquidGlass';

interface DailyChallengeViewProps {
  conversationId: string;
  currentUserId: string;
  currentUserDisplayName: string;
  currentUserAvatar: string | null;
  peerUser: PublicUser;
  myKeys: StoredLocalKeyBundle;
  todayChallenge: DailyChallengeAssignment | null;
  challengeHistory: DailyChallengeAssignment[];
  connectionStreak: DailyConnectionStreak;
  onUpdated: (payload: {
    todayChallenge: DailyChallengeAssignment | null;
    connectionStreak?: DailyConnectionStreak;
  }) => void;
  onDiscussInChat: (quoteText: string) => void;
}

const QUICK_REACTIONS = ['❤️', '🔥', '😂', '✨', '🙏'];

function getChallengeSymbolIcon(symbolKey: string) {
  switch (symbolKey) {
    case 'heart-spark':
      return Heart;
    case 'camera-memory':
      return Camera;
    case 'feather-story':
      return Feather;
    case 'smile-sun':
      return Smile;
    case 'compass-dream':
      return Compass;
    case 'sunburst-joy':
    default:
      return Sun;
  }
}

function getChallengeStateLabel(state: DailyChallengeUserState, peerName: string): string {
  switch (state) {
    case 'new_challenge':
      return 'New Challenge Today';
    case 'waiting_for_you':
      return `Waiting for Your Response`;
    case 'waiting_for_friend':
      return `Waiting for ${peerName}`;
    case 'both_completed':
      return 'Both Completed Together';
    case 'skipped':
      return 'Skipped Gently';
    case 'missed':
      return 'Missed Day';
    case 'expired':
      return 'Challenge Expired';
    default:
      return 'Daily Challenge';
  }
}

export function DailyChallengeView({
  conversationId,
  currentUserId,
  currentUserDisplayName,
  currentUserAvatar,
  peerUser,
  myKeys,
  todayChallenge,
  challengeHistory,
  connectionStreak,
  onUpdated,
  onDiscussInChat,
}: DailyChallengeViewProps) {
  const { effectiveReducedMotion: prefersReducedMotion } = useVisualPrefs();
  const [responseText, setResponseText] = useState('');
  const [busy, setBusy] = useState(false);
  const [rippleKey, setRippleKey] = useState<number | null>(null);
  const [celebrateKey, setCelebrateKey] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!todayChallenge || !responseText.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const enc = await encryptConnectionAnswerPayload({
        text: responseText.trim(),
        aad: `daily_challenge:${conversationId}:${todayChallenge.id}`,
        myUserId: currentUserId,
        myKeys,
        peerUser,
      });

      const res = await apiRequest<{
        todayChallenge: DailyChallengeAssignment;
        connectionStreak: DailyConnectionStreak;
      }>(`/api/v1/connection-games/conversations/${conversationId}/daily-challenge/respond`, {
        method: 'POST',
        body: JSON.stringify({
          assignmentId: todayChallenge.id,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          aad: enc.aad,
          recipientEnvelopes: enc.recipientEnvelopes,
        }),
      });

      setResponseText('');
      if (!prefersReducedMotion) {
        setRippleKey(Date.now());
      }

      const decrypted = await decryptDailyAssignment(res.todayChallenge, currentUserId, myKeys);
      const completedBoth = decrypted.revealed || decrypted.lifecycleStatus === 'both_completed';
      if (completedBoth) {
        audioManager.play('achievement.streak_milestone');
        if (!prefersReducedMotion) setCelebrateKey(Date.now());
      } else {
        audioManager.play('message.send');
      }

      onUpdated({
        todayChallenge: decrypted,
        connectionStreak: res.connectionStreak,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your challenge response.');
    } finally {
      setBusy(false);
    }
  };

  const handleSkipChallenge = async () => {
    if (!todayChallenge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{
        todayChallenge: DailyChallengeAssignment;
        connectionStreak: DailyConnectionStreak;
      }>(`/api/v1/connection-games/conversations/${conversationId}/daily-challenge/skip`, {
        method: 'POST',
        body: JSON.stringify({ assignmentId: todayChallenge.id }),
      });

      audioManager.play('ui.glass_touch');
      const decrypted = await decryptDailyAssignment(res.todayChallenge, currentUserId, myKeys);
      onUpdated({
        todayChallenge: decrypted,
        connectionStreak: res.connectionStreak,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not skip challenge.');
    } finally {
      setBusy(false);
    }
  };

  const handleReact = async (responseId: string, emoji: string) => {
    if (!todayChallenge || busy) return;
    try {
      const res = await apiRequest<{ todayChallenge: DailyChallengeAssignment }>(
        `/api/v1/connection-games/conversations/${conversationId}/daily-challenge/react`,
        {
          method: 'POST',
          body: JSON.stringify({ responseId, emoji }),
        }
      );
      audioManager.play('ui.glass_touch');
      const decrypted = await decryptDailyAssignment(res.todayChallenge, currentUserId, myKeys);
      onUpdated({ todayChallenge: decrypted });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add reaction.');
    }
  };

  const SymbolIcon = todayChallenge
    ? getChallengeSymbolIcon(todayChallenge.challenge.symbolKey)
    : Sun;

  const myResponse = todayChallenge?.responses.find((r) => r.userId === currentUserId) || null;
  const peerResponse = todayChallenge?.responses.find((r) => r.userId === peerUser.id) || null;
  const completedCount =
    (todayChallenge?.myResponded ? 1 : 0) + (todayChallenge?.peerResponded ? 1 : 0);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-[16px] bg-rose-500/12 border border-rose-500/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="p-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Daily Connection Streak Banner (completely separate from general chat streaks) */}
      <GlassCard
        intensity="medium"
        padding="md"
        className="rounded-[24px] border border-cyan-400/30 dark:border-violet-400/25 shadow-[0_12px_34px_rgba(78,124,255,0.14)]"
      >
        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/25 via-sky-500/20 to-cyan-400/25 border border-white/50 dark:border-white/15 flex items-center justify-center shrink-0">
                <Flame className="w-5 h-5 text-violet-600 dark:text-cyan-300" />
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-violet-700 dark:text-cyan-300">
                  Daily Connection Streak
                </div>
                <div className="text-xs text-[var(--nx-text-secondary)]">
                  Grows when both of you finish today&apos;s challenge
                </div>
              </div>
            </div>
            {connectionStreak.nextMilestone && (
              <div className="text-right shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                  Next Milestone
                </div>
                <div className="text-xs font-mono-tabular font-semibold text-violet-700 dark:text-cyan-300">
                  {connectionStreak.nextMilestone} days
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl nexora-glass-subtle px-3 py-2 text-center">
              <div className="text-lg font-display font-bold font-mono-tabular text-[var(--nx-text-primary)]">
                {connectionStreak.currentStreak}
              </div>
              <div className="text-[10px] text-[var(--nx-text-secondary)]">Current</div>
            </div>
            <div className="rounded-2xl nexora-glass-subtle px-3 py-2 text-center">
              <div className="text-lg font-display font-bold font-mono-tabular text-[var(--nx-text-primary)]">
                {connectionStreak.longestStreak}
              </div>
              <div className="text-[10px] text-[var(--nx-text-secondary)]">Longest</div>
            </div>
            <div className="rounded-2xl nexora-glass-subtle px-3 py-2 text-center">
              <div className="text-lg font-display font-bold font-mono-tabular text-[var(--nx-text-primary)]">
                {connectionStreak.totalCompleted}
              </div>
              <div className="text-[10px] text-[var(--nx-text-secondary)]">Completed</div>
            </div>
          </div>

          {connectionStreak.milestoneReached && (
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="rounded-2xl bg-gradient-to-r from-violet-500/20 via-sky-500/20 to-cyan-400/20 border border-cyan-300/45 px-3.5 py-2.5 flex items-center gap-2.5"
            >
              <Trophy className="w-4 h-4 text-amber-500 dark:text-amber-300 shrink-0" />
              <div className="text-xs text-[var(--nx-text-primary)] font-medium">
                <span className="font-mono-tabular font-bold">{connectionStreak.milestoneReached}-Day</span>{' '}
                Connection Milestone Unlocked!
              </div>
            </motion.div>
          )}
        </div>
      </GlassCard>

      {/* Today's Challenge Floating Interactive Card */}
      {todayChallenge ? (
        <motion.div
          key={`daily-${todayChallenge.id}`}
          initial={prefersReducedMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-[28px] p-5 sm:p-6 nexora-glass-elevated border border-sky-400/35 dark:border-cyan-400/25 shadow-[0_18px_48px_rgba(74,116,245,0.18)] overflow-hidden"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -left-20 w-56 h-56 rounded-full bg-gradient-to-br from-sky-400/20 via-violet-500/15 to-cyan-300/10 blur-2xl"
          />

          {rippleKey && !prefersReducedMotion && (
            <motion.div
              key={rippleKey}
              initial={{ scale: 0.65, opacity: 0.55 }}
              animate={{ scale: 2.2, opacity: 0 }}
              transition={{ duration: 0.65, ease: 'easeOut' }}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[28px] border-2 border-cyan-300/60"
            />
          )}

          {celebrateKey && !prefersReducedMotion && (
            <motion.div
              key={celebrateKey}
              initial={{ opacity: 0.8, scale: 0.9 }}
              animate={{ opacity: 0, scale: 1.18 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[28px] bg-gradient-to-tr from-violet-400/25 via-sky-300/20 to-cyan-300/25"
            />
          )}

          <div className="relative z-10 space-y-4">
            {/* Header + Animated Symbol */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-sky-700 dark:text-cyan-300">
                  {todayChallenge.challenge.categoryName}
                </div>
                <div className="text-xs font-medium text-[var(--nx-text-primary)]">
                  {getChallengeStateLabel(todayChallenge.userState, peerUser.displayName)}
                </div>
                <div className="text-[11px] font-mono-tabular text-[var(--nx-text-muted)] flex items-center gap-1.5">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span>
                    {todayChallenge.challengeDate} · {todayChallenge.timezone}
                  </span>
                </div>
              </div>

              <motion.div
                animate={prefersReducedMotion ? undefined : { y: [0, -3, 0] }}
                transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
                className="w-11 h-11 rounded-2xl nexora-glass-subtle border border-white/60 dark:border-white/20 flex items-center justify-center shrink-0 shadow-[0_6px_18px_rgba(104,132,255,0.2)]"
              >
                <SymbolIcon className="w-5 h-5 text-violet-600 dark:text-cyan-300" />
              </motion.div>
            </div>

            {/* Challenge Prompt */}
            <h3 className="text-lg sm:text-xl font-display font-semibold text-[var(--nx-text-primary)] leading-snug tracking-tight">
              “{todayChallenge.challenge.promptText}”
            </h3>

            {/* Shared Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-secondary)]">
                <span>Shared Progress</span>
                <span className="font-mono-tabular font-semibold text-[var(--nx-text-primary)]">
                  {completedCount} / 2 Completed
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <motion.div
                  initial={false}
                  animate={{ width: `${(completedCount / 2) * 100}%` }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full rounded-full bg-gradient-to-r from-[#7c5cf6] via-[#566ee6] to-[#38bdf8]"
                />
              </div>
            </div>

            {/* Participants & Completion Indicators */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2.5 rounded-2xl nexora-glass-subtle px-3 py-2">
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
                    {todayChallenge.myResponded ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span>Submitted</span>
                      </>
                    ) : (
                      <span>Pending</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 rounded-2xl nexora-glass-subtle px-3 py-2">
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
                    {todayChallenge.peerResponded ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-cyan-500 shrink-0" />
                        <span>Completed</span>
                      </>
                    ) : (
                      <span>Waiting...</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Form if pending & I haven't responded */}
            {todayChallenge.lifecycleStatus === 'pending' && !todayChallenge.myResponded && (
              <form onSubmit={handleSubmitResponse} className="space-y-3 pt-1">
                <textarea
                  rows={3}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Share today's response... End-to-end encrypted & unlocked together."
                  className="w-full rounded-[18px] bg-white/60 dark:bg-black/30 border border-white/75 dark:border-white/[0.14] px-3.5 py-2.5 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <GlassButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={handleSkipChallenge}
                    className="min-h-[40px]"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>Skip today</span>
                  </GlassButton>

                  <GlassButton
                    type="submit"
                    variant="primary"
                    size="md"
                    disabled={busy || !responseText.trim()}
                    className="min-h-[42px]"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{busy ? 'Encrypting...' : 'Complete Challenge'}</span>
                  </GlassButton>
                </div>
              </form>
            )}

            {/* Submitted & Waiting for Peer */}
            {todayChallenge.lifecycleStatus === 'pending' &&
              todayChallenge.myResponded &&
              !todayChallenge.revealed && (
                <div className="rounded-[20px] nexora-glass-subtle p-4 space-y-2 border border-sky-400/25">
                  <div className="text-[11px] font-medium text-sky-700 dark:text-cyan-300">
                    Your response is saved & encrypted
                  </div>
                  <p className="text-sm text-[var(--nx-text-primary)]">
                    “{myResponse?.localText}”
                  </p>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--nx-text-secondary)]">
                    <Clock className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                    <span>
                      Waiting for {peerUser.displayName} so you can unlock and celebrate together.
                    </span>
                  </div>
                </div>
              )}

            {/* Skipped notice (no pressure) */}
            {todayChallenge.lifecycleStatus === 'skipped' && (
              <div className="rounded-[18px] nexora-glass-subtle p-3.5 text-xs text-[var(--nx-text-secondary)]">
                Today&apos;s challenge was skipped gently. A fresh prompt arrives tomorrow — no pressure.
              </div>
            )}

            {/* Both Completed Synchronized Reveal */}
            {todayChallenge.revealed && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.94, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                className="space-y-3 pt-1"
              >
                <div className="flex items-center justify-between gap-2 text-xs font-medium text-emerald-600 dark:text-cyan-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Shared Completion Unlocked</span>
                  </span>
                  {todayChallenge.completedAt && (
                    <span className="text-[11px] font-mono-tabular text-[var(--nx-text-muted)]">
                      {new Date(todayChallenge.completedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: 'You', resp: myResponse },
                    { label: peerUser.displayName, resp: peerResponse },
                  ].map(({ label, resp }) =>
                    resp ? (
                      <div
                        key={resp.id}
                        className="rounded-[20px] nexora-glass p-3.5 space-y-2.5 border border-cyan-400/35 dark:border-cyan-400/25 shadow-[0_8px_24px_rgba(56,189,248,0.14)]"
                      >
                        <div className="text-[11px] font-semibold text-sky-700 dark:text-cyan-300">
                          {label}
                        </div>
                        <p className="text-sm text-[var(--nx-text-primary)] leading-relaxed break-words">
                          {resp.localText}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                          <div className="flex items-center gap-1">
                            {QUICK_REACTIONS.map((em) => {
                              const count = resp.reactions.filter((r) => r.emoji === em).length;
                              const mine = resp.reactions.some(
                                (r) => r.emoji === em && r.userId === currentUserId
                              );
                              return (
                                <button
                                  key={em}
                                  type="button"
                                  onClick={() => handleReact(resp.id, em)}
                                  className={`px-1.5 py-0.5 rounded-lg text-xs transition-colors cursor-pointer ${
                                    mine
                                      ? 'bg-sky-500/25 border border-cyan-400/40'
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
                                `Daily Challenge "${todayChallenge.challenge.promptText}" — ${label}: "${resp.localText}"`
                              )
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-cyan-300 hover:underline cursor-pointer"
                          >
                            <MessageSquarePlus className="w-3 h-3" />
                            <span>Discuss</span>
                          </button>
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      ) : null}

      {/* Expandable Challenge History */}
      {challengeHistory.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              audioManager.play('ui.glass_touch');
              setShowHistory((v) => !v);
            }}
            className="w-full min-h-[42px] px-3.5 py-2 rounded-[18px] nexora-glass-subtle flex items-center justify-between text-xs font-semibold text-[var(--nx-text-primary)] cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-violet-600 dark:text-cyan-300" />
              <span>Challenge History ({challengeHistory.length})</span>
            </span>
            {showHistory ? (
              <ChevronUp className="w-4 h-4 text-[var(--nx-text-secondary)]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[var(--nx-text-secondary)]" />
            )}
          </button>

          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                className="space-y-2"
              >
                {challengeHistory.map((item) => {
                  const mine = item.responses.find((r) => r.userId === currentUserId);
                  const theirs = item.responses.find((r) => r.userId === peerUser.id);
                  return (
                    <div
                      key={item.id}
                      className="rounded-[18px] nexora-glass-subtle p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono-tabular text-[var(--nx-text-muted)]">
                          {item.challengeDate}
                        </span>
                        <span
                          className={`font-medium ${
                            item.userState === 'both_completed'
                              ? 'text-emerald-600 dark:text-cyan-300'
                              : 'text-[var(--nx-text-secondary)]'
                          }`}
                        >
                          {getChallengeStateLabel(item.userState, peerUser.displayName)}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-[var(--nx-text-primary)]">
                        “{item.challenge.promptText}”
                      </div>
                      {(mine || theirs) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {mine && (
                            <div className="rounded-xl bg-white/40 dark:bg-white/[0.04] px-2.5 py-2">
                              <span className="font-semibold text-sky-700 dark:text-cyan-300">
                                You:{' '}
                              </span>
                              <span className="text-[var(--nx-text-secondary)]">
                                {mine.localText}
                              </span>
                            </div>
                          )}
                          {theirs && (
                            <div className="rounded-xl bg-white/40 dark:bg-white/[0.04] px-2.5 py-2">
                              <span className="font-semibold text-sky-700 dark:text-cyan-300">
                                {peerUser.displayName}:{' '}
                              </span>
                              <span className="text-[var(--nx-text-secondary)]">
                                {theirs.localText}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
