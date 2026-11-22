import React from 'react';
import { motion } from 'motion/react';
import { MessageSquare } from 'lucide-react';
import type { FriendItem, PublicUser } from '../../types/nexora';
import { GlassButton, ProfileAvatar } from '../ui/LiquidGlass';

interface FriendItemCardProps {
  friend: FriendItem;
  prefersReducedMotion: boolean;
  onStartChat: (userId: string) => void;
  onSelectProfile: (user: PublicUser) => void;
}

export const FriendItemCard = React.forwardRef<HTMLDivElement, FriendItemCardProps>(
  function FriendItemCard(
    { friend, prefersReducedMotion, onStartChat, onSelectProfile },
    ref
  ) {
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
          onClick={() => onSelectProfile(friend.user)}
          className="relative z-10 flex items-center gap-3 min-w-0 flex-1 min-h-[44px] text-left cursor-pointer"
        >
          <ProfileAvatar
            src={friend.user.avatarUrl}
            name={friend.user.displayName}
            size="md"
            isOnline={friend.user.isOnline}
          />
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-semibold text-[var(--nx-text-primary)] truncate">
              {friend.user.displayName}
            </div>
            <div className="text-xs text-[var(--nx-text-secondary)] truncate">
              @{friend.user.username}
              {friend.user.isOnline && ' · Online'}
            </div>
          </div>
        </button>

        <GlassButton
          type="button"
          variant="primary"
          size="sm"
          onClick={() => onStartChat(friend.user.id)}
          aria-label={`Start encrypted chat with ${friend.user.displayName}`}
          className="min-h-[40px]"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat</span>
        </GlassButton>
      </motion.div>
    );
  }
);
