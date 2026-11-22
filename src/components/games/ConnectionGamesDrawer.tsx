import React, { useEffect, useState } from 'react';
import { Flame, Layers, Sparkles, X } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import type { StoredLocalKeyBundle } from '../../lib/crypto';
import type {
  ConnectionGamesOverview,
  DailyChallengeAssignment,
  DailyConnectionStreak,
  DeepTalkSession,
  PublicUser,
} from '../../types/nexora';
import { CosmicLoader } from '../ui/MagicalEffects';
import { DeepTalkCardsView } from './DeepTalkCardsView';
import { DailyChallengeView } from './DailyChallengeView';

export type ConnectionGamesTab = 'deep-talk' | 'daily-challenge';

interface ConnectionGamesDrawerProps {
  conversationId: string;
  currentUserId: string;
  currentUserDisplayName: string;
  currentUserAvatar: string | null;
  peerUser: PublicUser;
  myKeys: StoredLocalKeyBundle;
  overview: ConnectionGamesOverview | null;
  loading: boolean;
  initialTab?: ConnectionGamesTab;
  onOverviewChange: (
    updater: (prev: ConnectionGamesOverview | null) => ConnectionGamesOverview | null
  ) => void;
  onRefreshOverview: () => void;
  onDiscussInChat: (quoteText: string) => void;
  onClose: () => void;
}

export function ConnectionGamesDrawer({
  conversationId,
  currentUserId,
  currentUserDisplayName,
  currentUserAvatar,
  peerUser,
  myKeys,
  overview,
  loading,
  initialTab = 'deep-talk',
  onOverviewChange,
  onRefreshOverview,
  onDiscussInChat,
  onClose,
}: ConnectionGamesDrawerProps) {
  const [activeTab, setActiveTab] = useState<ConnectionGamesTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleSessionUpdated = (session: DeepTalkSession) => {
    onOverviewChange((prev) => {
      if (!prev) return prev;
      const isLive =
        session.status === 'invited' || session.status === 'active' || session.status === 'paused';
      if (isLive) {
        return { ...prev, activeDeepTalkSession: session };
      }
      const nextPast = [
        session,
        ...prev.pastDeepTalkSessions.filter((s) => s.id !== session.id),
      ].slice(0, 6);
      return {
        ...prev,
        activeDeepTalkSession:
          prev.activeDeepTalkSession?.id === session.id ? null : prev.activeDeepTalkSession,
        pastDeepTalkSessions: nextPast,
      };
    });
  };

  const handleDailyUpdated = (payload: {
    todayChallenge: DailyChallengeAssignment | null;
    connectionStreak?: DailyConnectionStreak;
  }) => {
    onOverviewChange((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        todayChallenge: payload.todayChallenge ?? prev.todayChallenge,
        connectionStreak: payload.connectionStreak ?? prev.connectionStreak,
      };
    });
  };

  const hasDeepTalkAttention = Boolean(
    overview?.activeDeepTalkSession &&
      (overview.activeDeepTalkSession.status === 'invited' ||
        overview.activeDeepTalkSession.status === 'active')
  );
  const hasDailyAttention = Boolean(
    overview?.todayChallenge &&
      overview.todayChallenge.lifecycleStatus === 'pending' &&
      !overview.todayChallenge.myResponded
  );

  return (
    <aside className="fixed inset-0 z-40 md:static md:inset-auto w-full md:w-[420px] lg:w-[450px] nexora-glass-elevated border-y-0 border-r-0 md:border-l border-[var(--nx-hairline)] flex flex-col h-full shrink-0 overflow-hidden">
      {/* Header */}
      <div className="relative z-10 px-5 py-4 pt-safe border-b border-[var(--nx-hairline)] flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-600 dark:text-cyan-300 shrink-0" />
            <h3 className="text-base font-display font-semibold text-[var(--nx-text-primary)] truncate">
              Connection Games
            </h3>
          </div>
          <div className="text-xs text-[var(--nx-text-secondary)] truncate">
            With {peerUser.displayName} · End-to-End Encrypted
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            audioManager.play('ui.glass_close');
            onClose();
          }}
          aria-label="Close Connection Games"
          className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[var(--nx-surface-hover)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] flex items-center justify-center transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Switcher */}
      <div className="relative z-10 flex items-center gap-1.5 p-2.5 border-b border-[var(--nx-hairline)] shrink-0">
        <button
          type="button"
          onClick={() => {
            audioManager.play('ui.tab_switch');
            setActiveTab('deep-talk');
          }}
          className={`flex-1 min-h-[40px] px-3 rounded-[14px] text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'deep-talk'
              ? 'bg-white/75 dark:bg-white/[0.15] text-[var(--nx-text-primary)] shadow-sm border border-white/70 dark:border-white/15'
              : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] hover:bg-[var(--nx-surface-hover)]'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-violet-600 dark:text-cyan-300" />
          <span>Deep Talk Cards</span>
          {hasDeepTalkAttention && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-cyan-300" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            audioManager.play('ui.tab_switch');
            setActiveTab('daily-challenge');
          }}
          className={`flex-1 min-h-[40px] px-3 rounded-[14px] text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'daily-challenge'
              ? 'bg-white/75 dark:bg-white/[0.15] text-[var(--nx-text-primary)] shadow-sm border border-white/70 dark:border-white/15'
              : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] hover:bg-[var(--nx-surface-hover)]'
          }`}
        >
          <Flame className="w-3.5 h-3.5 text-sky-600 dark:text-cyan-300" />
          <span>Daily Challenge</span>
          {hasDailyAttention && (
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-cyan-300" />
          )}
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-5">
        {loading && !overview ? (
          <div className="py-12">
            <CosmicLoader
              label="Loading Connection Games..."
              sublabel="Syncing cards, daily prompt & encrypted responses"
            />
          </div>
        ) : overview ? (
          activeTab === 'deep-talk' ? (
            <DeepTalkCardsView
              conversationId={conversationId}
              currentUserId={currentUserId}
              currentUserDisplayName={currentUserDisplayName}
              currentUserAvatar={currentUserAvatar}
              peerUser={peerUser}
              myKeys={myKeys}
              categories={overview.categories}
              activeSession={overview.activeDeepTalkSession}
              pastSessions={overview.pastDeepTalkSessions}
              onSessionUpdated={handleSessionUpdated}
              onDiscussInChat={onDiscussInChat}
              onRefreshOverview={onRefreshOverview}
            />
          ) : (
            <DailyChallengeView
              conversationId={conversationId}
              currentUserId={currentUserId}
              currentUserDisplayName={currentUserDisplayName}
              currentUserAvatar={currentUserAvatar}
              peerUser={peerUser}
              myKeys={myKeys}
              todayChallenge={overview.todayChallenge}
              challengeHistory={overview.challengeHistory}
              connectionStreak={overview.connectionStreak}
              onUpdated={handleDailyUpdated}
              onDiscussInChat={onDiscussInChat}
            />
          )
        ) : (
          <div className="py-12 text-center space-y-3">
            <p className="text-xs text-[var(--nx-text-secondary)]">
              Could not load Connection Games right now.
            </p>
            <button
              type="button"
              onClick={onRefreshOverview}
              className="text-xs font-semibold text-violet-600 dark:text-cyan-300 hover:underline cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
