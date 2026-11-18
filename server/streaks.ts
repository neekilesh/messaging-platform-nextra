import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from '../src/db/index.ts';
import { streaks } from '../src/db/schema.ts';
import type { StreakInfo } from '../src/types/nexora.ts';
import { createNotification } from './context.ts';

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const CYCLE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const EXPIRING_SOON_MS = 4 * 60 * 60 * 1000;
const MILESTONES = [3, 7, 10, 14, 25, 30, 50, 100, 365];

function orderPair(user1: string, user2: string): [string, string] {
  return user1 < user2 ? [user1, user2] : [user2, user1];
}

export async function getStreakInfo(
  database: PgDatabase,
  user1: string,
  user2: string,
  nowMs = Date.now()
): Promise<StreakInfo> {
  const [userA, userB] = orderPair(user1, user2);
  const rows = await database
    .select({
      streakCount: streaks.streakCount,
      expiresAt: streaks.expiresAt,
    })
    .from(streaks)
    .where(and(eq(streaks.userAId, userA), eq(streaks.userBId, userB)))
    .limit(1);

  const row = rows[0];
  if (!row || !row.expiresAt || row.streakCount <= 0) {
    return {
      streakCount: 0,
      expiresAt: null,
      expiringSoon: false,
      isActive: false,
      milestoneReached: null,
    };
  }

  const expiresMs = Date.parse(row.expiresAt);
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
  const milestoneReached = MILESTONES.includes(row.streakCount) ? row.streakCount : null;

  return {
    streakCount: row.streakCount,
    expiresAt: row.expiresAt,
    expiringSoon: remainingMs <= EXPIRING_SOON_MS,
    isActive: true,
    milestoneReached,
  };
}

export async function recordStreakActivity(
  database: PgDatabase,
  senderId: string,
  recipientId: string,
  nowMs = Date.now()
): Promise<StreakInfo> {
  const [userA, userB] = orderPair(senderId, recipientId);
  const isSenderA = senderId === userA;
  const nowIso = new Date(nowMs).toISOString();
  const nextExpiryIso = new Date(nowMs + WINDOW_24H_MS).toISOString();

  const existingRows = await database
    .select()
    .from(streaks)
    .where(and(eq(streaks.userAId, userA), eq(streaks.userBId, userB)))
    .limit(1);

  const existing = existingRows[0];

  if (!existing) {
    const id = crypto.randomUUID();
    await database.insert(streaks).values({
      id,
      userAId: userA,
      userBId: userB,
      streakCount: 0,
      userALastActivityAt: isSenderA ? nowIso : null,
      userBLastActivityAt: isSenderA ? null : nowIso,
      lastCycleAt: null,
      expiresAt: null,
      updatedAt: nowIso,
    });
    return getStreakInfo(database, userA, userB, nowMs);
  }

  let streakCount = existing.streakCount;
  const expired = existing.expiresAt ? Date.parse(existing.expiresAt) <= nowMs : false;
  if (expired) {
    streakCount = 0;
  }

  const aTime = isSenderA ? nowIso : existing.userALastActivityAt;
  const bTime = isSenderA ? existing.userBLastActivityAt : nowIso;

  const otherTimeMs = isSenderA
    ? existing.userBLastActivityAt
      ? Date.parse(existing.userBLastActivityAt)
      : 0
    : existing.userALastActivityAt
    ? Date.parse(existing.userALastActivityAt)
    : 0;

  const otherActiveWithin24h = otherTimeMs > 0 && nowMs - otherTimeMs <= WINDOW_24H_MS;
  const lastCycleMs = existing.lastCycleAt ? Date.parse(existing.lastCycleAt) : 0;
  const canAdvanceCycle = !lastCycleMs || nowMs - lastCycleMs >= CYCLE_COOLDOWN_MS || streakCount === 0;

  let newCycleAt = existing.lastCycleAt;
  let newExpiresAt = existing.expiresAt && !expired ? nextExpiryIso : existing.expiresAt;

  if (otherActiveWithin24h && canAdvanceCycle) {
    streakCount += 1;
    newCycleAt = nowIso;
    newExpiresAt = nextExpiryIso;

    if (MILESTONES.includes(streakCount)) {
      for (const targetId of [userA, userB]) {
        const peerId = targetId === userA ? userB : userA;
        await createNotification(database, {
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

  await database
    .update(streaks)
    .set({
      streakCount,
      userALastActivityAt: aTime,
      userBLastActivityAt: bTime,
      lastCycleAt: newCycleAt,
      expiresAt: newExpiresAt || null,
      updatedAt: nowIso,
    })
    .where(eq(streaks.id, existing.id));

  return getStreakInfo(database, userA, userB, nowMs);
}
