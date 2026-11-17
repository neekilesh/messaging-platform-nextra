import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { StreakInfo } from '../src/types/nexora.ts';
import { createNotification } from './context.ts';

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const CYCLE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const EXPIRING_SOON_MS = 4 * 60 * 60 * 1000;
const MILESTONES = [3, 7, 10, 14, 25, 30, 50, 100, 365];

function orderPair(user1: string, user2: string): [string, string] {
  return user1 < user2 ? [user1, user2] : [user2, user1];
}

export function getStreakInfo(db: DatabaseSync, user1: string, user2: string, nowMs = Date.now()): StreakInfo {
  const [userA, userB] = orderPair(user1, user2);
  const row = db
    .prepare(
      `SELECT streak_count, expires_at FROM streaks WHERE user_a_id = ? AND user_b_id = ?`
    )
    .get(userA, userB) as { streak_count: number; expires_at: string | null } | undefined;

  if (!row || !row.expires_at || row.streak_count <= 0) {
    return {
      streakCount: 0,
      expiresAt: null,
      expiringSoon: false,
      isActive: false,
      milestoneReached: null,
    };
  }

  const expiresMs = Date.parse(row.expires_at);
  if (Number.isNaN(expiresMs) || expiresMs <= nowMs) {
    return {
      streakCount: 0,
      expiresAt: null,
      expiringSoon: false,
      isActive: false,
      milestoneReached: null,
    };
  }

  const remainingMs = expiresMs - nowMs;
  const milestoneReached = MILESTONES.includes(row.streak_count) ? row.streak_count : null;

  return {
    streakCount: row.streak_count,
    expiresAt: row.expires_at,
    expiringSoon: remainingMs <= EXPIRING_SOON_MS,
    isActive: true,
    milestoneReached,
  };
}

/**
 * Server-authoritative reciprocal streak engine.
 * Qualifying messages (text, image, video, voice) within a 24h window from both users
 * advance the streak once per cycle and extend the 24h expiry window.
 */
export function recordStreakActivity(
  db: DatabaseSync,
  senderId: string,
  recipientId: string,
  nowMs = Date.now()
): StreakInfo {
  const [userA, userB] = orderPair(senderId, recipientId);
  const isSenderA = senderId === userA;
  const nowIso = new Date(nowMs).toISOString();
  const nextExpiryIso = new Date(nowMs + WINDOW_24H_MS).toISOString();

  // Only maintain streaks between friends or active 1-to-1 chat participants
  const existing = db
    .prepare(`SELECT * FROM streaks WHERE user_a_id = ? AND user_b_id = ?`)
    .get(userA, userB) as
    | {
        id: string;
        streak_count: number;
        user_a_last_activity_at: string | null;
        user_b_last_activity_at: string | null;
        last_cycle_at: string | null;
        expires_at: string | null;
      }
    | undefined;

  if (!existing) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO streaks (id, user_a_id, user_b_id, streak_count, user_a_last_activity_at, user_b_last_activity_at, last_cycle_at, expires_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, ?)`
    ).run(id, userA, userB, isSenderA ? nowIso : null, isSenderA ? null : nowIso, nowIso);
    return getStreakInfo(db, userA, userB, nowMs);
  }

  let streakCount = existing.streak_count;
  const expired = existing.expires_at ? Date.parse(existing.expires_at) <= nowMs : false;
  if (expired) {
    streakCount = 0;
  }

  const aTime = isSenderA ? nowIso : existing.user_a_last_activity_at;
  const bTime = isSenderA ? existing.user_b_last_activity_at : nowIso;

  const otherTimeMs = isSenderA
    ? existing.user_b_last_activity_at
      ? Date.parse(existing.user_b_last_activity_at)
      : 0
    : existing.user_a_last_activity_at
    ? Date.parse(existing.user_a_last_activity_at)
    : 0;

  const otherActiveWithin24h = otherTimeMs > 0 && nowMs - otherTimeMs <= WINDOW_24H_MS;
  const lastCycleMs = existing.last_cycle_at ? Date.parse(existing.last_cycle_at) : 0;
  const canAdvanceCycle = !lastCycleMs || nowMs - lastCycleMs >= CYCLE_COOLDOWN_MS || streakCount === 0;

  let newCycleAt = existing.last_cycle_at;
  let newExpiresAt = existing.expires_at && !expired ? nextExpiryIso : existing.expires_at;

  if (otherActiveWithin24h && canAdvanceCycle) {
    streakCount += 1;
    newCycleAt = nowIso;
    newExpiresAt = nextExpiryIso;

    if (MILESTONES.includes(streakCount)) {
      for (const targetId of [userA, userB]) {
        const peerId = targetId === userA ? userB : userA;
        createNotification(db, {
          id: crypto.randomUUID(),
          userId: targetId,
          type: 'streak_milestone',
          actorId: peerId,
          entityId: existing.id,
          title: `${streakCount}-day streak milestone`,
          body: `You reached a ${streakCount}-day encrypted streak.`,
        });
      }
    }
  } else if (streakCount > 0 && !expired) {
    newExpiresAt = nextExpiryIso;
  }

  db.prepare(
    `UPDATE streaks
     SET streak_count = ?,
         user_a_last_activity_at = ?,
         user_b_last_activity_at = ?,
         last_cycle_at = ?,
         expires_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(streakCount, aTime, bTime, newCycleAt, newExpiresAt || null, nowIso, existing.id);

  return getStreakInfo(db, userA, userB, nowMs);
}
