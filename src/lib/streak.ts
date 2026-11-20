import type { FriendItem, FriendStreakCountdown, StreakInfo } from '../types/nexora';

export const STREAK_RESET_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STREAK_EXPIRING_WINDOW_MS = 4 * 60 * 60 * 1000;

export function formatStreakCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  if (totalSeconds <= 0) return '0s';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export function calculateFriendStreakCountdown(
  streak: StreakInfo | null | undefined,
  nowMs: number = Date.now()
): FriendStreakCountdown {
  if (!streak || !streak.isActive || streak.streakCount <= 0 || !streak.expiresAt) {
    return {
      isActive: false,
      isExpiring: false,
      remainingMs: null,
      formattedCountdown: null,
    };
  }

  const expiresMs = Date.parse(streak.expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return {
      isActive: false,
      isExpiring: false,
      remainingMs: null,
      formattedCountdown: null,
    };
  }

  const remainingMs = expiresMs - nowMs;
  if (remainingMs <= 0) {
    return {
      isActive: false,
      isExpiring: false,
      remainingMs: 0,
      formattedCountdown: null,
    };
  }

  const isExpiring =
    remainingMs <= STREAK_EXPIRING_WINDOW_MS ||
    (Boolean(streak.expiringSoon) && remainingMs <= STREAK_RESET_WINDOW_MS);

  return {
    isActive: true,
    isExpiring,
    remainingMs,
    formattedCountdown: isExpiring ? formatStreakCountdown(remainingMs) : null,
  };
}

export function withFriendStreakCountdown(
  friend: FriendItem,
  nowMs: number = Date.now()
): FriendItem {
  const countdown = calculateFriendStreakCountdown(friend.streak, nowMs);

  return {
    ...friend,
    streak: {
      ...friend.streak,
      isActive: countdown.isActive,
      expiringSoon: countdown.isExpiring,
    },
    streakExpiringCountdown: countdown.formattedCountdown,
    streakRemainingMs: countdown.remainingMs,
  };
}
