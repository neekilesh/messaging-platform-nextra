import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
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

export function hydrateMessageRow(
  db: DatabaseSync,
  row: {
    id: string;
    conversation_id: string;
    sender_id: string;
    reply_to_id: string | null;
    forwarded_from_id: string | null;
    kind: string;
    ciphertext: string;
    iv: string;
    aad: string;
    recipient_envelopes_json: string | null;
    epoch: number | null;
    attachment_id: string | null;
    is_pinned: number;
    is_edited: number;
    deleted_for_everyone: number;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
  },
  requesterId: string
): MessageRecord {
  const sender = db
    .prepare(`SELECT username, display_name, avatar_url FROM users WHERE id = ?`)
    .get(row.sender_id) as { username: string; display_name: string; avatar_url: string | null } | undefined;

  // Compute aggregate status for sender
  let status: MessageStatus = 'sent';
  const receipts = db
    .prepare(
      `SELECT user_id, status, signature, signed_at, encrypted_payload_json, updated_at
       FROM message_receipts WHERE message_id = ? AND user_id != ?`
    )
    .all(row.id, row.sender_id) as Array<{
    user_id: string;
    status: string;
    signature: string | null;
    signed_at: string | null;
    encrypted_payload_json: string | null;
    updated_at: string;
  }>;

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
      if (r.encrypted_payload_json) {
        try {
          encPayload = JSON.parse(r.encrypted_payload_json);
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
        readerId: r.user_id,
        viewedAt: r.signed_at || r.updated_at,
        signature: r.signature!,
        ciphertext: encPayload.ciphertext || null,
        iv: encPayload.iv || null,
        aad: encPayload.aad || null,
        recipientEnvelopes: filteredEnvelopes,
        epoch: typeof encPayload.epoch === 'number' ? encPayload.epoch : null,
      };
    });

  const reactionRows = db
    .prepare(`SELECT emoji, user_id FROM message_reactions WHERE message_id = ?`)
    .all(row.id) as Array<{ emoji: string; user_id: string }>;

  const reactionMap = new Map<string, string[]>();
  for (const r of reactionRows) {
    const list = reactionMap.get(r.emoji) || [];
    list.push(r.user_id);
    reactionMap.set(r.emoji, list);
  }
  const reactions: MessageReactionItem[] = Array.from(reactionMap.entries()).map(([emoji, userIds]) => ({
    emoji,
    userIds,
    count: userIds.length,
  }));

  let parsedEnvelopes: Record<string, { ephemeralPublicJwk: string; wrappedKey: string; iv: string }> | null = null;
  if (row.recipient_envelopes_json) {
    try {
      const full = JSON.parse(row.recipient_envelopes_json) as Record<
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
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderUsername: sender?.username || 'unknown',
    senderDisplayName: sender?.display_name || 'Unknown',
    senderAvatarUrl: sender?.avatar_url || null,
    replyToId: row.reply_to_id,
    forwardedFromId: row.forwarded_from_id,
    kind: row.kind as MessageRecord['kind'],
    ciphertext: row.deleted_for_everyone ? '' : row.ciphertext,
    iv: row.deleted_for_everyone ? '' : row.iv,
    aad: row.aad,
    recipientEnvelopes: row.deleted_for_everyone ? null : parsedEnvelopes,
    epoch: row.epoch,
    attachmentId: row.deleted_for_everyone ? null : row.attachment_id,
    isPinned: row.is_pinned === 1,
    isEdited: row.is_edited === 1,
    deletedForEveryone: row.deleted_for_everyone === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status,
    reactions,
    ...(readReceipts.length > 0 ? { readReceipts } : {}),
  };
}

