import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  createNotification,
  createRequireAuth,
  getIO,
  getPublicUserById,
  isBlockedBetween,
} from '../context.ts';
import type { AuthedRequest } from '../context.ts';
import { getStreakInfo } from '../streaks.ts';

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function createFriendsRouter(db: DatabaseSync) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT id, user_a_id, user_b_id, created_at FROM friendships
         WHERE user_a_id = ? OR user_b_id = ?
         ORDER BY created_at DESC`
      )
      .all(req.userId!, req.userId!) as Array<{
      id: string;
      user_a_id: string;
      user_b_id: string;
      created_at: string;
    }>;

    const friends = rows
      .map((r) => {
        const peerId = r.user_a_id === req.userId ? r.user_b_id : r.user_a_id;
        if (isBlockedBetween(db, req.userId!, peerId)) return null;
        const user = getPublicUserById(db, peerId, req.userId!);
        if (!user) return null;
        const [a, b] = orderPair(req.userId!, peerId);
        const conv = db
          .prepare(`SELECT id FROM conversations WHERE private_pair_key = ?`)
          .get(`${a}:${b}`) as { id: string } | undefined;
        return {
          friendshipId: r.id,
          user,
          streak: getStreakInfo(db, req.userId!, peerId),
          conversationId: conv?.id || null,
          createdAt: r.created_at,
        };
      })
      .filter(Boolean);

    return res.json({ friends });
  });

  router.get('/requests', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT * FROM friend_requests
         WHERE (sender_id = ? OR receiver_id = ?) AND status = 'pending'
         ORDER BY created_at DESC`
      )
      .all(req.userId!, req.userId!) as Array<{
      id: string;
      sender_id: string;
      receiver_id: string;
      status: 'pending' | 'accepted' | 'rejected';
      created_at: string;
    }>;

    const requests = rows
      .map((r) => {
        const sender = getPublicUserById(db, r.sender_id, req.userId!);
        const receiver = getPublicUserById(db, r.receiver_id, req.userId!);
        if (!sender || !receiver) return null;
        return {
          id: r.id,
          sender,
          receiver,
          status: r.status,
          direction: r.receiver_id === req.userId ? 'incoming' : 'outgoing',
          createdAt: r.created_at,
        };
      })
      .filter(Boolean);

    return res.json({ requests });
  });

  router.post('/requests', requireAuth, (req: AuthedRequest, res) => {
    const targetUserId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const targetUsername = typeof req.body?.username === 'string' ? req.body.username.replace(/^@+/, '').toLowerCase() : null;

    let peerRow: { id: string } | undefined;
    if (targetUserId) {
      peerRow = db.prepare(`SELECT id FROM users WHERE id = ?`).get(targetUserId) as { id: string } | undefined;
    } else if (targetUsername) {
      peerRow = db.prepare(`SELECT id FROM users WHERE username_normalized = ?`).get(targetUsername) as { id: string } | undefined;
    }

    if (!peerRow) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (peerRow.id === req.userId) {
      return res.status(400).json({ error: 'You cannot add yourself.' });
    }
    if (isBlockedBetween(db, req.userId!, peerRow.id)) {
      return res.status(403).json({ error: 'Cannot send request to this user.' });
    }

    const privacy = db
      .prepare(`SELECT allow_chat_requests FROM privacy_settings WHERE user_id = ?`)
      .get(peerRow.id) as { allow_chat_requests: number } | undefined;
    if (privacy && privacy.allow_chat_requests === 0) {
      return res.status(403).json({ error: 'This user is not accepting new requests.' });
    }

    const [a, b] = orderPair(req.userId!, peerRow.id);
    const alreadyFriends = db
      .prepare(`SELECT id FROM friendships WHERE user_a_id = ? AND user_b_id = ?`)
      .get(a, b);
    if (alreadyFriends) {
      return res.status(409).json({ error: 'You are already connected.' });
    }

    const reversePending = db
      .prepare(
        `SELECT id FROM friend_requests WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'`
      )
      .get(peerRow.id, req.userId!) as { id: string } | undefined;

    const nowIso = new Date().toISOString();

    // If the peer already sent us a pending request, accept it mutually
    if (reversePending) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?`).run(nowIso, reversePending.id);
        db.prepare(`INSERT OR IGNORE INTO friendships (id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?)`).run(
          crypto.randomUUID(),
          a,
          b,
          nowIso
        );
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return res.status(201).json({ status: 'accepted', autoAccepted: true });
    }

    const reqId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO friend_requests (id, sender_id, receiver_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(sender_id, receiver_id) DO UPDATE SET
         status = 'pending',
         updated_at = excluded.updated_at`
    ).run(reqId, req.userId!, peerRow.id, nowIso, nowIso);

    const me = getPublicUserById(db, req.userId!, req.userId!);
    createNotification(db, {
      id: crypto.randomUUID(),
      userId: peerRow.id,
      type: 'friend_request',
      actorId: req.userId!,
      entityId: reqId,
      title: 'New connection request',
      body: `@${me?.username || 'someone'} wants to connect with you on NEXORA.`,
    });

    getIO()?.to(`user:${peerRow.id}`).emit('friend:request', { requestId: reqId });
    return res.status(201).json({ id: reqId, status: 'pending' });
  });

  router.post('/requests/:id/respond', requireAuth, (req: AuthedRequest, res) => {
    const action = req.body?.action === 'accept' ? 'accepted' : req.body?.action === 'reject' ? 'rejected' : null;
    if (!action) {
      return res.status(400).json({ error: 'Action must be accept or reject.' });
    }

    const requestRow = db
      .prepare(`SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = 'pending'`)
      .get(req.params.id, req.userId!) as
      | { id: string; sender_id: string; receiver_id: string }
      | undefined;

    if (!requestRow) {
      return res.status(404).json({ error: 'Pending request not found.' });
    }

    const nowIso = new Date().toISOString();
    const [a, b] = orderPair(requestRow.sender_id, requestRow.receiver_id);

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?`).run(action, nowIso, requestRow.id);
      if (action === 'accepted') {
        db.prepare(`INSERT OR IGNORE INTO friendships (id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?)`).run(
          crypto.randomUUID(),
          a,
          b,
          nowIso
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    if (action === 'accepted') {
      const me = getPublicUserById(db, req.userId!, req.userId!);
      createNotification(db, {
        id: crypto.randomUUID(),
        userId: requestRow.sender_id,
        type: 'friend_accepted',
        actorId: req.userId!,
        entityId: requestRow.id,
        title: 'Request accepted',
        body: `@${me?.username || 'someone'} accepted your connection request.`,
      });
      getIO()?.to(`user:${requestRow.sender_id}`).emit('friend:accepted', { userId: req.userId! });
    }

    return res.json({ status: action });
  });

  router.delete('/:friendId', requireAuth, (req: AuthedRequest, res) => {
    const [a, b] = orderPair(req.userId!, req.params.friendId);
    db.prepare(`DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?`).run(a, b);
    return res.json({ removed: true });
  });

  return router;
}
