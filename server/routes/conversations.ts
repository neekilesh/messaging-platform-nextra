import crypto from 'node:crypto';
import { Router } from 'express';
import { and, asc, count, desc, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import {
  conversationParticipants,
  conversations,
  friendships,
  groupEncryptionStates,
  groupMembers,
  groups,
  identityKeys,
  messageAttachments,
  messageReactions,
  messageReceipts,
  messages,
  privacySettings,
  users,
} from '../../src/db/schema.ts';
import { createRequireAuth, getIO, getPublicUserById, isBlockedBetween } from '../context.ts';
import type { AuthedRequest } from '../context.ts';
import { getStreakInfo, recordStreakActivity } from '../streaks.ts';
import type {
  MessageReactionItem,
  MessageRecord,
  MessageStatus,
  RecipientEnvelope,
  SignedEncryptedReadReceipt,
} from '../../src/types/nexora.ts';

async function verifyEcdsaReadReceiptSignature(
  ecdsaPublicJwkStr: string,
  conversationId: string,
  messageId: string,
  readerId: string,
  viewedAt: string,
  signatureB64: string
): Promise<boolean> {
  try {
    const jwk = JSON.parse(ecdsaPublicJwkStr) as JsonWebKey;
    const key = await crypto.webcrypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const canonical = `nexora:read-receipt:v1:${conversationId}:${messageId}:${readerId}:${viewedAt}`;
    const sigBytes = Buffer.from(signatureB64, 'base64');
    return await crypto.webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sigBytes,
      new TextEncoder().encode(canonical)
    );
  } catch {
    return false;
  }
}

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const ALLOWED_DISAPPEARING = new Set([0, 10, 60, 3600, 86400, 604800, 2592000]);

type MessageDbRow = typeof messages.$inferSelect;

export async function hydrateMessageRow(
  database: PgDatabase,
  row: MessageDbRow,
  requesterId: string
): Promise<MessageRecord> {
  const senderRows = await database
    .select({
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, row.senderId))
    .limit(1);
  const sender = senderRows[0];

  let status: MessageStatus = 'sent';
  const receipts = await database
    .select({
      userId: messageReceipts.userId,
      status: messageReceipts.status,
      signature: messageReceipts.signature,
      signedAt: messageReceipts.signedAt,
      encryptedPayloadJson: messageReceipts.encryptedPayloadJson,
      updatedAt: messageReceipts.updatedAt,
    })
    .from(messageReceipts)
    .where(and(eq(messageReceipts.messageId, row.id), ne(messageReceipts.userId, row.senderId)));

  if (receipts.some((r) => r.status === 'read')) {
    status = 'read';
  } else if (receipts.some((r) => r.status === 'delivered')) {
    status = 'delivered';
  }

  const readReceipts: SignedEncryptedReadReceipt[] = receipts
    .filter((r) => r.status === 'read' && r.signature)
    .map((r) => {
      let encPayload: {
        ciphertext?: string | null;
        iv?: string | null;
        aad?: string | null;
        recipientEnvelopes?: Record<string, RecipientEnvelope> | null;
        epoch?: number | null;
      } = {};
      if (r.encryptedPayloadJson) {
        try {
          encPayload = JSON.parse(r.encryptedPayloadJson);
        } catch {
          encPayload = {};
        }
      }
      const filteredEnvelopes =
        encPayload.recipientEnvelopes && encPayload.recipientEnvelopes[requesterId]
          ? { [requesterId]: encPayload.recipientEnvelopes[requesterId] }
          : encPayload.recipientEnvelopes || null;

      return {
        messageId: row.id,
        readerId: r.userId,
        viewedAt: r.signedAt || r.updatedAt,
        signature: r.signature!,
        ciphertext: encPayload.ciphertext || null,
        iv: encPayload.iv || null,
        aad: encPayload.aad || null,
        recipientEnvelopes: filteredEnvelopes,
        epoch: typeof encPayload.epoch === 'number' ? encPayload.epoch : null,
      };
    });

  const reactionRows = await database
    .select({
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
    })
    .from(messageReactions)
    .where(eq(messageReactions.messageId, row.id));

  const reactionMap = new Map<string, string[]>();
  for (const r of reactionRows) {
    const list = reactionMap.get(r.emoji) || [];
    list.push(r.userId);
    reactionMap.set(r.emoji, list);
  }
  const reactions: MessageReactionItem[] = Array.from(reactionMap.entries()).map(
    ([emoji, userIds]) => ({
      emoji,
      userIds,
      count: userIds.length,
    })
  );

  let parsedEnvelopes: Record<
    string,
    { ephemeralPublicJwk: string; wrappedKey: string; iv: string }
  > | null = null;
  if (row.recipientEnvelopesJson) {
    try {
      const full = JSON.parse(row.recipientEnvelopesJson) as Record<
        string,
        { ephemeralPublicJwk: string; wrappedKey: string; iv: string }
      >;
      if (full[requesterId]) {
        parsedEnvelopes = { [requesterId]: full[requesterId] };
      } else {
        parsedEnvelopes = full;
      }
    } catch {
      parsedEnvelopes = null;
    }
  }

  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    senderUsername: sender?.username || 'unknown',
    senderDisplayName: sender?.displayName || 'Unknown',
    senderAvatarUrl: sender?.avatarUrl || null,
    replyToId: row.replyToId,
    forwardedFromId: row.forwardedFromId,
    kind: row.kind as MessageRecord['kind'],
    ciphertext: row.deletedForEveryone ? '' : row.ciphertext,
    iv: row.deletedForEveryone ? '' : row.iv,
    aad: row.aad,
    recipientEnvelopes: row.deletedForEveryone ? null : parsedEnvelopes,
    epoch: row.epoch,
    attachmentId: row.deletedForEveryone ? null : row.attachmentId,
    isPinned: row.isPinned === 1,
    isEdited: row.isEdited === 1,
    deletedForEveryone: row.deletedForEveryone === 1,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status,
    reactions,
    ...(readReceipts.length > 0 ? { readReceipts } : {}),
  };
}

