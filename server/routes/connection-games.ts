import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { and, asc, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { isTransientSqlDisconnect, type PgDatabase } from '../../src/db/index.ts';
import { ensureDatabaseSchema } from '../../src/db/ensure-schema.ts';
import {
  conversationParticipants,
  conversations,
  dailyChallengeAssignments,
  dailyChallengeResponses,
  dailyChallenges,
  dailyConnectionStreaks,
  deepTalkAnswers,
  deepTalkQuestions,
  deepTalkSessions,
  friendships,
  notifications,
  privacySettings,
  userBlocks,
  users,
} from '../../src/db/schema.ts';
import {
  createNotification,
  createRequireAuth,
  getIO,
  getPublicUserById,
  isBlockedBetween,
} from '../context.ts';
import type { AuthedRequest } from '../context.ts';
import {
  CONNECTION_STREAK_MILESTONES,
  DEEP_TALK_SEED_CATEGORIES,
  computeEndOfDayIso,
  ensureConnectionGamesSeeded,
  getCalendarDateInTimezone,
  getDayDifference,
  getNextConnectionMilestone,
  isValidIanaTimezone,
  normalizeTimezone,
  pickShuffledQuestionIds,
  resolvePairTimezone,
} from '../connection-games-seed.ts';
import type {
  ConnectionGameReaction,
  DailyChallengeAssignment,
  DailyChallengeUserState,
  DailyConnectionStreak,
  DeepTalkQuestionState,
  DeepTalkSession,
  EncryptedConnectionAnswer,
  RecipientEnvelope,
} from '../../src/types/nexora.ts';

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function isValidEnvelopeObject(val: unknown): val is RecipientEnvelope {
  if (!val || typeof val !== 'object') return false;
  const env = val as Record<string, unknown>;
  return (
    typeof env.ephemeralPublicJwk === 'string' &&
    env.ephemeralPublicJwk.trim().length > 0 &&
    env.ephemeralPublicJwk.length <= 4096 &&
    typeof env.wrappedKey === 'string' &&
    env.wrappedKey.trim().length > 0 &&
    env.wrappedKey.length <= 2048 &&
    typeof env.iv === 'string' &&
    env.iv.trim().length > 0 &&
    env.iv.length <= 512
  );
}

function isValidEncryptedPayload(
  body: Record<string, unknown>,
  requiredUserIds?: string[]
): {
  valid: boolean;
  ciphertext: string;
  iv: string;
  aad: string;
  recipientEnvelopes: Record<string, RecipientEnvelope>;
  error?: string;
} {
  const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext.trim() : '';
  const iv = typeof body.iv === 'string' ? body.iv.trim() : '';
  const aad = typeof body.aad === 'string' ? body.aad.trim() : '';
  const rawEnvelopes = body.recipientEnvelopes as Record<string, unknown> | undefined;

  if (
    !ciphertext ||
    ciphertext.length > 65536 ||
    !iv ||
    iv.length > 512 ||
    !aad ||
    aad.length > 512 ||
    !rawEnvelopes ||
    typeof rawEnvelopes !== 'object' ||
    Array.isArray(rawEnvelopes)
  ) {
    return {
      valid: false,
      ciphertext: '',
      iv: '',
      aad: '',
      recipientEnvelopes: {},
      error: 'Encrypted answer payload (ciphertext, iv, aad, recipientEnvelopes) is required.',
    };
  }

  const envKeys = Object.keys(rawEnvelopes);
  if (envKeys.length === 0) {
    return {
      valid: false,
      ciphertext: '',
      iv: '',
      aad: '',
      recipientEnvelopes: {},
      error: 'At least one recipient encryption envelope is required.',
    };
  }

  const sanitizedEnvelopes: Record<string, RecipientEnvelope> = {};
  for (const key of envKeys) {
    const val = rawEnvelopes[key];
    if (!isValidEnvelopeObject(val)) {
      return {
        valid: false,
        ciphertext: '',
        iv: '',
        aad: '',
        recipientEnvelopes: {},
        error: 'Each recipient encryption envelope must include ephemeralPublicJwk, wrappedKey, and iv.',
      };
    }
    if (!requiredUserIds || requiredUserIds.includes(key)) {
      sanitizedEnvelopes[key] = {
        ephemeralPublicJwk: val.ephemeralPublicJwk.trim(),
        wrappedKey: val.wrappedKey.trim(),
        iv: val.iv.trim(),
      };
    }
  }

  if (requiredUserIds && requiredUserIds.some((uid) => !sanitizedEnvelopes[uid])) {
    return {
      valid: false,
      ciphertext: '',
      iv: '',
      aad: '',
      recipientEnvelopes: {},
      error: 'Recipient encryption envelopes for both conversation participants are required.',
    };
  }

  return { valid: true, ciphertext, iv, aad, recipientEnvelopes: sanitizedEnvelopes };
}

async function loadAuthorizedDeepTalkSession(
  database: PgDatabase,
  sessionId: string,
  userId: string
): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  session?: typeof deepTalkSessions.$inferSelect;
  peerId?: string;
}> {
  const rows = await database
    .select()
    .from(deepTalkSessions)
    .where(eq(deepTalkSessions.id, sessionId))
    .limit(1);
  const session = rows[0];
  if (!session) {
    return { ok: false, status: 404, error: 'Deep Talk session not found.' };
  }
  if (session.initiatorId !== userId && session.peerId !== userId) {
    return { ok: false, status: 403, error: 'Not a participant in this session.' };
  }
  const peerId = session.initiatorId === userId ? session.peerId : session.initiatorId;
  if (await isBlockedBetween(database, session.initiatorId, session.peerId)) {
    return {
      ok: false,
      status: 403,
      error: 'Connection games are unavailable due to block settings.',
    };
  }
  return { ok: true, status: 200, session, peerId };
}

async function sendConnectionNotification(
  database: PgDatabase,
  input: {
    userId: string;
    type: string;
    actorId: string;
    entityId: string;
    title: string;
    body: string;
  }
) {
  try {
    const privacyRows = await database
      .select({ allowConnectionGameNotifications: privacySettings.allowConnectionGameNotifications })
      .from(privacySettings)
      .where(eq(privacySettings.userId, input.userId))
      .limit(1);

    if (privacyRows[0] && privacyRows[0].allowConnectionGameNotifications === 0) {
      return;
    }

    // Deduplicate to never spam repeated notifications for the same event & entity
    const existing = await database
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, input.userId),
          eq(notifications.type, input.type),
          eq(notifications.entityId, input.entityId)
        )
      )
      .limit(1);

    if (existing.length > 0) return;

    await createNotification(database, {
      id: crypto.randomUUID(),
      userId: input.userId,
      type: input.type,
      actorId: input.actorId,
      entityId: input.entityId,
      title: input.title,
      body: input.body,
    });
  } catch (err) {
    console.error('Connection game notification error:', err);
  }
}

async function verifyPrivateConversationAccess(
  database: PgDatabase,
  conversationId: string,
  userId: string
): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  peerId?: string;
  privatePairKey?: string;
}> {
  const convRows = await database
    .select({
      id: conversations.id,
      type: conversations.type,
      privatePairKey: conversations.privatePairKey,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  const conv = convRows[0];
  if (!conv) {
    return { ok: false, status: 404, error: 'Conversation not found.' };
  }
  if (conv.type !== 'private') {
    return {
      ok: false,
      status: 400,
      error: 'Connection games are only available in private conversations.',
    };
  }

  const participants = await database
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));

  const memberIds = participants.map((p) => p.userId);
  if (!memberIds.includes(userId)) {
    return { ok: false, status: 403, error: 'Not a participant of this conversation.' };
  }

  const peerId = memberIds.find((id) => id !== userId);
  if (!peerId) {
    return { ok: false, status: 400, error: 'Private conversation peer not found.' };
  }

  if (await isBlockedBetween(database, userId, peerId)) {
    return { ok: false, status: 403, error: 'Connection games are unavailable due to block settings.' };
  }

  const [a, b] = orderPair(userId, peerId);
  return {
    ok: true,
    status: 200,
    peerId,
    privatePairKey: conv.privatePairKey || `${a}:${b}`,
  };
}

function toEncryptedAnswerDto(
  row: typeof deepTalkAnswers.$inferSelect | typeof dailyChallengeResponses.$inferSelect,
  viewerId: string
): EncryptedConnectionAnswer {
  const rawEnvelopes = safeJsonParse<Record<string, RecipientEnvelope>>(row.recipientEnvelopesJson, {});
  const myEnvelopeOnly: Record<string, RecipientEnvelope> = rawEnvelopes[viewerId]
    ? { [viewerId]: rawEnvelopes[viewerId] }
    : {};

  return {
    id: row.id,
    userId: row.userId,
    ciphertext: row.ciphertext,
    iv: row.iv,
    aad: row.aad,
    recipientEnvelopes: myEnvelopeOnly,
    reactions: safeJsonParse<ConnectionGameReaction[]>(row.reactionsJson, []),
    replyMessageId: row.replyMessageId,
    submittedAt: row.submittedAt,
  };
}

