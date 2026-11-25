import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Layers,
  Plus,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { apiRequest } from '../../lib/api';
import { decryptDeepTalkSession } from '../../lib/connection-games-crypto';
import type { StoredLocalKeyBundle } from '../../lib/crypto';
import { useVisualPrefs } from '../../lib/theme';
import type {
  DeepTalkCategory,
  DeepTalkSession as DeepTalkSessionData,
  PublicUser,
} from '../../types/nexora';
import { GlassButton, GlassCard } from '../ui/LiquidGlass';
import { DeepTalkSession } from './DeepTalkSession';

interface DeepTalkCardsViewProps {
  conversationId: string;
  currentUserId: string;
  currentUserDisplayName: string;
  currentUserAvatar: string | null;
  peerUser: PublicUser;
  myKeys: StoredLocalKeyBundle;
  categories: DeepTalkCategory[];
  activeSession: DeepTalkSessionData | null;
  pastSessions: DeepTalkSessionData[];
  onSessionUpdated: (session: DeepTalkSessionData) => void;
  onDiscussInChat: (quoteText: string) => void;
  onRefreshOverview: () => void;
}

const QUESTION_LIMIT_OPTIONS: Array<{ value: 5 | 10 | 15 | null; label: string }> = [
  { value: 5, label: '5 Cards' },
  { value: 10, label: '10 Cards' },
  { value: 15, label: '15 Cards' },
  { value: null, label: 'Unlimited' },
];