export function createConversationsRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  router.get('/', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const nowIso = new Date().toISOString();
      const rows = await database
        .select({
          id: conversations.id,
          type: conversations.type,
          groupId: conversations.groupId,
          disappearingSeconds: conversations.disappearingSeconds,
          lastMessageAt: conversations.lastMessageAt,
          muted: conversationParticipants.muted,
          archived: conversationParticipants.archived,
          unreadCount: conversationParticipants.unreadCount,
          groupName: groups.name,
          groupDesc: groups.description,
          groupAvatar: groups.avatarUrl,
          maxMembers: groups.maxMembers,
          currentEpoch: groups.currentEpoch,
        })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
        .leftJoin(groups, eq(groups.id, conversations.groupId))
        .where(eq(conversationParticipants.userId, req.userId!))
        .orderBy(desc(sql`COALESCE(${conversations.lastMessageAt}, ${conversations.createdAt})`));

      const result = [];
      for (const row of rows) {
        let title = row.groupName || 'Conversation';
        let subtitle = '';
        let avatarUrl = row.groupAvatar || null;
        let peerUser = null;
        let streak = null;
        let groupMemberCount: number | null = null;
        let myEpochEnvelopes = undefined;

        if (row.type === 'private') {
          const otherRows = await database
            .select({ userId: conversationParticipants.userId })
            .from(conversationParticipants)
            .where(
              and(
                eq(conversationParticipants.conversationId, row.id),
                ne(conversationParticipants.userId, req.userId!)
              )
            )
            .limit(1);
          const other = otherRows[0];
          if (!other) continue;
          if (await isBlockedBetween(database, req.userId!, other.userId)) continue;
          peerUser = await getPublicUserById(database, other.userId, req.userId!);
          if (!peerUser) continue;
          title = peerUser.displayName;
          subtitle = `@${peerUser.username}`;
          avatarUrl = peerUser.avatarUrl;
          streak = await getStreakInfo(database, req.userId!, other.userId);
        } else if (row.groupId) {
          const countRows = await database
            .select({ cnt: count() })
            .from(groupMembers)
            .where(eq(groupMembers.groupId, row.groupId));
          groupMemberCount = Number(countRows[0]?.cnt || 0);
          subtitle = `${groupMemberCount}/${row.maxMembers || 25} members`;

          const envRows = await database
            .select({
              epoch: groupEncryptionStates.epoch,
              senderUserId: groupEncryptionStates.senderUserId,
              ephemeralPublicJwk: groupEncryptionStates.ephemeralPublicJwk,
              wrappedEpochKey: groupEncryptionStates.wrappedEpochKey,
              iv: groupEncryptionStates.iv,
            })
            .from(groupEncryptionStates)
            .where(
              and(
                eq(groupEncryptionStates.groupId, row.groupId),
                eq(groupEncryptionStates.userId, req.userId!)
              )
            )
            .orderBy(asc(groupEncryptionStates.epoch));
          myEpochEnvelopes = envRows;
        }

        const lastMsgRows = await database
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, row.id),
              or(isNull(messages.expiresAt), gt(messages.expiresAt, nowIso))
            )
          )
          .orderBy(desc(messages.createdAt))
          .limit(1);

        const lastMessage = lastMsgRows[0]
          ? await hydrateMessageRow(database, lastMsgRows[0], req.userId!)
          : null;

        result.push({
          id: row.id,
          type: row.type as 'private' | 'group',
          title,
          subtitle,
          avatarUrl,
          peerUser,
          groupId: row.groupId,
          groupMemberCount,
          groupMaxMembers: row.maxMembers,
          currentEpoch: row.currentEpoch,
          disappearingSeconds: row.disappearingSeconds,
          muted: row.muted === 1,
          archived: row.archived === 1,
          unreadCount: row.unreadCount,
          streak,
          lastMessage,
          lastMessageAt: row.lastMessageAt,
          ...(myEpochEnvelopes ? { myEpochEnvelopes } : {}),
        });
      }

      return res.json({ conversations: result });
    } catch (error) {
      console.error('list conversations error:', error);
      return res.status(500).json({ error: 'Failed to load conversations.' });
    }
  });

  router.post('/private', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const peerId = typeof req.body?.userId === 'string' ? req.body.userId : '';
      if (!peerId || peerId === req.userId) {
        return res.status(400).json({ error: 'Valid recipient userId is required.' });
      }

      const peerExists = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, peerId))
        .limit(1);
      if (peerExists.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      if (await isBlockedBetween(database, req.userId!, peerId)) {
        return res.status(403).json({ error: 'Messaging is unavailable with this user.' });
      }

      const [a, b] = orderPair(req.userId!, peerId);
      const pairKey = `${a}:${b}`;

      const existingRows = await database
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.privatePairKey, pairKey))
        .limit(1);

      if (existingRows[0]) {
        return res.json({ conversationId: existingRows[0].id, created: false });
      }

      const isFriend = await database
        .select({ id: friendships.id })
        .from(friendships)
        .where(and(eq(friendships.userAId, a), eq(friendships.userBId, b)))
        .limit(1);

      if (isFriend.length === 0) {
        const privacyRows = await database
          .select({ allowChatRequests: privacySettings.allowChatRequests })
          .from(privacySettings)
          .where(eq(privacySettings.userId, peerId))
          .limit(1);
        if (privacyRows[0] && privacyRows[0].allowChatRequests === 0) {
          return res.status(403).json({ error: 'Connect as friends first to message this user.' });
        }
      }

      const convId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      await database.transaction(async (tx) => {
        await tx.insert(conversations).values({
          id: convId,
          type: 'private',
          groupId: null,
          privatePairKey: pairKey,
          disappearingSeconds: 0,
          lastMessageAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await tx.insert(conversationParticipants).values([
          {
            id: crypto.randomUUID(),
            conversationId: convId,
            userId: req.userId!,
            joinedAt: nowIso,
          },
          {
            id: crypto.randomUUID(),
            conversationId: convId,
            userId: peerId,
            joinedAt: nowIso,
          },
        ]);
      });

      const io = getIO();
      if (io) {
        io.in(`user:${req.userId!}`).socketsJoin(`conv:${convId}`);
        io.in(`user:${peerId}`).socketsJoin(`conv:${convId}`);
        io.to(`user:${peerId}`).emit('conversation:new', { conversationId: convId });
      }

      return res.status(201).json({ conversationId: convId, created: true });
    } catch (error) {
      console.error('create private conversation error:', error);
      return res.status(500).json({ error: 'Failed to start conversation.' });
    }
  });

  router.patch('/:id/settings', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const convId = String(req.params.id);
      const participant = await database
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, convId),
            eq(conversationParticipants.userId, req.userId!)
          )
        )
        .limit(1);
      if (participant.length === 0) {
        return res.status(403).json({ error: 'Not a participant in this conversation.' });
      }

      const body = req.body || {};
      const nowIso = new Date().toISOString();

      if (typeof body.muted === 'boolean') {
        await database
          .update(conversationParticipants)
          .set({ muted: body.muted ? 1 : 0 })
          .where(
            and(
              eq(conversationParticipants.conversationId, convId),
              eq(conversationParticipants.userId, req.userId!)
            )
          );
      }

      if (typeof body.archived === 'boolean') {
        await database
          .update(conversationParticipants)
          .set({ archived: body.archived ? 1 : 0 })
          .where(
            and(
              eq(conversationParticipants.conversationId, convId),
              eq(conversationParticipants.userId, req.userId!)
            )
          );
      }

      if (typeof body.disappearingSeconds === 'number') {
        if (!ALLOWED_DISAPPEARING.has(body.disappearingSeconds)) {
          return res.status(400).json({ error: 'Unsupported disappearing message interval.' });
        }
        await database
          .update(conversations)
          .set({ disappearingSeconds: body.disappearingSeconds, updatedAt: nowIso })
          .where(eq(conversations.id, convId));
        getIO()?.to(`conv:${convId}`).emit('conversation:updated', {
          conversationId: convId,
          disappearingSeconds: body.disappearingSeconds,
        });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('conversation settings error:', error);
      return res.status(500).json({ error: 'Failed to update conversation settings.' });
    }
  });

  router.get('/:id/messages', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const convId = String(req.params.id);
      const participant = await database
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, convId),
            eq(conversationParticipants.userId, req.userId!)
          )
        )
        .limit(1);
      if (participant.length === 0) {
        return res.status(403).json({ error: 'Access denied to this conversation.' });
      }

      const limit = Math.min(100, Math.max(10, Number(req.query.limit || 40)));
      const before = typeof req.query.before === 'string' ? req.query.before : null;
      const nowIso = new Date().toISOString();

      const rows = before
        ? await database
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, convId),
                or(isNull(messages.expiresAt), gt(messages.expiresAt, nowIso)),
                lt(messages.createdAt, before)
              )
            )
            .orderBy(desc(messages.createdAt))
            .limit(limit + 1)
        : await database
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, convId),
                or(isNull(messages.expiresAt), gt(messages.expiresAt, nowIso))
              )
            )
            .orderBy(desc(messages.createdAt))
            .limit(limit + 1);

      const hasMore = rows.length > limit;
      const sliced = rows.slice(0, limit).reverse();

      const result = [];
      for (const r of sliced) {
        try {
          const deletedFor = JSON.parse(r.deletedForUsersJson || '[]') as string[];
          if (deletedFor.includes(req.userId!)) continue;
        } catch {
          // keep message if parse fails
        }
        result.push(await hydrateMessageRow(database, r, req.userId!));
      }

      return res.json({ messages: result, hasMore });
    } catch (error) {
      console.error('list messages error:', error);
      return res.status(500).json({ error: 'Failed to load messages.' });
    }
  });

  router.post('/:id/messages', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const convId = String(req.params.id);
      const participant = await database
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, convId),
            eq(conversationParticipants.userId, req.userId!)
          )
        )
        .limit(1);
      if (participant.length === 0) {
        return res.status(403).json({ error: 'Not a participant in this conversation.' });
      }

      const convRows = await database
        .select({
          id: conversations.id,
          type: conversations.type,
          groupId: conversations.groupId,
          disappearingSeconds: conversations.disappearingSeconds,
        })
        .from(conversations)
        .where(eq(conversations.id, convId))
        .limit(1);
      const conv = convRows[0];
      if (!conv) {
        return res.status(404).json({ error: 'Conversation not found.' });
      }

      const body = req.body || {};
      const messageId =
        typeof body.id === 'string' && body.id.length <= 64 ? body.id : crypto.randomUUID();
      const kind = ['text', 'image', 'video', 'voice', 'file', 'system'].includes(body.kind)
        ? body.kind
        : 'text';
      const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : '';
      const iv = typeof body.iv === 'string' ? body.iv : '';
      const aad = typeof body.aad === 'string' ? body.aad : '';
      const recipientEnvelopes = body.recipientEnvelopes
        ? JSON.stringify(body.recipientEnvelopes)
        : null;
      const epoch = typeof body.epoch === 'number' ? body.epoch : null;
      const replyToId = typeof body.replyToId === 'string' ? body.replyToId : null;
      const forwardedFromId = typeof body.forwardedFromId === 'string' ? body.forwardedFromId : null;
      const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : null;

      if (!ciphertext || !iv) {
        return res.status(400).json({ error: 'Encrypted ciphertext and IV are required.' });
      }

      if (conv.type === 'private') {
        const otherRows = await database
          .select({ userId: conversationParticipants.userId })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, convId),
              ne(conversationParticipants.userId, req.userId!)
            )
          )
          .limit(1);
        const other = otherRows[0];
        if (other && (await isBlockedBetween(database, req.userId!, other.userId))) {
          return res.status(403).json({ error: 'Cannot message a blocked user.' });
        }
      }

      const existingRows = await database
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (existingRows[0]) {
        return res
          .status(200)
          .json({ message: await hydrateMessageRow(database, existingRows[0], req.userId!) });
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const expiresAt =
        conv.disappearingSeconds > 0
          ? new Date(nowMs + conv.disappearingSeconds * 1000).toISOString()
          : null;

      await database.transaction(async (tx) => {
        await tx.insert(messages).values({
          id: messageId,
          conversationId: convId,
          senderId: req.userId!,
          replyToId,
          forwardedFromId,
          kind,
          ciphertext,
          iv,
          aad,
          recipientEnvelopesJson: recipientEnvelopes,
          epoch,
          attachmentId,
          isPinned: 0,
          isEdited: 0,
          deletedForEveryone: 0,
          deletedForUsersJson: '[]',
          expiresAt,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await tx
          .update(conversations)
          .set({ lastMessageAt: nowIso, updatedAt: nowIso })
          .where(eq(conversations.id, convId));

        await tx
          .update(conversationParticipants)
          .set({ unreadCount: sql`${conversationParticipants.unreadCount} + 1` })
          .where(
            and(
              eq(conversationParticipants.conversationId, convId),
              ne(conversationParticipants.userId, req.userId!)
            )
          );

        if (attachmentId && expiresAt) {
          await tx
            .update(messageAttachments)
            .set({ expiresAt })
            .where(eq(messageAttachments.id, attachmentId));
        }
      });

      let updatedStreak = null;
      if (conv.type === 'private' && kind !== 'system') {
        const otherRows = await database
          .select({ userId: conversationParticipants.userId })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, convId),
              ne(conversationParticipants.userId, req.userId!)
            )
          )
          .limit(1);
        if (otherRows[0]) {
          updatedStreak = await recordStreakActivity(database, req.userId!, otherRows[0].userId, nowMs);
        }
      }

      const rowList = await database
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      const row = rowList[0];
      const participants = await database
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, convId));

      const io = getIO();
      if (io && row) {
        for (const p of participants) {
          const personalized = await hydrateMessageRow(database, row, p.userId);
          io.to(`user:${p.userId}`).emit('message:new', {
            conversationId: convId,
            message: personalized,
            streak: updatedStreak,
          });
        }
      }

      return res.status(201).json({
        message: await hydrateMessageRow(database, row, req.userId!),
        streak: updatedStreak,
      });
    } catch (error) {
      console.error('send message error:', error);
      return res.status(500).json({ error: 'Failed to send message.' });
    }
  });

  router.post('/:id/read', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const convId = String(req.params.id);
      const participant = await database
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, convId),
            eq(conversationParticipants.userId, req.userId!)
          )
        )
        .limit(1);
      if (participant.length === 0) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const nowIso = new Date().toISOString();
      await database
        .update(conversationParticipants)
        .set({ unreadCount: 0, lastReadAt: nowIso })
        .where(
          and(
            eq(conversationParticipants.conversationId, convId),
            eq(conversationParticipants.userId, req.userId!)
          )
        );

      const privacyRows = await database
        .select({ showReadReceipts: privacySettings.showReadReceipts })
        .from(privacySettings)
        .where(eq(privacySettings.userId, req.userId!))
        .limit(1);
      const privacy = privacyRows[0];

      if (!privacy || privacy.showReadReceipts === 1) {
        const submittedReceipts = Array.isArray(req.body?.receipts)
          ? (req.body.receipts as SignedEncryptedReadReceipt[])
          : null;

        if (submittedReceipts && submittedReceipts.length > 0) {
          const identityRows = await database
            .select({ ecdsaPublicJwk: identityKeys.ecdsaPublicJwk })
            .from(identityKeys)
            .where(eq(identityKeys.userId, req.userId!))
            .limit(1);
          const identityRow = identityRows[0];

          if (!identityRow?.ecdsaPublicJwk) {
            return res.status(400).json({ error: 'Reader signing key not found.' });
          }

          const acceptedReceipts: SignedEncryptedReadReceipt[] = [];
          for (const item of submittedReceipts.slice(0, 50)) {
            if (
              !item ||
              typeof item.messageId !== 'string' ||
              typeof item.viewedAt !== 'string' ||
              typeof item.signature !== 'string'
            ) {
              continue;
            }

            const targetRows = await database
              .select({ id: messages.id, senderId: messages.senderId })
              .from(messages)
              .where(and(eq(messages.id, item.messageId), eq(messages.conversationId, convId)))
              .limit(1);
            const targetMsg = targetRows[0];
            if (!targetMsg || targetMsg.senderId === req.userId!) continue;

            const validSig = await verifyEcdsaReadReceiptSignature(
              identityRow.ecdsaPublicJwk,
              convId,
              item.messageId,
              req.userId!,
              item.viewedAt,
              item.signature
            );
            if (!validSig) {
              return res.status(400).json({
                error: 'Invalid cryptographic read receipt signature.',
                code: 'INVALID_RECEIPT_SIGNATURE',
              });
            }

            const encryptedPayloadJson = item.ciphertext
              ? JSON.stringify({
                  ciphertext: item.ciphertext,
                  iv: item.iv || null,
                  aad: item.aad || null,
                  recipientEnvelopes: item.recipientEnvelopes || null,
                  epoch: typeof item.epoch === 'number' ? item.epoch : null,
                })
              : null;

            await database
              .insert(messageReceipts)
              .values({
                id: `${item.messageId}:${req.userId!}`,
                messageId: item.messageId,
                userId: req.userId!,
                status: 'read',
                signature: item.signature,
                signedAt: item.viewedAt,
                encryptedPayloadJson,
                updatedAt: nowIso,
              })
              .onConflictDoUpdate({
                target: [messageReceipts.messageId, messageReceipts.userId],
                set: {
                  status: 'read',
                  signature: item.signature,
                  signedAt: item.viewedAt,
                  encryptedPayloadJson,
                  updatedAt: nowIso,
                },
              });

            acceptedReceipts.push({
              messageId: item.messageId,
              readerId: req.userId!,
              viewedAt: item.viewedAt,
              signature: item.signature,
              ciphertext: item.ciphertext || null,
              iv: item.iv || null,
              aad: item.aad || null,
              recipientEnvelopes: item.recipientEnvelopes || null,
              epoch: typeof item.epoch === 'number' ? item.epoch : null,
            });
          }

          if (acceptedReceipts.length > 0) {
            getIO()?.to(`conv:${convId}`).emit('message:read_batch', {
              conversationId: convId,
              userId: req.userId!,
              messageIds: acceptedReceipts.map((r) => r.messageId),
              receipts: acceptedReceipts,
              updatedAt: nowIso,
            });
          }
        } else {
          const readReceiptRows = await database
            .select({ messageId: messageReceipts.messageId })
            .from(messageReceipts)
            .where(
              and(eq(messageReceipts.userId, req.userId!), eq(messageReceipts.status, 'read'))
            );
          const alreadyReadSet = new Set(readReceiptRows.map((r) => r.messageId));

          const candidateMsgs = await database
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.conversationId, convId), ne(messages.senderId, req.userId!)))
            .orderBy(desc(messages.createdAt))
            .limit(50);

          const unreadMsgs = candidateMsgs.filter((m) => !alreadyReadSet.has(m.id));
          for (const m of unreadMsgs) {
            await database
              .insert(messageReceipts)
              .values({
                id: `${m.id}:${req.userId!}`,
                messageId: m.id,
                userId: req.userId!,
                status: 'read',
                updatedAt: nowIso,
              })
              .onConflictDoUpdate({
                target: [messageReceipts.messageId, messageReceipts.userId],
                set: { status: 'read', updatedAt: nowIso },
              });
          }

          if (unreadMsgs.length > 0) {
            getIO()?.to(`conv:${convId}`).emit('message:read_batch', {
              conversationId: convId,
              userId: req.userId!,
              messageIds: unreadMsgs.map((m) => m.id),
              updatedAt: nowIso,
            });
          }
        }
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('mark read error:', error);
      return res.status(500).json({ error: 'Failed to mark messages read.' });
    }
  });

  router.patch('/messages/:messageId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const msgId = String(req.params.messageId);
      const msgRows = await database
        .select()
        .from(messages)
        .where(eq(messages.id, msgId))
        .limit(1);
      const msg = msgRows[0];

      if (!msg) {
        return res.status(404).json({ error: 'Message not found.' });
      }

      const member = await database
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, msg.conversationId),
            eq(conversationParticipants.userId, req.userId!)
          )
        )
        .limit(1);
      if (member.length === 0) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const body = req.body || {};
      const nowIso = new Date().toISOString();

      if (body.action === 'delete_for_me') {
        const deletedFor = JSON.parse(msg.deletedForUsersJson || '[]') as string[];
        if (!deletedFor.includes(req.userId!)) {
          deletedFor.push(req.userId!);
          await database
            .update(messages)
            .set({ deletedForUsersJson: JSON.stringify(deletedFor), updatedAt: nowIso })
            .where(eq(messages.id, msg.id));
        }
        return res.json({ deletedForMe: true });
      }

      if (body.action === 'delete_for_everyone') {
        if (msg.senderId !== req.userId!) {
          return res.status(403).json({ error: 'Only the sender can delete for everyone.' });
        }
        await database
          .update(messages)
          .set({
            deletedForEveryone: 1,
            ciphertext: '',
            iv: '',
            recipientEnvelopesJson: null,
            updatedAt: nowIso,
          })
          .where(eq(messages.id, msg.id));
        getIO()?.to(`conv:${msg.conversationId}`).emit('message:updated', {
          conversationId: msg.conversationId,
          messageId: msg.id,
          deletedForEveryone: true,
        });
        return res.json({ deletedForEveryone: true });
      }

      if (typeof body.isPinned === 'boolean') {
        await database
          .update(messages)
          .set({ isPinned: body.isPinned ? 1 : 0, updatedAt: nowIso })
          .where(eq(messages.id, msg.id));
        getIO()?.to(`conv:${msg.conversationId}`).emit('message:updated', {
          conversationId: msg.conversationId,
          messageId: msg.id,
          isPinned: body.isPinned,
        });
        return res.json({ isPinned: body.isPinned });
      }

      if (typeof body.ciphertext === 'string' && typeof body.iv === 'string') {
        if (msg.senderId !== req.userId!) {
          return res.status(403).json({ error: 'Only the sender can edit a message.' });
        }
        const envelopes = body.recipientEnvelopes
          ? JSON.stringify(body.recipientEnvelopes)
          : msg.recipientEnvelopesJson;
        await database
          .update(messages)
          .set({
            ciphertext: body.ciphertext,
            iv: body.iv,
            aad: body.aad || msg.aad,
            recipientEnvelopesJson: envelopes,
            isEdited: 1,
            updatedAt: nowIso,
          })
          .where(eq(messages.id, msg.id));

        const updatedRows = await database
          .select()
          .from(messages)
          .where(eq(messages.id, msg.id))
          .limit(1);
        const updated = updatedRows[0];
        const participants = await database
          .select({ userId: conversationParticipants.userId })
          .from(conversationParticipants)
          .where(eq(conversationParticipants.conversationId, msg.conversationId));

        const io = getIO();
        if (io && updated) {
          for (const p of participants) {
            io.to(`user:${p.userId}`).emit('message:edited', {
              conversationId: msg.conversationId,
              message: await hydrateMessageRow(database, updated, p.userId),
            });
          }
        }

        return res.json({ message: await hydrateMessageRow(database, updated, req.userId!) });
      }

      return res.status(400).json({ error: 'Unsupported message update action.' });
    } catch (error) {
      console.error('patch message error:', error);
      return res.status(500).json({ error: 'Failed to update message.' });
    }
  });

  router.post('/messages/:messageId/reactions', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const msgId = String(req.params.messageId);
      const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 16) : '';
      if (!emoji) {
        return res.status(400).json({ error: 'Emoji is required.' });
      }

      const msgRows = await database
        .select({ id: messages.id, conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.id, msgId))
        .limit(1);
      const msg = msgRows[0];
      if (!msg) {
        return res.status(404).json({ error: 'Message not found.' });
      }

      const member = await database
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, msg.conversationId),
            eq(conversationParticipants.userId, req.userId!)
          )
        )
        .limit(1);
      if (member.length === 0) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const existingRows = await database
        .select({ id: messageReactions.id })
        .from(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, msg.id),
            eq(messageReactions.userId, req.userId!),
            eq(messageReactions.emoji, emoji)
          )
        )
        .limit(1);

      if (existingRows[0]) {
        await database
          .delete(messageReactions)
          .where(eq(messageReactions.id, existingRows[0].id));
      } else {
        await database.insert(messageReactions).values({
          id: crypto.randomUUID(),
          messageId: msg.id,
          userId: req.userId!,
          emoji,
          createdAt: new Date().toISOString(),
        });
      }

      const reactionRows = await database
        .select({
          emoji: messageReactions.emoji,
          userId: messageReactions.userId,
        })
        .from(messageReactions)
        .where(eq(messageReactions.messageId, msg.id));

      const map = new Map<string, string[]>();
      for (const r of reactionRows) {
        const list = map.get(r.emoji) || [];
        list.push(r.userId);
        map.set(r.emoji, list);
      }
      const reactions = Array.from(map.entries()).map(([em, userIds]) => ({
        emoji: em,
        userIds,
        count: userIds.length,
      }));

      getIO()?.to(`conv:${msg.conversationId}`).emit('message:reactions', {
        conversationId: msg.conversationId,
        messageId: msg.id,
        reactions,
      });

      return res.json({ reactions });
    } catch (error) {
      console.error('reaction toggle error:', error);
      return res.status(500).json({ error: 'Failed to toggle reaction.' });
    }
  });

  return router;
}