async function hydrateDeepTalkSession(
  database: PgDatabase,
  session: typeof deepTalkSessions.$inferSelect,
  viewerId: string
): Promise<DeepTalkSession> {
  const questionIds = safeJsonParse<string[]>(session.questionIdsJson, []);
  const readyUserIds = safeJsonParse<string[]>(session.readyUserIdsJson, []);
  const skippedQuestionIds = safeJsonParse<string[]>(session.skippedQuestionIdsJson, []);
  const revealedQuestionIds = safeJsonParse<string[]>(session.revealedQuestionIdsJson, []);
  const peerId = session.initiatorId === viewerId ? session.peerId : session.initiatorId;

  const uniqueQIds = Array.from(new Set(questionIds));
  const questionRows =
    uniqueQIds.length > 0
      ? await database
          .select()
          .from(deepTalkQuestions)
          .where(inArray(deepTalkQuestions.id, uniqueQIds))
      : [];
  const questionMap = new Map(questionRows.map((q) => [q.id, q]));

  const answerRows = await database
    .select()
    .from(deepTalkAnswers)
    .where(eq(deepTalkAnswers.sessionId, session.id))
    .orderBy(asc(deepTalkAnswers.submittedAt));

  const answersByQuestion = new Map<string, Array<typeof deepTalkAnswers.$inferSelect>>();
  for (const ans of answerRows) {
    const arr = answersByQuestion.get(ans.questionId) || [];
    arr.push(ans);
    answersByQuestion.set(ans.questionId, arr);
  }

  const buildQuestionState = (qId: string, qIndex: number): DeepTalkQuestionState | null => {
    const q = questionMap.get(qId);
    if (!q) return null;
    const rows = answersByQuestion.get(qId) || [];
    const myRow = rows.find((r) => r.userId === viewerId);
    const peerRow = rows.find((r) => r.userId === peerId);
    const bothAnswered = Boolean(myRow && peerRow);
    const revealed = bothAnswered || revealedQuestionIds.includes(qId);
    const skipped = skippedQuestionIds.includes(qId);

    // GATED REVEAL: never expose friend's answer before both participants submit
    const visibleAnswers = revealed
      ? rows.map((r) => toEncryptedAnswerDto(r, viewerId))
      : myRow
      ? [toEncryptedAnswerDto(myRow, viewerId)]
      : [];

    return {
      questionIndex: qIndex,
      question: {
        id: q.id,
        categoryId: q.categoryId,
        categoryName: q.categoryName,
        questionText: q.questionText,
        sortOrder: q.sortOrder,
      },
      myAnswered: Boolean(myRow),
      peerAnswered: Boolean(peerRow),
      bothAnswered,
      revealed,
      skipped,
      answers: visibleAnswers,
    };
  };

  let currentCard: DeepTalkQuestionState | null = null;
  if (
    session.currentQuestionId &&
    (session.status === 'invited' || session.status === 'active' || session.status === 'paused')
  ) {
    currentCard = buildQuestionState(session.currentQuestionId, session.currentQuestionIndex);
  }

  const revealedHistory: DeepTalkQuestionState[] = [];
  const seenHistoryIds = new Set<string>();
  questionIds.forEach((qId, idx) => {
    if (seenHistoryIds.has(qId)) return;
    if (qId === session.currentQuestionId && session.status !== 'completed' && session.status !== 'ended') {
      return;
    }
    const st = buildQuestionState(qId, idx);
    if (st && (st.revealed || st.myAnswered)) {
      seenHistoryIds.add(qId);
      revealedHistory.push(st);
    }
  });

  return {
    id: session.id,
    conversationId: session.conversationId,
    initiatorId: session.initiatorId,
    peerId: session.peerId,
    categoryId: session.categoryId,
    categoryName: session.categoryName,
    questionLimit: session.questionLimit,
    status: session.status as DeepTalkSession['status'],
    currentQuestionIndex: session.currentQuestionIndex,
    totalLoadedQuestions: questionIds.length,
    readyUserIds,
    skippedQuestionIds,
    revealedQuestionIds,
    pausedByUserId: session.pausedByUserId,
    endedByUserId: session.endedByUserId,
    currentCard,
    revealedHistory,
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

async function emitDeepTalkSync(
  database: PgDatabase,
  session: typeof deepTalkSessions.$inferSelect,
  event: string,
  actorId: string
) {
  const io = getIO();
  if (!io) return;

  const participantIds = [session.initiatorId, session.peerId];
  for (const uid of participantIds) {
    const hydrated = await hydrateDeepTalkSession(database, session, uid);
    io.to(`user:${uid}`).emit('connection_game:deep_talk_updated', {
      conversationId: session.conversationId,
      session: hydrated,
      event,
      actorId,
    });
  }
}

async function expireStaleDailyChallengesAndComputeStreak(
  database: PgDatabase,
  conversationId: string,
  userAId: string,
  userBId: string,
  todayDate: string,
  nowIso: string
): Promise<DailyConnectionStreak> {
  const { streak } = await expireStaleDailyChallengesAndComputeStreakWithMeta(
    database,
    conversationId,
    userAId,
    userBId,
    todayDate,
    nowIso
  );
  return streak;
}

async function expireStaleDailyChallengesAndComputeStreakWithMeta(
  database: PgDatabase,
  conversationId: string,
  userAId: string,
  userBId: string,
  todayDate: string,
  nowIso: string
): Promise<{ streak: DailyConnectionStreak; expiredCount: number }> {
  // Expire any past pending challenge assignments
  const pendingRows = await database
    .select()
    .from(dailyChallengeAssignments)
    .where(
      and(
        eq(dailyChallengeAssignments.conversationId, conversationId),
        eq(dailyChallengeAssignments.lifecycleStatus, 'pending')
      )
    );

  let expiredCount = 0;
  for (const row of pendingRows) {
    if (row.challengeDate < todayDate || row.expiresAt <= nowIso) {
      await database
        .update(dailyChallengeAssignments)
        .set({ lifecycleStatus: 'expired', updatedAt: nowIso })
        .where(eq(dailyChallengeAssignments.id, row.id));
      expiredCount += 1;
    }
  }

  const [a, b] = orderPair(userAId, userBId);
  const streakRows = await database
    .select()
    .from(dailyConnectionStreaks)
    .where(eq(dailyConnectionStreaks.conversationId, conversationId))
    .limit(1);

  let streakRow = streakRows[0];
  if (!streakRow) {
    await database
      .insert(dailyConnectionStreaks)
      .values({
        id: crypto.randomUUID(),
        conversationId,
        userAId: a,
        userBId: b,
        currentStreak: 0,
        longestStreak: 0,
        totalCompleted: 0,
        lastCompletedDate: null,
        lastCelebratedMilestone: 0,
        updatedAt: nowIso,
      })
      .onConflictDoNothing();

    const created = await database
      .select()
      .from(dailyConnectionStreaks)
      .where(eq(dailyConnectionStreaks.conversationId, conversationId))
      .limit(1);
    streakRow = created[0];
  }

  if (!streakRow) {
    return {
      expiredCount,
      streak: {
        currentStreak: 0,
        longestStreak: 0,
        totalCompleted: 0,
        lastCompletedDate: null,
        milestoneReached: null,
        nextMilestone: 3,
      },
    };
  }

  // Missed day resets currentStreak (keeping longestStreak untouched)
  let currentStreak = streakRow.currentStreak;
  if (streakRow.lastCompletedDate && currentStreak > 0) {
    const diffDays = getDayDifference(streakRow.lastCompletedDate, todayDate);
    if (diffDays > 1) {
      currentStreak = 0;
      await database
        .update(dailyConnectionStreaks)
        .set({ currentStreak: 0, updatedAt: nowIso })
        .where(eq(dailyConnectionStreaks.id, streakRow.id));
    }
  }

  const milestoneReached =
    currentStreak > 0 && (CONNECTION_STREAK_MILESTONES as readonly number[]).includes(currentStreak)
      ? currentStreak
      : null;

  return {
    expiredCount,
    streak: {
      currentStreak,
      longestStreak: streakRow.longestStreak,
      totalCompleted: streakRow.totalCompleted,
      lastCompletedDate: streakRow.lastCompletedDate,
      milestoneReached,
      nextMilestone: getNextConnectionMilestone(currentStreak),
    },
  };
}

async function ensureTodayChallengeAssignmentWithMeta(
  database: PgDatabase,
  conversationId: string,
  privatePairKey: string,
  todayDate: string,
  timezone: string,
  nowIso: string
): Promise<{
  assignment: typeof dailyChallengeAssignments.$inferSelect | null;
  created: boolean;
}> {
  const existing = await database
    .select()
    .from(dailyChallengeAssignments)
    .where(
      and(
        eq(dailyChallengeAssignments.conversationId, conversationId),
        eq(dailyChallengeAssignments.challengeDate, todayDate)
      )
    )
    .limit(1);

  if (existing[0]) {
    return { assignment: existing[0], created: false };
  }

  const allChallenges = await database
    .select()
    .from(dailyChallenges)
    .where(eq(dailyChallenges.isActive, 1));
  if (allChallenges.length === 0) return { assignment: null, created: false };

  const recentAssignments = await database
    .select({ challengeId: dailyChallengeAssignments.challengeId })
    .from(dailyChallengeAssignments)
    .where(eq(dailyChallengeAssignments.conversationId, conversationId))
    .orderBy(desc(dailyChallengeAssignments.challengeDate))
    .limit(12);

  const recentIds = new Set(recentAssignments.map((r) => r.challengeId));
  const pool = allChallenges.filter((c) => !recentIds.has(c.id));
  const candidates = pool.length > 0 ? pool : allChallenges;

  // Deterministic yet varied per pair + day using SHA-256 digest
  const seedDigest = crypto
    .createHash('sha256')
    .update(`${privatePairKey}:${todayDate}`)
    .digest();
  const idx = seedDigest.readUInt32BE(0) % candidates.length;
  const chosen = candidates[idx];

  const assignmentId = crypto.randomUUID();
  const expiresAt = computeEndOfDayIso(todayDate, timezone);

  const inserted = await database
    .insert(dailyChallengeAssignments)
    .values({
      id: assignmentId,
      conversationId,
      privatePairKey,
      challengeId: chosen.id,
      challengeDate: todayDate,
      timezone,
      lifecycleStatus: 'pending',
      expiresAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return { assignment: inserted[0], created: true };
  }

  const reloaded = await database
    .select()
    .from(dailyChallengeAssignments)
    .where(
      and(
        eq(dailyChallengeAssignments.conversationId, conversationId),
        eq(dailyChallengeAssignments.challengeDate, todayDate)
      )
    )
    .limit(1);

  return { assignment: reloaded[0] || null, created: false };
}

async function ensureTodayChallengeAssignment(
  database: PgDatabase,
  conversationId: string,
  privatePairKey: string,
  todayDate: string,
  timezone: string,
  nowIso: string
): Promise<typeof dailyChallengeAssignments.$inferSelect | null> {
  const { assignment } = await ensureTodayChallengeAssignmentWithMeta(
    database,
    conversationId,
    privatePairKey,
    todayDate,
    timezone,
    nowIso
  );
  return assignment;
}

async function syncUserTimezoneIfValid(
  database: PgDatabase,
  userId: string,
  rawTz?: string | null
): Promise<string | null> {
  const validTz = isValidIanaTimezone(rawTz);
  if (!validTz) return null;
  try {
    await database
      .update(users)
      .set({ timezone: validTz })
      .where(and(eq(users.id, userId), ne(users.timezone, validTz)));
  } catch (err) {
    console.error('syncUserTimezoneIfValid error:', err);
  }
  return validTz;
}

async function resolveConversationEffectiveTimezone(
  database: PgDatabase,
  conversationId: string,
  viewerId: string,
  peerId: string,
  rawQueryTz?: string | null
): Promise<string> {
  const syncedTz = await syncUserTimezoneIfValid(database, viewerId, rawQueryTz);
  if (syncedTz) {
    return syncedTz;
  }

  const userRows = await database
    .select({
      id: users.id,
      timezone: users.timezone,
      lastSeenAt: users.lastSeenAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(inArray(users.id, [viewerId, peerId]));

  const viewerRow = userRows.find((u) => u.id === viewerId) || { timezone: 'UTC' };
  const peerRow = userRows.find((u) => u.id === peerId) || { timezone: 'UTC' };

  const latestRows = await database
    .select({ timezone: dailyChallengeAssignments.timezone })
    .from(dailyChallengeAssignments)
    .where(eq(dailyChallengeAssignments.conversationId, conversationId))
    .orderBy(desc(dailyChallengeAssignments.challengeDate))
    .limit(1);

  return resolvePairTimezone(viewerRow, peerRow, latestRows[0]?.timezone);
}

async function hydrateDailyAssignment(
  database: PgDatabase,
  assignment: typeof dailyChallengeAssignments.$inferSelect,
  viewerId: string,
  peerId: string,
  todayDate: string,
  nowIso: string
): Promise<DailyChallengeAssignment | null> {
  const challengeRows = await database
    .select()
    .from(dailyChallenges)
    .where(eq(dailyChallenges.id, assignment.challengeId))
    .limit(1);
  const challenge = challengeRows[0];
  if (!challenge) return null;

  const responseRows = await database
    .select()
    .from(dailyChallengeResponses)
    .where(eq(dailyChallengeResponses.assignmentId, assignment.id))
    .orderBy(asc(dailyChallengeResponses.submittedAt));

  const myRow = responseRows.find((r) => r.userId === viewerId);
  const peerRow = responseRows.find((r) => r.userId === peerId);
  const myResponded = Boolean(myRow);
  const peerResponded = Boolean(peerRow);

  let lifecycleStatus = assignment.lifecycleStatus as DailyChallengeAssignment['lifecycleStatus'];
  if (
    lifecycleStatus === 'pending' &&
    (assignment.challengeDate < todayDate || assignment.expiresAt <= nowIso)
  ) {
    lifecycleStatus = 'expired';
  }

  let userState: DailyChallengeUserState = 'new_challenge';
  if (lifecycleStatus === 'both_completed') {
    userState = 'both_completed';
  } else if (lifecycleStatus === 'skipped') {
    userState = 'skipped';
  } else if (lifecycleStatus === 'expired') {
    userState = myResponded ? 'expired' : 'missed';
  } else if (myResponded && !peerResponded) {
    userState = 'waiting_for_friend';
  } else if (!myResponded && peerResponded) {
    userState = 'waiting_for_you';
  } else {
    userState = 'new_challenge';
  }

  const revealed = lifecycleStatus === 'both_completed';
  const visibleResponses = revealed
    ? responseRows.map((r) => toEncryptedAnswerDto(r, viewerId))
    : myRow
    ? [toEncryptedAnswerDto(myRow, viewerId)]
    : [];

  return {
    id: assignment.id,
    conversationId: assignment.conversationId,
    challengeDate: assignment.challengeDate,
    timezone: assignment.timezone,
    lifecycleStatus,
    userState,
    expiresAt: assignment.expiresAt,
    completedAt: assignment.completedAt,
    skippedByUserId: assignment.skippedByUserId,
    challenge: {
      id: challenge.id,
      categoryId: challenge.categoryId,
      categoryName: challenge.categoryName,
      promptText: challenge.promptText,
      symbolKey: challenge.symbolKey,
    },
    myResponded,
    peerResponded,
    revealed,
    responses: visibleResponses,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

async function emitDailyChallengeSync(
  database: PgDatabase,
  assignment: typeof dailyChallengeAssignments.$inferSelect,
  participantA: string,
  participantB: string,
  streak: DailyConnectionStreak,
  event: string,
  actorId: string,
  todayDate: string,
  nowIso: string
) {
  const io = getIO();
  if (!io) return;

  for (const [uid, peer] of [
    [participantA, participantB],
    [participantB, participantA],
  ] as const) {
    const hydrated = await hydrateDailyAssignment(
      database,
      assignment,
      uid,
      peer,
      todayDate,
      nowIso
    );
    io.to(`user:${uid}`).emit('connection_game:daily_challenge_updated', {
      conversationId: assignment.conversationId,
      assignment: hydrated,
      connectionStreak: streak,
      event,
      actorId,
    });
  }
}

export function createConnectionGamesRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  // List categories & question counts
  router.get('/categories', requireAuth, async (_req, res) => {
    try {
      await ensureDatabaseSchema(database);
      await ensureConnectionGamesSeeded(database);

      const allQs = await database
        .select({
          categoryId: deepTalkQuestions.categoryId,
          categoryName: deepTalkQuestions.categoryName,
        })
        .from(deepTalkQuestions)
        .where(eq(deepTalkQuestions.isActive, 1));

      const map = new Map<string, { id: string; name: string; questionCount: number }>();
      for (const cat of DEEP_TALK_SEED_CATEGORIES) {
        map.set(cat.id, { id: cat.id, name: cat.name, questionCount: 0 });
      }
      for (const row of allQs) {
        const cur = map.get(row.categoryId);
        if (cur) {
          cur.questionCount += 1;
        } else {
          map.set(row.categoryId, {
            id: row.categoryId,
            name: row.categoryName,
            questionCount: 1,
          });
        }
      }

      return res.json({ categories: Array.from(map.values()) });
    } catch (error) {
      console.error('list deep talk categories error:', error);
      return res.status(500).json({ error: 'Failed to load question categories.' });
    }
  });

  // Fetch random Deep Talk questions by category (supports 'random'/'all', limit, exclude)
  const handleFetchRandomQuestions = async (req: AuthedRequest, res: Response) => {
    try {
      await ensureDatabaseSchema(database);
      await ensureConnectionGamesSeeded(database);

      const categoryIdRaw =
        typeof req.query.categoryId === 'string' && req.query.categoryId.trim()
          ? req.query.categoryId.trim().toLowerCase().slice(0, 64)
          : 'random';
      const isRandomAll = categoryIdRaw === 'random' || categoryIdRaw === 'all';

      let limit = 5;
      if (req.query.limit !== undefined) {
        const parsedLimit = Number(req.query.limit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
          return res.status(400).json({ error: 'limit must be a positive integer.' });
        }
        limit = Math.min(50, parsedLimit);
      }

      const excludeRaw = typeof req.query.exclude === 'string' ? req.query.exclude : '';
      const excludedIds = new Set(
        excludeRaw
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      );

      const pool = isRandomAll
        ? await database
            .select()
            .from(deepTalkQuestions)
            .where(eq(deepTalkQuestions.isActive, 1))
        : await database
            .select()
            .from(deepTalkQuestions)
            .where(
              and(
                eq(deepTalkQuestions.categoryId, categoryIdRaw),
                eq(deepTalkQuestions.isActive, 1)
              )
            );

      if (!isRandomAll && pool.length === 0) {
        return res
          .status(404)
          .json({ error: 'Selected Deep Talk category was not found or has no active questions.' });
      }

      const categoryName = isRandomAll
        ? 'Random Mix'
        : pool[0]?.categoryName || categoryIdRaw;

      const filteredPool = excludedIds.size > 0
        ? pool.filter((q) => !excludedIds.has(q.id))
        : pool;

      const selectedIds = pickShuffledQuestionIds(filteredPool, limit);
      const byId = new Map(filteredPool.map((q) => [q.id, q]));
      const questions = selectedIds
        .map((id) => byId.get(id))
        .filter((q): q is typeof deepTalkQuestions.$inferSelect => Boolean(q))
        .map((q) => ({
          id: q.id,
          categoryId: q.categoryId,
          categoryName: q.categoryName,
          questionText: q.questionText,
          sortOrder: q.sortOrder,
        }));

      return res.json({
        categoryId: categoryIdRaw,
        categoryName,
        count: questions.length,
        totalAvailable: filteredPool.length,
        questions,
      });
    } catch (error) {
      console.error('fetch random deep talk questions error:', error);
      return res.status(500).json({ error: 'Failed to fetch random questions.' });
    }
  };

  router.get('/deep-talk/questions/random', requireAuth, handleFetchRandomQuestions);
  router.get('/questions/random', requireAuth, handleFetchRandomQuestions);

  // Add a question to expand the backend Deep Talk library
  router.post('/questions', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      await ensureConnectionGamesSeeded(database);

      const categoryId =
        typeof req.body?.categoryId === 'string'
          ? req.body.categoryId.trim().toLowerCase().slice(0, 64)
          : '';
      const questionText =
        typeof req.body?.questionText === 'string' ? req.body.questionText.trim().slice(0, 280) : '';

      if (!categoryId || questionText.length < 6) {
        return res
          .status(400)
          .json({ error: 'Category and a question of at least 6 characters are required.' });
      }

      const matchedSeed = DEEP_TALK_SEED_CATEGORIES.find((c) => c.id === categoryId);
      const categoryName =
        typeof req.body?.categoryName === 'string' && req.body.categoryName.trim()
          ? req.body.categoryName.trim().slice(0, 80)
          : matchedSeed?.name || categoryId;

      const existing = await database
        .select({ id: deepTalkQuestions.id })
        .from(deepTalkQuestions)
        .where(eq(deepTalkQuestions.categoryId, categoryId));

      const id = `dtq_custom_${crypto.randomUUID().slice(0, 12)}`;
      const nowIso = new Date().toISOString();
      await database.insert(deepTalkQuestions).values({
        id,
        categoryId,
        categoryName,
        questionText,
        sortOrder: existing.length + 1,
        isActive: 1,
        createdByUserId: req.userId!,
        createdAt: nowIso,
      });

      return res.status(201).json({
        question: {
          id,
          categoryId,
          categoryName,
          questionText,
          sortOrder: existing.length + 1,
        },
      });
    } catch (error) {
      console.error('create deep talk question error:', error);
      return res.status(500).json({ error: 'Failed to add question.' });
    }
  });

  // Load full Connection Games overview for a private conversation (handles reconnection & recovery)
  router.get('/conversations/:conversationId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      await ensureConnectionGamesSeeded(database);

      const conversationId = String(req.params.conversationId);
      const access = await verifyPrivateConversationAccess(database, conversationId, req.userId!);
      if (!access.ok || !access.peerId || !access.privatePairKey) {
        return res.status(access.status).json({ error: access.error });
      }

      const timezone = await resolveConversationEffectiveTimezone(
        database,
        conversationId,
        req.userId!,
        access.peerId,
        typeof req.query.tz === 'string' ? req.query.tz : undefined
      );
      const now = new Date();
      const nowIso = now.toISOString();
      const todayDate = getCalendarDateInTimezone(now, timezone);

      // Categories
      const allQs = await database
        .select({
          categoryId: deepTalkQuestions.categoryId,
          categoryName: deepTalkQuestions.categoryName,
        })
        .from(deepTalkQuestions)
        .where(eq(deepTalkQuestions.isActive, 1));

      const catMap = new Map<string, { id: string; name: string; questionCount: number }>();
      for (const c of DEEP_TALK_SEED_CATEGORIES) {
        catMap.set(c.id, { id: c.id, name: c.name, questionCount: 0 });
      }
      for (const row of allQs) {
        const cur = catMap.get(row.categoryId);
        if (cur) cur.questionCount += 1;
        else catMap.set(row.categoryId, { id: row.categoryId, name: row.categoryName, questionCount: 1 });
      }

      // Deep Talk Sessions
      const sessionRows = await database
        .select()
        .from(deepTalkSessions)
        .where(eq(deepTalkSessions.conversationId, conversationId))
        .orderBy(desc(deepTalkSessions.updatedAt))
        .limit(15);

      const activeRow = sessionRows.find(
        (s) => s.status === 'invited' || s.status === 'active' || s.status === 'paused'
      );
      const activeDeepTalkSession = activeRow
        ? await hydrateDeepTalkSession(database, activeRow, req.userId!)
        : null;

      const pastRows = sessionRows.filter((s) => s.id !== activeRow?.id).slice(0, 6);
      const pastDeepTalkSessions: DeepTalkSession[] = [];
      for (const s of pastRows) {
        pastDeepTalkSessions.push(await hydrateDeepTalkSession(database, s, req.userId!));
      }

      // Daily Connection Streak & Today's Shared Challenge
      const connectionStreak = await expireStaleDailyChallengesAndComputeStreak(
        database,
        conversationId,
        req.userId!,
        access.peerId,
        todayDate,
        nowIso
      );

      const todayRow = await ensureTodayChallengeAssignment(
        database,
        conversationId,
        access.privatePairKey,
        todayDate,
        timezone,
        nowIso
      );

      const todayChallenge = todayRow
        ? await hydrateDailyAssignment(database, todayRow, req.userId!, access.peerId, todayDate, nowIso)
        : null;

      const historyRows = await database
        .select()
        .from(dailyChallengeAssignments)
        .where(eq(dailyChallengeAssignments.conversationId, conversationId))
        .orderBy(desc(dailyChallengeAssignments.challengeDate))
        .limit(20);

      const challengeHistory: DailyChallengeAssignment[] = [];
      for (const row of historyRows) {
        if (todayRow && row.id === todayRow.id) continue;
        const hydrated = await hydrateDailyAssignment(
          database,
          row,
          req.userId!,
          access.peerId,
          todayDate,
          nowIso
        );
        if (hydrated) challengeHistory.push(hydrated);
      }

      return res.json({
        conversationId,
        timezone,
        todayDate,
        categories: Array.from(catMap.values()),
        activeDeepTalkSession,
        pastDeepTalkSessions,
        todayChallenge,
        challengeHistory,
        connectionStreak,
      });
    } catch (error) {
      console.error('load connection games overview error:', error);
      return res.status(500).json({ error: 'Failed to load Connection Games.' });
    }
  });

  // Start a new Deep Talk Cards session
  router.post(
    '/conversations/:conversationId/deep-talk/sessions',
    requireAuth,
    async (req: AuthedRequest, res) => {
      try {
        await ensureDatabaseSchema(database);
        await ensureConnectionGamesSeeded(database);

        const conversationId = String(req.params.conversationId);
        const access = await verifyPrivateConversationAccess(database, conversationId, req.userId!);
        if (!access.ok || !access.peerId) {
          return res.status(access.status).json({ error: access.error });
        }

        const categoryIdRaw =
          (typeof req.body?.categoryId === 'string'
            ? req.body.categoryId.trim().toLowerCase()
            : '') || 'random';
        const limitRaw = req.body?.questionLimit;
        const validLimits = new Set([5, 10, 15]);
        let questionLimit: number | null;
        if (limitRaw === null || limitRaw === undefined || limitRaw === 'unlimited') {
          questionLimit = null;
        } else if (validLimits.has(Number(limitRaw))) {
          questionLimit = Number(limitRaw);
        } else {
          return res
            .status(400)
            .json({ error: 'questionLimit must be 5, 10, 15, or null for unlimited.' });
        }

        // Check for existing live or paused session
        const existingActive = await database
          .select({ id: deepTalkSessions.id, status: deepTalkSessions.status })
          .from(deepTalkSessions)
          .where(
            and(
              eq(deepTalkSessions.conversationId, conversationId),
              or(
                eq(deepTalkSessions.status, 'invited'),
                eq(deepTalkSessions.status, 'active'),
                eq(deepTalkSessions.status, 'paused')
              )
            )
          )
          .limit(1);

        if (existingActive.length > 0) {
          return res.status(409).json({
            error: 'An active or paused Deep Talk Cards session is already open in this chat.',
          });
        }

        const pool =
          categoryIdRaw === 'random'
            ? await database
                .select()
                .from(deepTalkQuestions)
                .where(eq(deepTalkQuestions.isActive, 1))
            : await database
                .select()
                .from(deepTalkQuestions)
                .where(
                  and(
                    eq(deepTalkQuestions.categoryId, categoryIdRaw),
                    eq(deepTalkQuestions.isActive, 1)
                  )
                );

        if (pool.length === 0) {
          return res.status(400).json({ error: 'Selected Deep Talk category has no questions.' });
        }

        const categoryName =
          categoryIdRaw === 'random' ? 'Random Mix' : pool[0].categoryName;

        // If limit exceeds single category size (e.g. 15 from a 5-question category), include other categories after exhausting chosen category or pick up to limit
        let selectedIds = pickShuffledQuestionIds(pool, questionLimit);
        if (questionLimit && selectedIds.length < questionLimit) {
          const fallbackPool = await database
            .select()
            .from(deepTalkQuestions)
            .where(eq(deepTalkQuestions.isActive, 1));
          const extra = pickShuffledQuestionIds(
            fallbackPool.filter((q) => !selectedIds.includes(q.id)),
            questionLimit - selectedIds.length
          );
          selectedIds = [...selectedIds, ...extra];
        }

        const sessionId = crypto.randomUUID();
        const nowIso = new Date().toISOString();

        await database.insert(deepTalkSessions).values({
          id: sessionId,
          conversationId,
          initiatorId: req.userId!,
          peerId: access.peerId,
          categoryId: categoryIdRaw,
          categoryName,
          questionLimit,
          status: 'invited',
          questionIdsJson: JSON.stringify(selectedIds),
          currentQuestionIndex: 0,
          currentQuestionId: selectedIds[0],
          readyUserIdsJson: '[]',
          skippedQuestionIdsJson: '[]',
          revealedQuestionIdsJson: '[]',
          lastActivityAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const createdRows = await database
          .select()
          .from(deepTalkSessions)
          .where(eq(deepTalkSessions.id, sessionId))
          .limit(1);
        const sessionRow = createdRows[0];

        const me = await getPublicUserById(database, req.userId!, req.userId!);
        await sendConnectionNotification(database, {
          userId: access.peerId,
          type: 'deep_talk_invite',
          actorId: req.userId!,
          entityId: sessionId,
          title: 'Deep Talk Cards Invite',
          body: `@${me?.username || 'A friend'} invited you to play "${categoryName}".`,
        });

        await emitDeepTalkSync(database, sessionRow, 'session_invited', req.userId!);

        return res.status(201).json({
          session: await hydrateDeepTalkSession(database, sessionRow, req.userId!),
        });
      } catch (error) {
        console.error('create deep talk session error:', error);
        return res.status(500).json({ error: 'Failed to start Deep Talk session.' });
      }
    }
  );

  // Get a single Deep Talk session with gated E2EE answers
  router.get('/deep-talk/sessions/:sessionId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const sessionId = String(req.params.sessionId);
      const auth = await loadAuthorizedDeepTalkSession(database, sessionId, req.userId!);
      if (!auth.ok || !auth.session) {
        return res.status(auth.status).json({ error: auth.error });
      }

      return res.json({
        session: await hydrateDeepTalkSession(database, auth.session, req.userId!),
      });
    } catch (error) {
      console.error('get deep talk session error:', error);
      return res.status(500).json({ error: 'Failed to load Deep Talk session.' });
    }
  });

  // Accept or decline a Deep Talk session invitation
  router.post('/deep-talk/sessions/:sessionId/respond', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const sessionId = String(req.params.sessionId);
      const action = req.body?.action === 'accept' ? 'accept' : req.body?.action === 'decline' ? 'decline' : null;
      if (!action) {
        return res.status(400).json({ error: 'Action must be accept or decline.' });
      }

      const auth = await loadAuthorizedDeepTalkSession(database, sessionId, req.userId!);
      if (!auth.ok || !auth.session) {
        return res.status(auth.status).json({ error: auth.error });
      }
      const session = auth.session;

      if (session.peerId !== req.userId) {
        return res.status(403).json({ error: 'Only the invited participant can accept or decline.' });
      }
      if (session.status !== 'invited') {
        return res.status(409).json({ error: `Session invitation is already ${session.status}.` });
      }

      const nextStatus = action === 'accept' ? 'active' : 'declined';
      const nowIso = new Date().toISOString();

      await database
        .update(deepTalkSessions)
        .set({
          status: nextStatus,
          lastActivityAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(deepTalkSessions.id, sessionId));

      const updated = (
        await database.select().from(deepTalkSessions).where(eq(deepTalkSessions.id, sessionId)).limit(1)
      )[0];

      const me = await getPublicUserById(database, req.userId!, req.userId!);
      await sendConnectionNotification(database, {
        userId: session.initiatorId,
        type: action === 'accept' ? 'deep_talk_accepted' : 'deep_talk_declined',
        actorId: req.userId!,
        entityId: sessionId,
        title: action === 'accept' ? 'Deep Talk Accepted' : 'Deep Talk Declined',
        body:
          action === 'accept'
            ? `@${me?.username || 'Your friend'} joined your Deep Talk Cards session.`
            : `@${me?.username || 'Your friend'} passed on the Deep Talk invite for now.`,
      });

      await emitDeepTalkSync(
        database,
        updated,
        action === 'accept' ? 'session_accepted' : 'session_declined',
        req.userId!
      );

      return res.json({
        session: await hydrateDeepTalkSession(database, updated, req.userId!),
      });
    } catch (error) {
      console.error('respond deep talk invite error:', error);
      return res.status(500).json({ error: 'Failed to respond to invitation.' });
    }
  });

  // Submit E2EE encrypted answer to current Deep Talk question
  router.post('/deep-talk/sessions/:sessionId/answer', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const sessionId = String(req.params.sessionId);
      const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId.trim() : '';
      if (!questionId) {
        return res.status(400).json({ error: 'questionId and encrypted payload are required.' });
      }

      const auth = await loadAuthorizedDeepTalkSession(database, sessionId, req.userId!);
      if (!auth.ok || !auth.session || !auth.peerId) {
        return res.status(auth.status).json({ error: auth.error });
      }
      const session = auth.session;

      const encCheck = isValidEncryptedPayload(req.body || {}, [session.initiatorId, session.peerId]);
      if (!encCheck.valid) {
        return res.status(400).json({ error: encCheck.error || 'Encrypted payload is required.' });
      }
      if (session.status !== 'active') {
        return res.status(400).json({ error: `Cannot submit answer while session is ${session.status}.` });
      }
      if (session.currentQuestionId !== questionId) {
        return res.status(400).json({ error: 'This question is no longer the active card.' });
      }

      const duplicate = await database
        .select({ id: deepTalkAnswers.id })
        .from(deepTalkAnswers)
        .where(
          and(
            eq(deepTalkAnswers.sessionId, sessionId),
            eq(deepTalkAnswers.questionId, questionId),
            eq(deepTalkAnswers.userId, req.userId!)
          )
        )
        .limit(1);

      if (duplicate.length > 0) {
        return res.status(409).json({ error: 'You already submitted an answer for this card.' });
      }

      const nowIso = new Date().toISOString();
      const answerId = crypto.randomUUID();
      await database.insert(deepTalkAnswers).values({
        id: answerId,
        sessionId,
        conversationId: session.conversationId,
        questionId,
        questionIndex: session.currentQuestionIndex,
        userId: req.userId!,
        ciphertext: encCheck.ciphertext,
        iv: encCheck.iv,
        aad: encCheck.aad,
        recipientEnvelopesJson: JSON.stringify(encCheck.recipientEnvelopes),
        reactionsJson: '[]',
        submittedAt: nowIso,
      });

      const allAnswersForQ = await database
        .select()
        .from(deepTalkAnswers)
        .where(
          and(
            eq(deepTalkAnswers.sessionId, sessionId),
            eq(deepTalkAnswers.questionId, questionId)
          )
        );

      const bothAnswered =
        allAnswersForQ.some((a) => a.userId === session.initiatorId) &&
        allAnswersForQ.some((a) => a.userId === session.peerId);

      const revealedIds = safeJsonParse<string[]>(session.revealedQuestionIdsJson, []);
      if (bothAnswered && !revealedIds.includes(questionId)) {
        revealedIds.push(questionId);
      }

      await database
        .update(deepTalkSessions)
        .set({
          revealedQuestionIdsJson: JSON.stringify(revealedIds),
          lastActivityAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(deepTalkSessions.id, sessionId));

      const updated = (
        await database.select().from(deepTalkSessions).where(eq(deepTalkSessions.id, sessionId)).limit(1)
      )[0];

      const peerId = auth.peerId;
      const me = await getPublicUserById(database, req.userId!, req.userId!);

      await sendConnectionNotification(database, {
        userId: peerId,
        type: bothAnswered ? 'deep_talk_revealed' : 'deep_talk_answered',
        actorId: req.userId!,
        entityId: `${sessionId}:${questionId}`,
        title: bothAnswered ? 'Deep Talk Answers Revealed' : 'Friend Answered Card',
        body: bothAnswered
          ? `Both of you answered card #${session.currentQuestionIndex + 1}. Tap to reveal together!`
          : `@${me?.username || 'Your friend'} answered card #${session.currentQuestionIndex + 1}. Share yours to reveal!`,
      });

      await emitDeepTalkSync(
        database,
        updated,
        bothAnswered ? 'answers_revealed' : 'answer_submitted',
        req.userId!
      );

      return res.status(201).json({
        revealed: bothAnswered,
        session: await hydrateDeepTalkSession(database, updated, req.userId!),
      });
    } catch (error) {
      console.error('submit deep talk answer error:', error);
      return res.status(500).json({ error: 'Failed to submit encrypted answer.' });
    }
  });

  // React to a revealed Deep Talk answer
  router.post('/deep-talk/sessions/:sessionId/react', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const sessionId = String(req.params.sessionId);
      const answerId = typeof req.body?.answerId === 'string' ? req.body.answerId : '';
      const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 16) : '';
      if (!answerId || !emoji) {
        return res.status(400).json({ error: 'answerId and emoji are required.' });
      }

      const auth = await loadAuthorizedDeepTalkSession(database, sessionId, req.userId!);
      if (!auth.ok || !auth.session) {
        return res.status(auth.status).json({ error: auth.error });
      }
      const session = auth.session;

      const ansRows = await database
        .select()
        .from(deepTalkAnswers)
        .where(and(eq(deepTalkAnswers.id, answerId), eq(deepTalkAnswers.sessionId, sessionId)))
        .limit(1);
      const ans = ansRows[0];
      if (!ans) {
        return res.status(404).json({ error: 'Answer not found.' });
      }

      const revealedIds = safeJsonParse<string[]>(session.revealedQuestionIdsJson, []);
      if (!revealedIds.includes(ans.questionId)) {
        return res.status(400).json({ error: 'Cannot react before answers are revealed.' });
      }

      const reactions = safeJsonParse<ConnectionGameReaction[]>(ans.reactionsJson, []);
      const existingIdx = reactions.findIndex(
        (r) => r.userId === req.userId && r.emoji === emoji
      );
      if (existingIdx >= 0) {
        reactions.splice(existingIdx, 1);
      } else {
        reactions.push({
          userId: req.userId!,
          emoji,
          createdAt: new Date().toISOString(),
        });
      }

      await database
        .update(deepTalkAnswers)
        .set({ reactionsJson: JSON.stringify(reactions) })
        .where(eq(deepTalkAnswers.id, answerId));

      await emitDeepTalkSync(database, session, 'answer_reacted', req.userId!);

      return res.json({
        session: await hydrateDeepTalkSession(database, session, req.userId!),
      });
    } catch (error) {
      console.error('react deep talk answer error:', error);
      return res.status(500).json({ error: 'Failed to react to answer.' });
    }
  });

  // Mark ready / advance to next question (advances once both participants are ready)
  router.post('/deep-talk/sessions/:sessionId/next', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const sessionId = String(req.params.sessionId);

      const auth = await loadAuthorizedDeepTalkSession(database, sessionId, req.userId!);
      if (!auth.ok || !auth.session) {
        return res.status(auth.status).json({ error: auth.error });
      }
      const session = auth.session;

      if (session.status !== 'active') {
        return res.status(400).json({ error: `Cannot advance session in ${session.status} state.` });
      }

      const readyIds = new Set(safeJsonParse<string[]>(session.readyUserIdsJson, []));
      readyIds.add(req.userId!);

      const bothReady =
        readyIds.has(session.initiatorId) && readyIds.has(session.peerId);
      const nowIso = new Date().toISOString();

      if (!bothReady) {
        await database
          .update(deepTalkSessions)
          .set({
            readyUserIdsJson: JSON.stringify(Array.from(readyIds)),
            lastActivityAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(deepTalkSessions.id, sessionId));

        const updated = (
          await database.select().from(deepTalkSessions).where(eq(deepTalkSessions.id, sessionId)).limit(1)
        )[0];

        const peerId = session.initiatorId === req.userId ? session.peerId : session.initiatorId;
        const me = await getPublicUserById(database, req.userId!, req.userId!);
        await sendConnectionNotification(database, {
          userId: peerId,
          type: 'deep_talk_ready',
          actorId: req.userId!,
          entityId: `${sessionId}:ready:${session.currentQuestionIndex}`,
          title: 'Ready for Next Question',
          body: `@${me?.username || 'Your friend'} is ready for the next Deep Talk card.`,
        });

        await emitDeepTalkSync(database, updated, 'ready_for_next', req.userId!);
        return res.json({
          advanced: false,
          session: await hydrateDeepTalkSession(database, updated, req.userId!),
        });
      }

      // Both ready -> advance!
      let questionIds = safeJsonParse<string[]>(session.questionIdsJson, []);
      const nextIndex = session.currentQuestionIndex + 1;

      if (session.questionLimit && nextIndex >= session.questionLimit) {
        await database
          .update(deepTalkSessions)
          .set({
            status: 'completed',
            readyUserIdsJson: '[]',
            currentQuestionId: null,
            lastActivityAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(deepTalkSessions.id, sessionId));

        const completed = (
          await database.select().from(deepTalkSessions).where(eq(deepTalkSessions.id, sessionId)).limit(1)
        )[0];
        await emitDeepTalkSync(database, completed, 'session_completed', req.userId!);
        return res.json({
          advanced: true,
          session: await hydrateDeepTalkSession(database, completed, req.userId!),
        });
      }

      // Refill unlimited deck if reaching end of loaded IDs
      if (nextIndex >= questionIds.length) {
        const pool =
          session.categoryId === 'random'
            ? await database.select().from(deepTalkQuestions).where(eq(deepTalkQuestions.isActive, 1))
            : await database
                .select()
                .from(deepTalkQuestions)
                .where(
                  and(
                    eq(deepTalkQuestions.categoryId, session.categoryId),
                    eq(deepTalkQuestions.isActive, 1)
                  )
                );
        const unaskedInCategory = pool.filter((q) => !questionIds.includes(q.id));
        let refillSource = unaskedInCategory;
        if (refillSource.length === 0) {
          const allActive = await database
            .select()
            .from(deepTalkQuestions)
            .where(eq(deepTalkQuestions.isActive, 1));
          const unaskedAnywhere = allActive.filter((q) => !questionIds.includes(q.id));
          refillSource = unaskedAnywhere.length > 0 ? unaskedAnywhere : pool;
        }
        const extraIds = pickShuffledQuestionIds(refillSource, 10);
        questionIds = [...questionIds, ...extraIds];
      }

      const nextQId = questionIds[nextIndex] || null;
      await database
        .update(deepTalkSessions)
        .set({
          questionIdsJson: JSON.stringify(questionIds),
          currentQuestionIndex: nextIndex,
          currentQuestionId: nextQId,
          status: nextQId ? 'active' : 'completed',
          readyUserIdsJson: '[]',
          lastActivityAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(deepTalkSessions.id, sessionId));

      const updated = (
        await database.select().from(deepTalkSessions).where(eq(deepTalkSessions.id, sessionId)).limit(1)
      )[0];

      await emitDeepTalkSync(database, updated, 'question_advanced', req.userId!);
      return res.json({
        advanced: true,
        session: await hydrateDeepTalkSession(database, updated, req.userId!),
      });
    } catch (error) {
      console.error('advance deep talk session error:', error);
      return res.status(500).json({ error: 'Failed to advance to next question.' });
    }
  });

  // Skip current question without pressure
  router.post('/deep-talk/sessions/:sessionId/skip', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const sessionId = String(req.params.sessionId);

      const auth = await loadAuthorizedDeepTalkSession(database, sessionId, req.userId!);
      if (!auth.ok || !auth.session) {
        return res.status(auth.status).json({ error: auth.error });
      }
      const session = auth.session;
      if (session.status !== 'active') {
        return res.status(400).json({ error: `Cannot skip while session is ${session.status}.` });
      }

      const skippedIds = new Set(safeJsonParse<string[]>(session.skippedQuestionIdsJson, []));
      if (session.currentQuestionId) {
        skippedIds.add(session.currentQuestionId);
      }

      let questionIds = safeJsonParse<string[]>(session.questionIdsJson, []);
      const nextIndex = session.currentQuestionIndex + 1;
      const nowIso = new Date().toISOString();

      if (session.questionLimit && nextIndex >= session.questionLimit) {
        await database
          .update(deepTalkSessions)
          .set({
            status: 'completed',
            skippedQuestionIdsJson: JSON.stringify(Array.from(skippedIds)),
            readyUserIdsJson: '[]',
            currentQuestionId: null,
            lastActivityAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(deepTalkSessions.id, sessionId));
      } else {
        if (nextIndex >= questionIds.length) {
          const pool =
            session.categoryId === 'random'
              ? await database.select().from(deepTalkQuestions).where(eq(deepTalkQuestions.isActive, 1))
              : await database
                  .select()
                  .from(deepTalkQuestions)
                  .where(
                    and(
                      eq(deepTalkQuestions.categoryId, session.categoryId),
                      eq(deepTalkQuestions.isActive, 1)
                    )
                  );
          const unaskedInCategory = pool.filter((q) => !questionIds.includes(q.id));
          let refillSource = unaskedInCategory;
          if (refillSource.length === 0) {
            const allActive = await database
              .select()
              .from(deepTalkQuestions)
              .where(eq(deepTalkQuestions.isActive, 1));
            const unaskedAnywhere = allActive.filter((q) => !questionIds.includes(q.id));
            refillSource = unaskedAnywhere.length > 0 ? unaskedAnywhere : pool;
          }
          questionIds = [...questionIds, ...pickShuffledQuestionIds(refillSource, 10)];
        }
        const nextQId = questionIds[nextIndex] || null;
        await database
          .update(deepTalkSessions)
          .set({
            questionIdsJson: JSON.stringify(questionIds),
            skippedQuestionIdsJson: JSON.stringify(Array.from(skippedIds)),
            currentQuestionIndex: nextIndex,
            currentQuestionId: nextQId,
            status: nextQId ? 'active' : 'completed',
            readyUserIdsJson: '[]',
            lastActivityAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(deepTalkSessions.id, sessionId));
      }

      const updated = (
        await database.select().from(deepTalkSessions).where(eq(deepTalkSessions.id, sessionId)).limit(1)
      )[0];
      await emitDeepTalkSync(database, updated, 'question_skipped', req.userId!);

      return res.json({
        session: await hydrateDeepTalkSession(database, updated, req.userId!),
      });
    } catch (error) {
      console.error('skip deep talk question error:', error);
      return res.status(500).json({ error: 'Failed to skip question.' });
    }
  });

  // Pause, resume, or end a Deep Talk session
  router.post('/deep-talk/sessions/:sessionId/status', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const sessionId = String(req.params.sessionId);
      const action = req.body?.action as 'pause' | 'resume' | 'end' | undefined;
      if (!action || !['pause', 'resume', 'end'].includes(action)) {
        return res.status(400).json({ error: 'Action must be pause, resume, or end.' });
      }

      const auth = await loadAuthorizedDeepTalkSession(database, sessionId, req.userId!);
      if (!auth.ok || !auth.session) {
        return res.status(auth.status).json({ error: auth.error });
      }
      const session = auth.session;

      const nowIso = new Date().toISOString();
      if (action === 'pause') {
        if (session.status !== 'active') {
          return res.status(400).json({ error: 'Only active sessions can be paused.' });
        }
        await database
          .update(deepTalkSessions)
          .set({
            status: 'paused',
            pausedByUserId: req.userId!,
            lastActivityAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(deepTalkSessions.id, sessionId));
      } else if (action === 'resume') {
        if (session.status !== 'paused') {
          return res.status(400).json({ error: 'Only paused sessions can be resumed.' });
        }
        await database
          .update(deepTalkSessions)
          .set({
            status: 'active',
            pausedByUserId: null,
            lastActivityAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(deepTalkSessions.id, sessionId));
      } else {
        if (session.status === 'ended' || session.status === 'declined' || session.status === 'completed') {
          return res.status(400).json({ error: 'Session is already closed.' });
        }
        await database
          .update(deepTalkSessions)
          .set({
            status: 'ended',
            endedByUserId: req.userId!,
            lastActivityAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(deepTalkSessions.id, sessionId));
      }

      const updated = (
        await database.select().from(deepTalkSessions).where(eq(deepTalkSessions.id, sessionId)).limit(1)
      )[0];

      await emitDeepTalkSync(database, updated, `session_${action}`, req.userId!);
      return res.json({
        session: await hydrateDeepTalkSession(database, updated, req.userId!),
      });
    } catch (error) {
      console.error('update deep talk session status error:', error);
      return res.status(500).json({ error: 'Failed to update session status.' });
    }
  });

  // Fetch today's Daily Connection Challenge & history
  router.get(
    '/conversations/:conversationId/daily-challenge',
    requireAuth,
    async (req: AuthedRequest, res) => {
      try {
        await ensureDatabaseSchema(database);
        await ensureConnectionGamesSeeded(database);

        const conversationId = String(req.params.conversationId);
        const access = await verifyPrivateConversationAccess(database, conversationId, req.userId!);
        if (!access.ok || !access.peerId || !access.privatePairKey) {
          return res.status(access.status).json({ error: access.error });
        }

        const timezone = await resolveConversationEffectiveTimezone(
          database,
          conversationId,
          req.userId!,
          access.peerId,
          typeof req.query.tz === 'string' ? req.query.tz : undefined
        );
        const now = new Date();
        const nowIso = now.toISOString();
        const todayDate = getCalendarDateInTimezone(now, timezone);

        const connectionStreak = await expireStaleDailyChallengesAndComputeStreak(
          database,
          conversationId,
          req.userId!,
          access.peerId,
          todayDate,
          nowIso
        );

        const todayRow = await ensureTodayChallengeAssignment(
          database,
          conversationId,
          access.privatePairKey,
          todayDate,
          timezone,
          nowIso
        );

        const todayChallenge = todayRow
          ? await hydrateDailyAssignment(database, todayRow, req.userId!, access.peerId, todayDate, nowIso)
          : null;

        const historyRows = await database
          .select()
          .from(dailyChallengeAssignments)
          .where(eq(dailyChallengeAssignments.conversationId, conversationId))
          .orderBy(desc(dailyChallengeAssignments.challengeDate))
          .limit(20);

        const history: DailyChallengeAssignment[] = [];
        for (const r of historyRows) {
          if (todayRow && r.id === todayRow.id) continue;
          const h = await hydrateDailyAssignment(
            database,
            r,
            req.userId!,
            access.peerId,
            todayDate,
            nowIso
          );
          if (h) history.push(h);
        }

        return res.json({
          timezone,
          todayDate,
          todayChallenge,
          history,
          connectionStreak,
        });
      } catch (error) {
        console.error('get daily challenge error:', error);
        return res.status(500).json({ error: 'Failed to load Daily Connection Challenge.' });
      }
    }
  );

  // Submit E2EE response to Daily Connection Challenge
  router.post(
    '/conversations/:conversationId/daily-challenge/respond',
    requireAuth,
    async (req: AuthedRequest, res) => {
      try {
        await ensureDatabaseSchema(database);
        await ensureConnectionGamesSeeded(database);

        const conversationId = String(req.params.conversationId);
        const access = await verifyPrivateConversationAccess(database, conversationId, req.userId!);
        if (!access.ok || !access.peerId || !access.privatePairKey) {
          return res.status(access.status).json({ error: access.error });
        }

        const assignmentId = typeof req.body?.assignmentId === 'string' ? req.body.assignmentId : '';
        const encCheck = isValidEncryptedPayload(req.body || {}, [req.userId!, access.peerId]);
        if (!assignmentId || !encCheck.valid) {
          return res
            .status(400)
            .json({ error: encCheck.error || 'assignmentId and encrypted payload are required.' });
        }

        const rows = await database
          .select()
          .from(dailyChallengeAssignments)
          .where(
            and(
              eq(dailyChallengeAssignments.id, assignmentId),
              eq(dailyChallengeAssignments.conversationId, conversationId)
            )
          )
          .limit(1);

        const assignment = rows[0];
        if (!assignment) {
          return res.status(404).json({ error: 'Daily challenge assignment not found.' });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const todayDate = getCalendarDateInTimezone(now, assignment.timezone);

        if (assignment.lifecycleStatus === 'skipped') {
          return res.status(400).json({ error: 'This daily challenge was skipped.' });
        }
        if (
          assignment.lifecycleStatus === 'expired' ||
          assignment.challengeDate < todayDate ||
          assignment.expiresAt <= nowIso
        ) {
          await database
            .update(dailyChallengeAssignments)
            .set({ lifecycleStatus: 'expired', updatedAt: nowIso })
            .where(eq(dailyChallengeAssignments.id, assignment.id));
          return res.status(400).json({ error: 'This daily challenge has expired.' });
        }
        if (assignment.lifecycleStatus === 'both_completed') {
          return res.status(409).json({ error: 'This challenge is already completed by both of you.' });
        }

        const duplicate = await database
          .select({ id: dailyChallengeResponses.id })
          .from(dailyChallengeResponses)
          .where(
            and(
              eq(dailyChallengeResponses.assignmentId, assignment.id),
              eq(dailyChallengeResponses.userId, req.userId!)
            )
          )
          .limit(1);

        if (duplicate.length > 0) {
          return res.status(409).json({ error: 'You already submitted today’s challenge response.' });
        }

        await database.insert(dailyChallengeResponses).values({
          id: crypto.randomUUID(),
          assignmentId: assignment.id,
          conversationId,
          userId: req.userId!,
          ciphertext: encCheck.ciphertext,
          iv: encCheck.iv,
          aad: encCheck.aad,
          recipientEnvelopesJson: JSON.stringify(encCheck.recipientEnvelopes),
          reactionsJson: '[]',
          submittedAt: nowIso,
        });

        const allResponses = await database
          .select()
          .from(dailyChallengeResponses)
          .where(eq(dailyChallengeResponses.assignmentId, assignment.id));

        const bothResponded =
          allResponses.some((r) => r.userId === req.userId) &&
          allResponses.some((r) => r.userId === access.peerId);

        let updatedStreak: DailyConnectionStreak = await expireStaleDailyChallengesAndComputeStreak(
          database,
          conversationId,
          req.userId!,
          access.peerId,
          todayDate,
          nowIso
        );

        let milestoneReached: number | null = null;
        if (bothResponded) {
          await database
            .update(dailyChallengeAssignments)
            .set({
              lifecycleStatus: 'both_completed',
              completedAt: nowIso,
              updatedAt: nowIso,
            })
            .where(eq(dailyChallengeAssignments.id, assignment.id));

          // Update Daily Connection Streak atomically
          const [a, b] = orderPair(req.userId!, access.peerId);
          const streakRows = await database
            .select()
            .from(dailyConnectionStreaks)
            .where(eq(dailyConnectionStreaks.conversationId, conversationId))
            .limit(1);
          const existingStreak = streakRows[0];

          let nextCurrent = 1;
          let nextLongest = existingStreak?.longestStreak || 0;
          let nextTotal = (existingStreak?.totalCompleted || 0) + 1;

          if (existingStreak?.lastCompletedDate) {
            const diff = getDayDifference(existingStreak.lastCompletedDate, assignment.challengeDate);
            if (diff === 0) {
              nextCurrent = existingStreak.currentStreak || 1;
              nextTotal = existingStreak.totalCompleted;
            } else if (diff === 1) {
              nextCurrent = (existingStreak.currentStreak || 0) + 1;
            } else {
              nextCurrent = 1;
            }
          }
          nextLongest = Math.max(nextLongest, nextCurrent);
          milestoneReached = (CONNECTION_STREAK_MILESTONES as readonly number[]).includes(nextCurrent)
            ? nextCurrent
            : null;

          if (existingStreak) {
            await database
              .update(dailyConnectionStreaks)
              .set({
                currentStreak: nextCurrent,
                longestStreak: nextLongest,
                totalCompleted: nextTotal,
                lastCompletedDate: assignment.challengeDate,
                lastCelebratedMilestone: milestoneReached || existingStreak.lastCelebratedMilestone,
                updatedAt: nowIso,
              })
              .where(eq(dailyConnectionStreaks.id, existingStreak.id));
          } else {
            await database.insert(dailyConnectionStreaks).values({
              id: crypto.randomUUID(),
              conversationId,
              userAId: a,
              userBId: b,
              currentStreak: nextCurrent,
              longestStreak: nextLongest,
              totalCompleted: nextTotal,
              lastCompletedDate: assignment.challengeDate,
              lastCelebratedMilestone: milestoneReached || 0,
              updatedAt: nowIso,
            });
          }

          updatedStreak = {
            currentStreak: nextCurrent,
            longestStreak: nextLongest,
            totalCompleted: nextTotal,
            lastCompletedDate: assignment.challengeDate,
            milestoneReached,
            nextMilestone: getNextConnectionMilestone(nextCurrent),
          };

          const me = await getPublicUserById(database, req.userId!, req.userId!);
          await sendConnectionNotification(database, {
            userId: access.peerId,
            type: 'daily_challenge_completed',
            actorId: req.userId!,
            entityId: assignment.id,
            title: 'Daily Challenge Completed Together!',
            body: `@${me?.username || 'Your friend'} completed today's challenge with you. Connection Streak: ${nextCurrent} day${nextCurrent === 1 ? '' : 's'}!`,
          });

          if (milestoneReached) {
            for (const uid of [req.userId!, access.peerId]) {
              await sendConnectionNotification(database, {
                userId: uid,
                type: 'connection_streak_milestone',
                actorId: uid === req.userId! ? access.peerId : req.userId!,
                entityId: `${conversationId}:milestone:${milestoneReached}:${assignment.challengeDate}`,
                title: `${milestoneReached}-Day Connection Streak!`,
                body: `You completed ${milestoneReached} consecutive Daily Connection Challenges together.`,
              });
            }
          }
        } else {
          const me = await getPublicUserById(database, req.userId!, req.userId!);
          await sendConnectionNotification(database, {
            userId: access.peerId,
            type: 'daily_challenge_ready',
            actorId: req.userId!,
            entityId: assignment.id,
            title: 'Daily Connection Challenge Waiting',
            body: `@${me?.username || 'Your friend'} completed today's Daily Connection Challenge.`,
          });
        }

        const refreshed = (
          await database
            .select()
            .from(dailyChallengeAssignments)
            .where(eq(dailyChallengeAssignments.id, assignment.id))
            .limit(1)
        )[0];

        await emitDailyChallengeSync(
          database,
          refreshed,
          req.userId!,
          access.peerId,
          updatedStreak,
          bothResponded ? 'both_completed' : 'response_submitted',
          req.userId!,
          todayDate,
          nowIso
        );

        return res.status(201).json({
          todayChallenge: await hydrateDailyAssignment(
            database,
            refreshed,
            req.userId!,
            access.peerId,
            todayDate,
            nowIso
          ),
          connectionStreak: updatedStreak,
        });
      } catch (error) {
        console.error('submit daily challenge response error:', error);
        return res.status(500).json({ error: 'Failed to submit Daily Challenge response.' });
      }
    }
  );

  // Skip today's Daily Challenge without pressure
  router.post(
    '/conversations/:conversationId/daily-challenge/skip',
    requireAuth,
    async (req: AuthedRequest, res) => {
      try {
        await ensureDatabaseSchema(database);
        const conversationId = String(req.params.conversationId);
        const access = await verifyPrivateConversationAccess(database, conversationId, req.userId!);
        if (!access.ok || !access.peerId) {
          return res.status(access.status).json({ error: access.error });
        }

        const assignmentId = typeof req.body?.assignmentId === 'string' ? req.body.assignmentId : '';
        if (!assignmentId) {
          return res.status(400).json({ error: 'assignmentId is required.' });
        }

        const rows = await database
          .select()
          .from(dailyChallengeAssignments)
          .where(
            and(
              eq(dailyChallengeAssignments.id, assignmentId),
              eq(dailyChallengeAssignments.conversationId, conversationId)
            )
          )
          .limit(1);
        const assignment = rows[0];
        if (!assignment) {
          return res.status(404).json({ error: 'Challenge assignment not found.' });
        }
        if (assignment.lifecycleStatus === 'both_completed') {
          return res.status(400).json({ error: 'Cannot skip an already completed challenge.' });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const todayDate = getCalendarDateInTimezone(now, assignment.timezone);

        await database
          .update(dailyChallengeAssignments)
          .set({
            lifecycleStatus: 'skipped',
            skippedByUserId: req.userId!,
            updatedAt: nowIso,
          })
          .where(eq(dailyChallengeAssignments.id, assignment.id));

        const refreshed = (
          await database
            .select()
            .from(dailyChallengeAssignments)
            .where(eq(dailyChallengeAssignments.id, assignment.id))
            .limit(1)
        )[0];

        const streak = await expireStaleDailyChallengesAndComputeStreak(
          database,
          conversationId,
          req.userId!,
          access.peerId,
          todayDate,
          nowIso
        );

        await emitDailyChallengeSync(
          database,
          refreshed,
          req.userId!,
          access.peerId,
          streak,
          'challenge_skipped',
          req.userId!,
          todayDate,
          nowIso
        );

        return res.json({
          todayChallenge: await hydrateDailyAssignment(
            database,
            refreshed,
            req.userId!,
            access.peerId,
            todayDate,
            nowIso
          ),
          connectionStreak: streak,
        });
      } catch (error) {
        console.error('skip daily challenge error:', error);
        return res.status(500).json({ error: 'Failed to skip daily challenge.' });
      }
    }
  );

  // React to a revealed Daily Challenge response
  router.post(
    '/conversations/:conversationId/daily-challenge/react',
    requireAuth,
    async (req: AuthedRequest, res) => {
      try {
        await ensureDatabaseSchema(database);
        const conversationId = String(req.params.conversationId);
        const access = await verifyPrivateConversationAccess(database, conversationId, req.userId!);
        if (!access.ok || !access.peerId) {
          return res.status(access.status).json({ error: access.error });
        }

        const responseId = typeof req.body?.responseId === 'string' ? req.body.responseId : '';
        const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 16) : '';
        if (!responseId || !emoji) {
          return res.status(400).json({ error: 'responseId and emoji are required.' });
        }

        const respRows = await database
          .select()
          .from(dailyChallengeResponses)
          .where(
            and(
              eq(dailyChallengeResponses.id, responseId),
              eq(dailyChallengeResponses.conversationId, conversationId)
            )
          )
          .limit(1);
        const respRow = respRows[0];
        if (!respRow) {
          return res.status(404).json({ error: 'Response not found.' });
        }

        const assignRows = await database
          .select()
          .from(dailyChallengeAssignments)
          .where(eq(dailyChallengeAssignments.id, respRow.assignmentId))
          .limit(1);
        const assignment = assignRows[0];
        if (!assignment || assignment.lifecycleStatus !== 'both_completed') {
          return res.status(400).json({ error: 'Can only react once both participants complete the challenge.' });
        }

        const reactions = safeJsonParse<ConnectionGameReaction[]>(respRow.reactionsJson, []);
        const existingIdx = reactions.findIndex((r) => r.userId === req.userId && r.emoji === emoji);
        if (existingIdx >= 0) {
          reactions.splice(existingIdx, 1);
        } else {
          reactions.push({ userId: req.userId!, emoji, createdAt: new Date().toISOString() });
        }

        await database
          .update(dailyChallengeResponses)
          .set({ reactionsJson: JSON.stringify(reactions) })
          .where(eq(dailyChallengeResponses.id, responseId));

        const now = new Date();
        const nowIso = now.toISOString();
        const todayDate = getCalendarDateInTimezone(now, assignment.timezone);
        const streak = await expireStaleDailyChallengesAndComputeStreak(
          database,
          conversationId,
          req.userId!,
          access.peerId,
          todayDate,
          nowIso
        );

        await emitDailyChallengeSync(
          database,
          assignment,
          req.userId!,
          access.peerId,
          streak,
          'challenge_reacted',
          req.userId!,
          todayDate,
          nowIso
        );

        return res.json({
          todayChallenge: await hydrateDailyAssignment(
            database,
            assignment,
            req.userId!,
            access.peerId,
            todayDate,
            nowIso
          ),
        });
      } catch (error) {
        console.error('react daily challenge error:', error);
        return res.status(500).json({ error: 'Failed to react to challenge response.' });
      }
    }
  );

  // Update current user's preferred IANA timezone for scheduled daily challenges
  router.put('/timezone', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const rawTz = typeof req.body?.timezone === 'string' ? req.body.timezone : '';
      const validTz = isValidIanaTimezone(rawTz);
      if (!validTz) {
        return res.status(400).json({ error: 'A valid IANA timezone identifier is required.' });
      }
      await database
        .update(users)
        .set({ timezone: validTz })
        .where(eq(users.id, req.userId!));

      return res.json({ timezone: validTz });
    } catch (error) {
      console.error('update user timezone error:', error);
      return res.status(500).json({ error: 'Failed to update timezone.' });
    }
  });

  return router;
}

