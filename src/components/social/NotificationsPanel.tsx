import React from 'react';
import {
  Bell,
  CheckCheck,
  CircleDot,
  Flame,
  MessageCircle,
  UserPlus,
  Users,
} from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { apiRequest } from '../../lib/api';
import { formatRelativeTimestamp } from '../../lib/time';
import type { NotificationItem } from '../../types/nexora';
import { GlassButton, GlassCard, NotificationCard } from '../ui/LiquidGlass';

interface NotificationsPanelProps {
  notifications: NotificationItem[];
  onRefresh: () => void;
}

function getActivityIcon(type: string) {
  if (type.includes('friend')) return <UserPlus className="w-4 h-4" />;
  if (type.includes('streak')) return <Flame className="w-4 h-4 text-amber-500 dark:text-amber-300" />;
  if (type.includes('story')) return <CircleDot className="w-4 h-4 text-sky-600 dark:text-sky-300" />;
  if (type.includes('group')) return <Users className="w-4 h-4 text-violet-600 dark:text-violet-300" />;
  if (type.includes('message')) return <MessageCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-300" />;
  return <Bell className="w-4 h-4" />;
}

export function NotificationsPanel({ notifications, onRefresh }: NotificationsPanelProps) {
  const markAllRead = async () => {
    audioManager.play('ui.settings_saved');
    await apiRequest('/api/v1/notifications/read-all', { method: 'POST' });
    onRefresh();
  };

  return (
    <div className="h-full max-w-3xl mx-auto w-full p-4 sm:p-6 space-y-6 overflow-y-auto pt-safe">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--nx-text-primary)] tracking-tight">
            Activity
          </h1>
          <p className="text-xs sm:text-sm text-[var(--nx-text-secondary)] mt-1">
            Messages, friend requests, story interactions, group updates, and streak milestones.
          </p>
        </div>
        {notifications.some((n) => !n.isRead) && (
          <GlassButton type="button" variant="secondary" size="sm" soundEvent={false} onClick={markAllRead}>
            <CheckCheck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />
            <span>Mark all read</span>
          </GlassButton>
        )}
      </div>

      {notifications.length === 0 ? (
        <GlassCard intensity="subtle" className="py-12 text-center space-y-2.5">
          <div className="w-11 h-11 rounded-2xl nexora-glass-subtle flex items-center justify-center mx-auto">
            <Bell className="w-5 h-5 text-[var(--nx-text-muted)]" />
          </div>
          <div className="text-sm font-semibold text-[var(--nx-text-primary)]">All caught up</div>
          <p className="text-xs text-[var(--nx-text-secondary)]">
            New activity and streak updates will appear here in real time.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-2.5">
          {notifications.map((n) => (
            <NotificationCard
              key={n.id}
              title={n.title}
              body={n.body}
              timestamp={formatRelativeTimestamp(n.createdAt)}
              isRead={n.isRead}
              icon={getActivityIcon(n.type)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