export function createConversationsRouter(db: DatabaseSync) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    const nowIso = new Date().toISOString();
    const rows = db
      .prepare(
        `SELECT c.id, c.type, c.group_id, c.disappearing_seconds, c.last_message_at,
                cp.muted, cp.archived, cp.unread_count,
                g.name as group_name, g.description as group_desc, g.avatar_url as group_avatar,
                g.max_members, g.current_epoch
         FROM conversation_participants cp
         JOIN conversations c ON c.id = cp.conversation_id
         LEFT JOIN groups g ON g.id = c.group_id
         WHERE cp.user_id = ?
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`
      )
      .all(req.userId!) as Array<{
      id: string;
      type: 'private' | 'group';
      group_id: string | null;
      disappearing_seconds: number;
      last_message_at: string | null;
      muted: number;
      archived: number;
      unread_count: number;
      group_name: string | null;
      group_desc: string | null;
      group_avatar: string | null;
      max_members: number | null;
      current_epoch: number | null;
    }>;

    const conversations = rows
      .map((row) => {
        let title = row.group_name || 'Conversation';
        let subtitle = '';
        let avatarUrl = row.group_avatar || null;
        let peerUser = null;
        let streak = null;
        let groupMemberCount: number | null = null;
        let myEpochEnvelopes = undefined;

        if (row.type === 'private') {
          const other = db
            .prepare(
              `SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ? LIMIT 1`
            )
            .get(row.id, req.userId!) as { user_id: string } | undefined;
          if (!other) return null;
          if (isBlockedBetween(db, req.userId!, other.user_id)) return null;
          peerUser = getPublicUserById(db, other.user_id, req.userId!);
          if (!peerUser) return null;
          title = peerUser.displayName;
          subtitle = `@${peerUser.username}`;
          avatarUrl = peerUser.avatarUrl;
          streak = getStreakInfo(db, req.userId!, other.user_id);
        } else if (row.group_id) {
          const countRow = db
            .prepare(`SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ?`)
            .get(row.group_id) as { cnt: number };
          groupMemberCount = countRow.cnt;
          subtitle = `${groupMemberCount}/${row.max_members || 25} members`;

          const envRows = db
            .prepare(
              `SELECT epoch, sender_user_id, ephemeral_public_jwk, wrapped_epoch_key, iv
               FROM group_encryption_states
               WHERE group_id = ? AND user_id = ?
               ORDER BY epoch ASC`
            )
            .all(row.group_id, req.userId!) as Array<{
            epoch: number;
            sender_user_id: string;
            ephemeral_public_jwk: string;
            wrapped_epoch_key: string;
            iv: string;
          }>;
          myEpochEnvelopes = envRows.map((e) => ({
            epoch: e.epoch,
            senderUserId: e.sender_user_id,
            ephemeralPublicJwk: e.ephemeral_public_jwk,
            wrappedEpochKey: e.wrapped_epoch_key,
            iv: e.iv,
          }));
        }

        const lastMsgRow = db
          .prepare(
            `SELECT * FROM messages
             WHERE conversation_id = ?
               AND (expires_at IS NULL OR expires_at > ?)
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(row.id, nowIso) as Parameters<typeof hydrateMessageRow>[1] | undefined;

        const lastMessage = lastMsgRow ? hydrateMessageRow(db, lastMsgRow, req.userId!) : null;

        return {
          id: row.id,
          type: row.type,
          title,
          subtitle,
          avatarUrl,
          peerUser,
          groupId: row.group_id,
          groupMemberCount,
          groupMaxMembers: row.max_members,
          currentEpoch: row.current_epoch,
          disappearingSeconds: row.disappearing_seconds,
          muted: row.muted === 1,
          archived: row.archived === 1,
          unreadCount: row.unread_count,
          streak,
          lastMessage,
          lastMessageAt: row.last_message_at,
          ...(myEpochEnvelopes ? { myEpochEnvelopes } : {}),
        };
      })
      .filter(Boolean);

    return res.json({ conversations });
  });

  router.post('/private', requireAuth, (req: AuthedRequest, res) => {
    const peerId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    if (!peerId || peerId === req.userId) {
      return res.status(400).json({ error: 'Valid recipient userId is required.' });
    }

    const peerExists = db.prepare(`SELECT id FROM users WHERE id = ?`).get(peerId);
    if (!peerExists) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (isBlockedBetween(db, req.userId!, peerId)) {
      return res.status(403).json({ error: 'Messaging is unavailable with this user.' });
    }

    const [a, b] = orderPair(req.userId!, peerId);
    const pairKey = `${a}:${b}`;

    const existing = db
      .prepare(`SELECT id FROM conversations WHERE private_pair_key = ?`)
      .get(pairKey) as { id: string } | undefined;

    if (existing) {
      return res.json({ conversationId: existing.id, created: false });
    }

    // Check friendship OR allow_chat_requests
    const isFriend = db
      .prepare(`SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ?`)
      .get(a, b);
    if (!isFriend) {
      const privacy = db
        .prepare(`SELECT allow_chat_requests FROM privacy_settings WHERE user_id = ?`)
        .get(peerId) as { allow_chat_requests: number } | undefined;
      if (privacy && privacy.allow_chat_requests === 0) {
        return res.status(403).json({ error: 'Connect as friends first to message this user.' });
      }
    }

    const convId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO conversations (id, type, group_id, private_pair_key, disappearing_seconds, last_message_at, created_at, updated_at)
         VALUES (?, 'private', NULL, ?, 0, NULL, ?, ?)`
      ).run(convId, pairKey, nowIso, nowIso);

      db.prepare(
        `INSERT INTO conversation_participants (id, conversation_id, user_id, joined_at) VALUES (?, ?, ?, ?)`
      ).run(crypto.randomUUID(), convId, req.userId!, nowIso);

      db.prepare(
        `INSERT INTO conversation_participants (id, conversation_id, user_id, joined_at) VALUES (?, ?, ?, ?)`
      ).run(crypto.randomUUID(), convId, peerId, nowIso);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const io = getIO();
    if (io) {
      io.in(`user:${req.userId!}`).socketsJoin(`conv:${convId}`);
      io.in(`user:${peerId}`).socketsJoin(`conv:${convId}`);
      io.to(`user:${peerId}`).emit('conversation:new', { conversationId: convId });
    }

    return res.status(201).json({ conversationId: convId, created: true });
  });

  router.patch('/:id/settings', requireAuth, (req: AuthedRequest, res) => {
    const convId = req.params.id;
    const participant = db
      .prepare(`SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
      .get(convId, req.userId!);
    if (!participant) {
      return res.status(403).json({ error: 'Not a participant in this conversation.' });
    }

    const body = req.body || {};
    const nowIso = new Date().toISOString();

    if (typeof body.muted === 'boolean') {
      db.prepare(`UPDATE conversation_participants SET muted = ? WHERE conversation_id = ? AND user_id = ?`).run(
        body.muted ? 1 : 0,
        convId,
        req.userId!
      );
    }

    if (typeof body.archived === 'boolean') {
      db.prepare(`UPDATE conversation_participants SET archived = ? WHERE conversation_id = ? AND user_id = ?`).run(
        body.archived ? 1 : 0,
        convId,
        req.userId!
      );
    }

    if (typeof body.disappearingSeconds === 'number') {
      if (!ALLOWED_DISAPPEARING.has(body.disappearingSeconds)) {
        return res.status(400).json({ error: 'Unsupported disappearing message interval.' });
      }
      db.prepare(`UPDATE conversations SET disappearing_seconds = ?, updated_at = ? WHERE id = ?`).run(
        body.disappearingSeconds,
        nowIso,
        convId
      );
      getIO()?.to(`conv:${convId}`).emit('conversation:updated', {
        conversationId: convId,
        disappearingSeconds: body.disappearingSeconds,
      });
    }

    return res.json({ success: true });
  });

  router.get('/:id/messages', requireAuth, (req: AuthedRequest, res) => {
    const convId = req.params.id;
    const participant = db
      .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
      .get(convId, req.userId!);
    if (!participant) {
      return res.status(403).json({ error: 'Access denied to this conversation.' });
    }

    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 40)));
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const nowIso = new Date().toISOString();

    const rows = (
      before
        ? db
            .prepare(
              `SELECT * FROM messages
               WHERE conversation_id = ?
                 AND (expires_at IS NULL OR expires_at > ?)
                 AND created_at < ?
               ORDER BY created_at DESC LIMIT ?`
            )
            .all(convId, nowIso, before, limit + 1)
        : db
            .prepare(
              `SELECT * FROM messages
               WHERE conversation_id = ?
                 AND (expires_at IS NULL OR expires_at > ?)
               ORDER BY created_at DESC LIMIT ?`
            )
            .all(convId, nowIso, limit + 1)
    ) as Array<Parameters<typeof hydrateMessageRow>[1] & { deleted_for_users_json: string }>;

    const hasMore = rows.length > limit;
    const sliced = rows.slice(0, limit).reverse();

    const messages = sliced
      .filter((r) => {
        try {
          const deletedFor = JSON.parse(r.deleted_for_users_json || '[]') as string[];
          return !deletedFor.includes(req.userId!);
        } catch {
          return true;
        }
      })
      .map((r) => hydrateMessageRow(db, r, req.userId!));

    return res.json({ messages, hasMore });
  });

  router.post('/:id/messages', requireAuth, (req: AuthedRequest, res) => {
    const convId = req.params.id;
    const participant = db
      .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
      .get(convId, req.userId!);
    if (!participant) {
      return res.status(403).json({ error: 'Not a participant in this conversation.' });
    }

    const conv = db
      .prepare(`SELECT id, type, group_id, disappearing_seconds FROM conversations WHERE id = ?`)
      .get(convId) as
      | { id: string; type: 'private' | 'group'; group_id: string | null; disappearing_seconds: number }
      | undefined;
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const body = req.body || {};
    const messageId = typeof body.id === 'string' && body.id.length <= 64 ? body.id : crypto.randomUUID();
    const kind = ['text', 'image', 'video', 'voice', 'file', 'system'].includes(body.kind) ? body.kind : 'text';
    const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : '';
    const iv = typeof body.iv === 'string' ? body.iv : '';
    const aad = typeof body.aad === 'string' ? body.aad : '';
    const recipientEnvelopes = body.recipientEnvelopes ? JSON.stringify(body.recipientEnvelopes) : null;
    const epoch = typeof body.epoch === 'number' ? body.epoch : null;
    const replyToId = typeof body.replyToId === 'string' ? body.replyToId : null;
    const forwardedFromId = typeof body.forwardedFromId === 'string' ? body.forwardedFromId : null;
    const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : null;

    if (!ciphertext || !iv) {
      return res.status(400).json({ error: 'Encrypted ciphertext and IV are required.' });
    }

    if (conv.type === 'private') {
      const other = db
        .prepare(`SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ? LIMIT 1`)
        .get(convId, req.userId!) as { user_id: string } | undefined;
      if (other && isBlockedBetween(db, req.userId!, other.user_id)) {
        return res.status(403).json({ error: 'Cannot message a blocked user.' });
      }
    }

    // Idempotency check (protects against reconnect duplicates)
    const existingMsg = db
      .prepare(`SELECT * FROM messages WHERE id = ?`)
      .get(messageId) as Parameters<typeof hydrateMessageRow>[1] | undefined;
    if (existingMsg) {
      return res.status(200).json({ message: hydrateMessageRow(db, existingMsg, req.userId!) });
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt =
      conv.disappearing_seconds > 0 ? new Date(nowMs + conv.disappearing_seconds * 1000).toISOString() : null;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO messages (
          id, conversation_id, sender_id, reply_to_id, forwarded_from_id,
          kind, ciphertext, iv, aad, recipient_envelopes_json, epoch, attachment_id,
          is_pinned, is_edited, deleted_for_everyone, deleted_for_users_json, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '[]', ?, ?, ?)`
      ).run(
        messageId,
        convId,
        req.userId!,
        replyToId,
        forwardedFromId,
        kind,
        ciphertext,
        iv,
        aad,
        recipientEnvelopes,
        epoch,
        attachmentId,
        expiresAt,
        nowIso,
        nowIso
      );

      db.prepare(`UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?`).run(nowIso, nowIso, convId);
      db.prepare(
        `UPDATE conversation_participants SET unread_count = unread_count + 1
         WHERE conversation_id = ? AND user_id != ?`
      ).run(convId, req.userId!);

      if (attachmentId && expiresAt) {
        db.prepare(`UPDATE message_attachments SET expires_at = ? WHERE id = ?`).run(expiresAt, attachmentId);
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    let updatedStreak = null;
    if (conv.type === 'private' && kind !== 'system') {
      const other = db
        .prepare(`SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ? LIMIT 1`)
        .get(convId, req.userId!) as { user_id: string } | undefined;
      if (other) {
        updatedStreak = recordStreakActivity(db, req.userId!, other.user_id, nowMs);
      }
    }

    const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as Parameters<typeof hydrateMessageRow>[1];
    const participants = db
      .prepare(`SELECT user_id FROM conversation_participants WHERE conversation_id = ?`)
      .all(convId) as Array<{ user_id: string }>;

    const io = getIO();
    if (io) {
      for (const p of participants) {
        const personalized = hydrateMessageRow(db, row, p.user_id);
        io.to(`user:${p.user_id}`).emit('message:new', {
          conversationId: convId,
          message: personalized,
          streak: updatedStreak,
        });
      }
    }

    return res.status(201).json({
      message: hydrateMessageRow(db, row, req.userId!),
      streak: updatedStreak,
    });
  });

  router.post('/:id/read', requireAuth, async (req: AuthedRequest, res) => {
    const convId = req.params.id;
    const participant = db
      .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
      .get(convId, req.userId!);
    if (!participant) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE conversation_participants SET unread_count = 0, last_read_at = ? WHERE conversation_id = ? AND user_id = ?`
    ).run(nowIso, convId, req.userId!);

    const privacy = db
      .prepare(`SELECT show_read_receipts FROM privacy_settings WHERE user_id = ?`)
      .get(req.userId!) as { show_read_receipts: number } | undefined;

    if (!privacy || privacy.show_read_receipts === 1) {
      const submittedReceipts = Array.isArray(req.body?.receipts)
        ? (req.body.receipts as SignedEncryptedReadReceipt[])
        : null;

      if (submittedReceipts && submittedReceipts.length > 0) {
        const identityRow = db
          .prepare(`SELECT ecdsa_public_jwk FROM identity_keys WHERE user_id = ?`)
          .get(req.userId!) as { ecdsa_public_jwk: string } | undefined;

        if (!identityRow?.ecdsa_public_jwk) {
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

          const targetMsg = db
            .prepare(`SELECT id, sender_id FROM messages WHERE id = ? AND conversation_id = ?`)
            .get(item.messageId, convId) as { id: string; sender_id: string } | undefined;
          if (!targetMsg || targetMsg.sender_id === req.userId!) continue;

          const validSig = await verifyEcdsaReadReceiptSignature(
            identityRow.ecdsa_public_jwk,
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

          db.prepare(
            `INSERT INTO message_receipts (id, message_id, user_id, status, signature, signed_at, encrypted_payload_json, updated_at)
             VALUES (?, ?, ?, 'read', ?, ?, ?, ?)
             ON CONFLICT(message_id, user_id) DO UPDATE SET
               status = 'read',
               signature = excluded.signature,
               signed_at = excluded.signed_at,
               encrypted_payload_json = excluded.encrypted_payload_json,
               updated_at = excluded.updated_at`
          ).run(
            `${item.messageId}:${req.userId!}`,
            item.messageId,
            req.userId!,
            item.signature,
            item.viewedAt,
            encryptedPayloadJson,
            nowIso
          );

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
        const unreadMsgs = db
          .prepare(
            `SELECT id FROM messages
             WHERE conversation_id = ? AND sender_id != ?
               AND id NOT IN (SELECT message_id FROM message_receipts WHERE user_id = ? AND status = 'read')
             ORDER BY created_at DESC LIMIT 50`
          )
          .all(convId, req.userId!, req.userId!) as Array<{ id: string }>;

        for (const m of unreadMsgs) {
          db.prepare(
            `INSERT INTO message_receipts (id, message_id, user_id, status, updated_at)
             VALUES (?, ?, ?, 'read', ?)
             ON CONFLICT(message_id, user_id) DO UPDATE SET status = 'read', updated_at = excluded.updated_at`
          ).run(`${m.id}:${req.userId!}`, m.id, req.userId!, nowIso);
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
  });

  router.patch('/messages/:messageId', requireAuth, (req: AuthedRequest, res) => {
    const msg = db
      .prepare(`SELECT * FROM messages WHERE id = ?`)
      .get(req.params.messageId) as
      | (Parameters<typeof hydrateMessageRow>[1] & { deleted_for_users_json: string })
      | undefined;

    if (!msg) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    const member = db
      .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
      .get(msg.conversation_id, req.userId!);
    if (!member) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const body = req.body || {};
    const nowIso = new Date().toISOString();

    if (body.action === 'delete_for_me') {
      const deletedFor = JSON.parse(msg.deleted_for_users_json || '[]') as string[];
      if (!deletedFor.includes(req.userId!)) {
        deletedFor.push(req.userId!);
        db.prepare(`UPDATE messages SET deleted_for_users_json = ?, updated_at = ? WHERE id = ?`).run(
          JSON.stringify(deletedFor),
          nowIso,
          msg.id
        );
      }
      return res.json({ deletedForMe: true });
    }

    if (body.action === 'delete_for_everyone') {
      if (msg.sender_id !== req.userId!) {
        return res.status(403).json({ error: 'Only the sender can delete for everyone.' });
      }
      db.prepare(
        `UPDATE messages SET deleted_for_everyone = 1, ciphertext = '', iv = '', recipient_envelopes_json = NULL, updated_at = ? WHERE id = ?`
      ).run(nowIso, msg.id);
      getIO()?.to(`conv:${msg.conversation_id}`).emit('message:updated', {
        conversationId: msg.conversation_id,
        messageId: msg.id,
        deletedForEveryone: true,
      });
      return res.json({ deletedForEveryone: true });
    }

    if (typeof body.isPinned === 'boolean') {
      db.prepare(`UPDATE messages SET is_pinned = ?, updated_at = ? WHERE id = ?`).run(
        body.isPinned ? 1 : 0,
        nowIso,
        msg.id
      );
      getIO()?.to(`conv:${msg.conversation_id}`).emit('message:updated', {
        conversationId: msg.conversation_id,
        messageId: msg.id,
        isPinned: body.isPinned,
      });
      return res.json({ isPinned: body.isPinned });
    }

    if (typeof body.ciphertext === 'string' && typeof body.iv === 'string') {
      if (msg.sender_id !== req.userId!) {
        return res.status(403).json({ error: 'Only the sender can edit a message.' });
      }
      const envelopes = body.recipientEnvelopes ? JSON.stringify(body.recipientEnvelopes) : msg.recipient_envelopes_json;
      db.prepare(
        `UPDATE messages SET ciphertext = ?, iv = ?, aad = ?, recipient_envelopes_json = ?, is_edited = 1, updated_at = ? WHERE id = ?`
      ).run(body.ciphertext, body.iv, body.aad || msg.aad, envelopes, nowIso, msg.id);

      const updated = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(msg.id) as Parameters<typeof hydrateMessageRow>[1];
      const participants = db
        .prepare(`SELECT user_id FROM conversation_participants WHERE conversation_id = ?`)
        .all(msg.conversation_id) as Array<{ user_id: string }>;

      const io = getIO();
      if (io) {
        for (const p of participants) {
          io.to(`user:${p.user_id}`).emit('message:edited', {
            conversationId: msg.conversation_id,
            message: hydrateMessageRow(db, updated, p.user_id),
          });
        }
      }

      return res.json({ message: hydrateMessageRow(db, updated, req.userId!) });
    }

    return res.status(400).json({ error: 'Unsupported message update action.' });
  });

  router.post('/messages/:messageId/reactions', requireAuth, (req: AuthedRequest, res) => {
    const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 16) : '';
    if (!emoji) {
      return res.status(400).json({ error: 'Emoji is required.' });
    }

    const msg = db
      .prepare(`SELECT id, conversation_id FROM messages WHERE id = ?`)
      .get(req.params.messageId) as { id: string; conversation_id: string } | undefined;
    if (!msg) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    const member = db
      .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
      .get(msg.conversation_id, req.userId!);
    if (!member) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const existing = db
      .prepare(`SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`)
      .get(msg.id, req.userId!, emoji) as { id: string } | undefined;

    if (existing) {
      db.prepare(`DELETE FROM message_reactions WHERE id = ?`).run(existing.id);
    } else {
      db.prepare(
        `INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), msg.id, req.userId!, emoji, new Date().toISOString());
    }

    const reactionRows = db
      .prepare(`SELECT emoji, user_id FROM message_reactions WHERE message_id = ?`)
      .all(msg.id) as Array<{ emoji: string; user_id: string }>;

    const map = new Map<string, string[]>();
    for (const r of reactionRows) {
      const list = map.get(r.emoji) || [];
      list.push(r.user_id);
      map.set(r.emoji, list);
    }
    const reactions = Array.from(map.entries()).map(([em, userIds]) => ({
      emoji: em,
      userIds,
      count: userIds.length,
    }));

    getIO()?.to(`conv:${msg.conversation_id}`).emit('message:reactions', {
      conversationId: msg.conversation_id,
      messageId: msg.id,
      reactions,
    });

    return res.json({ reactions });
  });

  return router;
}