export function DeepTalkCardsView({
  conversationId,
  currentUserId,
  currentUserDisplayName,
  currentUserAvatar,
  peerUser,
  myKeys,
  categories,
  activeSession,
  pastSessions,
  onSessionUpdated,
  onDiscussInChat,
  onRefreshOverview,
}: DeepTalkCardsViewProps) {
  const { effectiveReducedMotion: prefersReducedMotion } = useVisualPrefs();
  const [selectedCategory, setSelectedCategory] = useState<string>('random');
  const [selectedLimit, setSelectedLimit] = useState<5 | 10 | 15 | null>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expandable backend question bank form
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [customCategoryId, setCustomCategoryId] = useState(
    categories[0]?.id || 'getting-to-know-you'
  );
  const [customQuestionText, setCustomQuestionText] = useState('');

  const handleStartSession = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ session: DeepTalkSessionData }>(
        `/api/v1/connection-games/conversations/${conversationId}/deep-talk/sessions`,
        {
          method: 'POST',
          body: JSON.stringify({
            categoryId: selectedCategory,
            questionLimit: selectedLimit,
          }),
        }
      );
      audioManager.play('ui.glass_open');
      const dec = await decryptDeepTalkSession(res.session, currentUserId, myKeys);
      onSessionUpdated(dec);
      onRefreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Deep Talk session.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddCustomQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customQuestionText.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/api/v1/connection-games/questions', {
        method: 'POST',
        body: JSON.stringify({
          categoryId: customCategoryId,
          questionText: customQuestionText.trim(),
        }),
      });
      setCustomQuestionText('');
      setShowAddQuestion(false);
      audioManager.play('ui.settings_saved');
      onRefreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save question.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 16, scale: 0.96, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { type: 'spring', stiffness: 280, damping: 24 }
      }
      className="space-y-4"
    >
      {error && (
        <div className="rounded-[16px] bg-rose-500/12 border border-rose-500/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="p-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Active / Invited / Paused Session */}
      {activeSession && (
        <DeepTalkSession
          conversationId={conversationId}
          session={activeSession}
          currentUserId={currentUserId}
          currentUserDisplayName={currentUserDisplayName}
          currentUserAvatar={currentUserAvatar}
          peerUser={peerUser}
          myKeys={myKeys}
          variant="drawer"
          onSessionUpdated={onSessionUpdated}
          onDiscussInChat={onDiscussInChat}
          onRefreshOverview={onRefreshOverview}
        />
      )}

      {/* Start New Deep Talk Session (when no live invited/active/paused session) */}
      {!activeSession && (
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 300, damping: 26 }
          }
        >
        <GlassCard intensity="medium" padding="lg" className="relative overflow-hidden rounded-[26px] space-y-4">
          {!prefersReducedMotion && (
            <motion.div
              aria-hidden="true"
              initial={{ x: '-120%', opacity: 0.55 }}
              animate={{ x: '160%', opacity: 0 }}
              transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 dark:via-cyan-200/15 to-transparent"
            />
          )}
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-display font-bold text-[var(--nx-text-primary)] flex items-center gap-2">
                <Layers className="w-4 h-4 text-violet-600 dark:text-cyan-300" />
                <span>Start Deep Talk Cards</span>
              </h3>
              <p className="text-xs text-[var(--nx-text-secondary)] mt-0.5">
                Pick a conversation theme and session length. Answers stay encrypted until both of you respond.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddQuestion((v) => !v)}
              className="min-h-[36px] px-2.5 rounded-xl nexora-glass-subtle text-[11px] font-medium text-[var(--nx-text-primary)] inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Card</span>
            </button>
          </div>

          {showAddQuestion && (
            <form
              onSubmit={handleAddCustomQuestion}
              className="relative z-10 rounded-2xl nexora-glass-subtle p-3.5 space-y-2.5"
            >
              <div className="text-xs font-semibold text-[var(--nx-text-primary)]">
                Expand Question Collection
              </div>
              <select
                value={customCategoryId}
                onChange={(e) => setCustomCategoryId(e.target.value)}
                className="w-full h-9 rounded-xl bg-white/60 dark:bg-black/30 border border-white/65 dark:border-white/15 px-3 text-xs text-[var(--nx-text-primary)]"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={customQuestionText}
                onChange={(e) => setCustomQuestionText(e.target.value)}
                placeholder="Write a thoughtful new Deep Talk question..."
                className="w-full h-9 rounded-xl bg-white/60 dark:bg-black/30 border border-white/65 dark:border-white/15 px-3 text-xs text-[var(--nx-text-primary)]"
              />
              <div className="flex justify-end gap-2">
                <GlassButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddQuestion(false)}
                >
                  Cancel
                </GlassButton>
                <GlassButton
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={busy || customQuestionText.trim().length < 6}
                >
                  Save to Library
                </GlassButton>
              </div>
            </form>
          )}

          {/* Category Grid */}
          <div className="relative z-10 space-y-2">
            <div className="text-xs font-medium text-[var(--nx-text-secondary)]">Choose Category</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  audioManager.play('ui.glass_touch');
                  setSelectedCategory('random');
                }}
                className={`min-h-[44px] px-3.5 py-2.5 rounded-[16px] text-left flex items-center justify-between gap-2 transition-all cursor-pointer border ${
                  selectedCategory === 'random'
                    ? 'bg-gradient-to-br from-[#7c5cf6]/90 to-[#566ee6]/90 text-white border-violet-300/60 shadow-md'
                    : 'nexora-glass-subtle text-[var(--nx-text-primary)] border-transparent hover:border-violet-400/35'
                }`}
              >
                <span className="text-xs font-semibold flex items-center gap-2">
                  <Shuffle className="w-3.5 h-3.5 shrink-0" />
                  <span>Random Mix</span>
                </span>
                <span className="text-[11px] font-mono-tabular opacity-80">All</span>
              </button>

              {categories.map((cat) => {
                const active = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      audioManager.play('ui.glass_touch');
                      setSelectedCategory(cat.id);
                    }}
                    className={`min-h-[44px] px-3.5 py-2.5 rounded-[16px] text-left flex items-center justify-between gap-2 transition-all cursor-pointer border ${
                      active
                        ? 'bg-gradient-to-br from-[#7c5cf6]/90 to-[#566ee6]/90 text-white border-violet-300/60 shadow-md'
                        : 'nexora-glass-subtle text-[var(--nx-text-primary)] border-transparent hover:border-violet-400/35'
                    }`}
                  >
                    <span className="text-xs font-semibold truncate">{cat.name}</span>
                    <span className="text-[11px] font-mono-tabular opacity-80 shrink-0">
                      {cat.questionCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Session Length */}
          <div className="relative z-10 space-y-2">
            <div className="text-xs font-medium text-[var(--nx-text-secondary)]">Session Length</div>
            <div className="grid grid-cols-4 gap-2">
              {QUESTION_LIMIT_OPTIONS.map((opt) => {
                const active = selectedLimit === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => {
                      audioManager.play('ui.glass_touch');
                      setSelectedLimit(opt.value);
                    }}
                    className={`min-h-[40px] px-2 rounded-xl text-xs font-medium font-mono-tabular transition-all cursor-pointer border ${
                      active
                        ? 'bg-[#7c5cf6] text-white border-violet-300/60'
                        : 'nexora-glass-subtle text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] border-transparent'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <GlassButton
            type="button"
            variant="primary"
            size="lg"
            disabled={busy}
            onClick={handleStartSession}
            className="w-full min-h-[46px]"
          >
            <Sparkles className="w-4 h-4" />
            <span>{busy ? 'Creating Invitation...' : `Invite ${peerUser.displayName} to Deep Talk`}</span>
          </GlassButton>
        </GlassCard>
        </motion.div>
      )}

      {/* Completed Answers in Current or Past Sessions */}
      {((activeSession && activeSession.revealedHistory.length > 0) || pastSessions.length > 0) && (
        <div className="space-y-2.5 pt-1">
          <div className="text-xs font-semibold text-[var(--nx-text-secondary)] px-1">
            Saved Deep Talk Memories
          </div>
          {[...(activeSession ? [activeSession] : []), ...pastSessions]
            .flatMap((s) =>
              s.revealedHistory.map((h) => ({ sessionId: s.id, category: s.categoryName, card: h }))
            )
            .slice(0, 8)
            .map(({ sessionId, card: hist }) => {
              const mine = hist.answers.find((a) => a.userId === currentUserId);
              const theirs = hist.answers.find((a) => a.userId === peerUser.id);
              return (
                <div
                  key={`${sessionId}-${hist.question.id}`}
                  className="rounded-[18px] nexora-glass-subtle p-3.5 space-y-2"
                >
                  <div className="text-xs font-semibold text-[var(--nx-text-primary)]">
                    “{hist.question.questionText}”
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {mine && (
                      <div className="rounded-xl bg-white/40 dark:bg-white/[0.04] px-2.5 py-2">
                        <span className="font-semibold text-violet-700 dark:text-cyan-300">You: </span>
                        <span className="text-[var(--nx-text-secondary)]">{mine.localText}</span>
                      </div>
                    )}
                    {theirs && (
                      <div className="rounded-xl bg-white/40 dark:bg-white/[0.04] px-2.5 py-2">
                        <span className="font-semibold text-violet-700 dark:text-cyan-300">
                          {peerUser.displayName}:{' '}
                        </span>
                        <span className="text-[var(--nx-text-secondary)]">{theirs.localText}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </motion.div>
  );
}