export interface DailySchedulerSummary {
  processedPairs: number;
  assignedCount: number;
  skippedAlreadyAssigned: number;
  expiredCount: number;
  errors: number;
  ranAt: string;
}

export interface DailyChallengeSchedulerHandle {
  stop: () => void;
  runNow: (now?: Date) => Promise<DailySchedulerSummary>;
  isRunning: () => boolean;
}

/**
 * Automatically assigns a new Daily Connection Challenge to every active pair
 * of friends whenever a new 24-hour calendar day starts in the pair's timezone.
 */
export async function runDailyChallengeScheduler(
  database: PgDatabase,
  options?: {
    now?: Date;
    activeWithinDays?: number;
    notify?: boolean;
    conversationIds?: string[];
  }
): Promise<DailySchedulerSummary> {
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const activeWithinDays = Math.max(1, options?.activeWithinDays ?? 30);
  const cutoffIso = new Date(now.getTime() - activeWithinDays * 86_400_000).toISOString();
  const notify = options?.notify ?? true;

  const summary: DailySchedulerSummary = {
    processedPairs: 0,
    assignedCount: 0,
    skippedAlreadyAssigned: 0,
    expiredCount: 0,
    errors: 0,
    ranAt: nowIso,
  };

  await ensureDatabaseSchema(database);
  await ensureConnectionGamesSeeded(database);

  const convWhere =
    options?.conversationIds && options.conversationIds.length > 0
      ? and(eq(conversations.type, 'private'), inArray(conversations.id, options.conversationIds))
      : eq(conversations.type, 'private');

  const privateConvs = await database
    .select({
      id: conversations.id,
      privatePairKey: conversations.privatePairKey,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(convWhere);

  if (privateConvs.length === 0) {
    return summary;
  }

  const convIds = privateConvs.map((c) => c.id);

  const [participantRows, friendshipRows, blockRows, assignmentRows, deepTalkRows] =
    await Promise.all([
      database
        .select({
          conversationId: conversationParticipants.conversationId,
          userId: conversationParticipants.userId,
        })
        .from(conversationParticipants)
        .where(inArray(conversationParticipants.conversationId, convIds)),
      database
        .select({
          userAId: friendships.userAId,
          userBId: friendships.userBId,
        })
        .from(friendships),
      database
        .select({
          blockerId: userBlocks.blockerId,
          blockedId: userBlocks.blockedId,
        })
        .from(userBlocks),
      database
        .select()
        .from(dailyChallengeAssignments)
        .where(inArray(dailyChallengeAssignments.conversationId, convIds))
        .orderBy(desc(dailyChallengeAssignments.challengeDate)),
      database
        .select({ conversationId: deepTalkSessions.conversationId })
        .from(deepTalkSessions)
        .where(inArray(deepTalkSessions.conversationId, convIds)),
    ]);

  const participantsByConv = new Map<string, string[]>();
  const allUserIds = new Set<string>();
  for (const row of participantRows) {
    const arr = participantsByConv.get(row.conversationId) || [];
    if (!arr.includes(row.userId)) {
      arr.push(row.userId);
      participantsByConv.set(row.conversationId, arr);
    }
    allUserIds.add(row.userId);
  }

  const userRows =
    allUserIds.size > 0
      ? await database
          .select({
            id: users.id,
            timezone: users.timezone,
            lastSeenAt: users.lastSeenAt,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          })
          .from(users)
          .where(inArray(users.id, Array.from(allUserIds)))
      : [];
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  const friendshipSet = new Set<string>();
  for (const f of friendshipRows) {
    const [a, b] = orderPair(f.userAId, f.userBId);
    friendshipSet.add(`${a}:${b}`);
  }

  const blockedSet = new Set<string>();
  for (const blk of blockRows) {
    const [a, b] = orderPair(blk.blockerId, blk.blockedId);
    blockedSet.add(`${a}:${b}`);
  }

  const latestAssignmentByConv = new Map<string, typeof dailyChallengeAssignments.$inferSelect>();
  const assignmentDatesByConv = new Map<string, Set<string>>();
  for (const aRow of assignmentRows) {
    if (!latestAssignmentByConv.has(aRow.conversationId)) {
      latestAssignmentByConv.set(aRow.conversationId, aRow);
    }
    const dateSet = assignmentDatesByConv.get(aRow.conversationId) || new Set<string>();
    dateSet.add(aRow.challengeDate);
    assignmentDatesByConv.set(aRow.conversationId, dateSet);
  }

  const deepTalkConvSet = new Set(deepTalkRows.map((r) => r.conversationId));

  for (const conv of privateConvs) {
    const members = participantsByConv.get(conv.id) || [];
    if (members.length !== 2) continue;

    const [a, b] = orderPair(members[0], members[1]);
    const pairKey = conv.privatePairKey || `${a}:${b}`;
    if (blockedSet.has(`${a}:${b}`)) continue;

    const userA = userMap.get(a);
    const userB = userMap.get(b);
    if (!userA || !userB) continue;

    const isFriend = friendshipSet.has(`${a}:${b}`);
    const hasGameOrChatHistory =
      Boolean(conv.lastMessageAt) ||
      assignmentDatesByConv.has(conv.id) ||
      deepTalkConvSet.has(conv.id);

    if (!isFriend && !hasGameOrChatHistory) {
      continue;
    }

    const userALastActive = userA.lastSeenAt || userA.updatedAt || userA.createdAt;
    const userBLastActive = userB.lastSeenAt || userB.updatedAt || userB.createdAt;
    const convLastActive = conv.lastMessageAt || conv.updatedAt || conv.createdAt;
    const isRecentlyActive =
      userALastActive >= cutoffIso || userBLastActive >= cutoffIso || convLastActive >= cutoffIso;
    if (!isRecentlyActive) {
      continue;
    }

    summary.processedPairs += 1;

    try {
      const latestAssignment = latestAssignmentByConv.get(conv.id);
      const pairTimezone = resolvePairTimezone(userA, userB, latestAssignment?.timezone);
      const todayDate = getCalendarDateInTimezone(now, pairTimezone);

      const { streak, expiredCount } = await expireStaleDailyChallengesAndComputeStreakWithMeta(
        database,
        conv.id,
        a,
        b,
        todayDate,
        nowIso
      );
      summary.expiredCount += expiredCount;

      const existingDates = assignmentDatesByConv.get(conv.id);
      if (
        existingDates?.has(todayDate) ||
        (latestAssignment && latestAssignment.challengeDate >= todayDate)
      ) {
        summary.skippedAlreadyAssigned += 1;
        continue;
      }

      const { assignment, created } = await ensureTodayChallengeAssignmentWithMeta(
        database,
        conv.id,
        pairKey,
        todayDate,
        pairTimezone,
        nowIso
      );

      if (!assignment || !created) {
        summary.skippedAlreadyAssigned += 1;
        continue;
      }

      summary.assignedCount += 1;

      await emitDailyChallengeSync(
        database,
        assignment,
        a,
        b,
        streak,
        'daily_challenge_assigned',
        'system',
        todayDate,
        nowIso
      );

      if (notify) {
        for (const [recipientId, peerId] of [
          [a, b],
          [b, a],
        ] as const) {
          const peerUser = await getPublicUserById(database, peerId, recipientId);
          await sendConnectionNotification(database, {
            userId: recipientId,
            type: 'daily_challenge_assigned',
            actorId: peerId,
            entityId: assignment.id,
            title: "Today's Daily Connection Challenge",
            body: `A new shared Daily Connection Challenge with ${peerUser?.displayName || 'your friend'} is ready.`,
          });
        }
      }
    } catch (err) {
      summary.errors += 1;
      if (!isTransientSqlDisconnect(err)) {
        console.error(`Daily challenge scheduler failed for pair ${pairKey}:`, err);
      }
    }
  }

  return summary;
}

/**
 * Starts the background Daily Connection Challenge scheduler.
 * Defaults to checking every 15 minutes so active friend pairs across all
 * global timezones (including :15/:30/:45 offsets) receive their new challenge
 * right after midnight in their local timezone (once every 24 hours).
 */
export function startDailyChallengeScheduler(
  database: PgDatabase,
  options?: {
    intervalMs?: number;
    initialDelayMs?: number;
    activeWithinDays?: number;
    notify?: boolean;
  }
): DailyChallengeSchedulerHandle {
  const intervalMs = Math.max(1_000, options?.intervalMs ?? 15 * 60 * 1000);
  const initialDelayMs = Math.max(0, options?.initialDelayMs ?? 5_000);
  let inFlight = false;
  let stopped = false;

  const executeSweep = async (now?: Date): Promise<DailySchedulerSummary> => {
    if (inFlight) {
      return {
        processedPairs: 0,
        assignedCount: 0,
        skippedAlreadyAssigned: 0,
        expiredCount: 0,
        errors: 0,
        ranAt: (now ?? new Date()).toISOString(),
      };
    }
    inFlight = true;
    try {
      return await runDailyChallengeScheduler(database, {
        now,
        activeWithinDays: options?.activeWithinDays,
        notify: options?.notify,
      });
    } finally {
      inFlight = false;
    }
  };

  const initialTimer = setTimeout(() => {
    if (stopped) return;
    executeSweep().catch((err) => {
      if (!isTransientSqlDisconnect(err)) {
        console.error('Daily Connection Challenge initial scheduler error:', err);
      }
    });
  }, initialDelayMs);
  initialTimer.unref();

  const intervalTimer = setInterval(() => {
    if (stopped) return;
    executeSweep().catch((err) => {
      if (!isTransientSqlDisconnect(err)) {
        console.error('Daily Connection Challenge scheduler error:', err);
      }
    });
  }, intervalMs);
  intervalTimer.unref();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    },
    runNow: (now?: Date) => executeSweep(now),
    isRunning: () => inFlight,
  };
}

