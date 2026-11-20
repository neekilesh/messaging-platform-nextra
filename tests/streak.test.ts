import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateFriendStreakCountdown,
  formatStreakCountdown,
  STREAK_EXPIRING_WINDOW_MS,
  withFriendStreakCountdown,
} from '../src/lib/streak.ts';
import type { FriendItem, StreakInfo } from '../src/types/nexora.ts';

function makeFriend(streak: StreakInfo): FriendItem {
  return {
    friendshipId: 'friendship-1',
    user: {
      id: 'user-2',
      username: 'aria',
      displayName: 'Aria Chen',
      avatarUrl: null,
      bio: '',
      statusText: '',
      isOnline: true,
      lastSeenAt: null,
      ecdhPublicJwk: null,
      ecdsaPublicJwk: null,
      fingerprint: null,
    },
    streak,
    conversationId: 'conv-1',
    createdAt: '2026-11-01T00:00:00.000Z',
  };
}

describe('FriendItem streak expiring countdown', () => {
  const nowMs = Date.parse('2026-11-20T12:00:00.000Z');

  it('formats countdowns cleanly across hours, minutes, and seconds', () => {
    assert.equal(formatStreakCountdown(3 * 3_600_000 + 5 * 60_000 + 9 * 1000), '3h 05m 09s');
    assert.equal(formatStreakCountdown(42 * 60_000 + 8 * 1000), '42m 08s');
    assert.equal(formatStreakCountdown(45 * 1000), '45s');
    assert.equal(formatStreakCountdown(0), '0s');
    assert.equal(formatStreakCountdown(-5000), '0s');
  });

  it('does not show expiring countdown when streak is inactive or well within 24h window', () => {
    const inactive = calculateFriendStreakCountdown(
      {
        streakCount: 0,
        expiresAt: new Date(nowMs + 60_000).toISOString(),
        expiringSoon: false,
        isActive: false,
        milestoneReached: null,
      },
      nowMs
    );
    assert.deepEqual(inactive, {
      isActive: false,
      isExpiring: false,
      remainingMs: null,
      formattedCountdown: null,
    });

    const healthy = calculateFriendStreakCountdown(
      {
        streakCount: 7,
        expiresAt: new Date(nowMs + 14 * 3_600_000).toISOString(),
        expiringSoon: false,
        isActive: true,
        milestoneReached: 7,
      },
      nowMs
    );
    assert.equal(healthy.isActive, true);
    assert.equal(healthy.isExpiring, false);
    assert.equal(healthy.formattedCountdown, null);
  });

  it('calculates expiring countdown when active streak enters its final 4h of the 24h reset window', () => {
    const remainingMs = STREAK_EXPIRING_WINDOW_MS - 18 * 60_000 - 45 * 1000; // 3h 41m 15s
    const friend = makeFriend({
      streakCount: 12,
      expiresAt: new Date(nowMs + remainingMs).toISOString(),
      expiringSoon: false, // verify client detects threshold even before refetch
      isActive: true,
      milestoneReached: null,
    });

    const enriched = withFriendStreakCountdown(friend, nowMs);
    assert.equal(enriched.streak.isActive, true);
    assert.equal(enriched.streak.expiringSoon, true);
    assert.equal(enriched.streakExpiringCountdown, '3h 41m 15s');
    assert.equal(enriched.streakRemainingMs, remainingMs);
  });

  it('marks streak inactive and clears countdown once 24h reset window expires', () => {
    const friend = makeFriend({
      streakCount: 5,
      expiresAt: new Date(nowMs - 1000).toISOString(),
      expiringSoon: true,
      isActive: true,
      milestoneReached: null,
    });

    const enriched = withFriendStreakCountdown(friend, nowMs);
    assert.equal(enriched.streak.isActive, false);
    assert.equal(enriched.streak.expiringSoon, false);
    assert.equal(enriched.streakExpiringCountdown, null);
    assert.equal(enriched.streakRemainingMs, 0);
  });
});
