import React from 'react';
import { motion } from 'motion/react';
import { Clock, MessageSquare } from 'lucide-react';
import { withFriendStreakCountdown } from '../../lib/streak';
import type { FriendItem, PublicUser } from '../../types/nexora';
import { GlassButton, ProfileAvatar } from '../ui/LiquidGlass';
import { StreakCounter } from '../chat/StreakCounter';

interface FriendItemCardProps {
  friend: FriendItem;
  nowMs: number;
  prefersReducedMotion: boolean;
  onStartChat: (userId: string) => void;
  onSelectProfile: (user: PublicUser) => void;
}

export const FriendItemCard = React.forwardRef<HTMLDivElement, FriendItemCardProps>(
  function FriendItemCard(
    { friend, nowMs, prefersReducedMotion, onStartChat, onSelectProfile },
    ref
  ) {
    const enrichedFriend = withFriendStreakCountdown(friend, nowMs);
    const showExpiringCountdown =
      enrichedFriend.streak.isActive &&
      enrichedFriend.streak.streakCount > 0 &&
      enrichedFriend.streak.expiringSoon &&
      Boolean(enrichedFriend.streakExpiringCountdown);

    return (
      <motion.div
        ref={ref}
        layout={prefersReducedMotion ? false : 'position'}
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.94 }}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 380, damping: 28 }
        }
        className="nexora-glass-subtle rounded-[20px] p-4 flex items-center justify-between gap-3 transition-colors"
      >
        <button
          type="button"
          onClick={() => onSelectProfile(enrichedFriend.user)}
          className="relative z-10 flex items-center gap-3 min-w-0 flex-1 min-h-[44px] text-left cursor-pointer"
        >
          <ProfileAvatar
            src={enrichedFriend.user.avatarUrl}
            name={enrichedFriend.user.displayName}
            size="md"
            isOnline={enrichedFriend.user.isOnline}
          />
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-semibold text-[var(--nx-text-primary)] truncate flex items-center gap-2">
              <span className="truncate">{enrichedFriend.user.displayName}</span>
              <StreakCounter
                streak={enrichedFriend.streak}
                countdownText={enrichedFriend.streakExpiringCountdown}
                variant="avatar"
              />
            </div>
            <div className="text-xs text-[var(--nx-text-secondary)] truncate">
              @{enrichedFriend.user.username}
              {enrichedFriend.user.isOnline && ' · Online'}
            </div>
            {showExpiringCountdown && (
              <div
                data-testid="streak-expiring-countdown"
                className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300"
              >
                <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Streak expiring in{' '}
                  <span className="font-mono-tabular font-semibold">
                    {enrichedFriend.streakExpiringCountdown}
                  </span>
                </span>
              </div>
            )}
          </div>
        </button>

        <GlassButton
          type="button"
          variant="primary"
          size="sm"
          onClick={() => onStartChat(enrichedFriend.user.id)}
          aria-label={`Start encrypted chat with ${enrichedFriend.user.displayName}`}
          className="min-h-[40px]"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat</span>
        </GlassButton>
      </motion.div>
    );
  }
);
