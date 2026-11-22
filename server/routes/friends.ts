import crypto from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, or } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import {
  conversations,
  friendRequests,
  friendships,
  privacySettings,
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

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function createFriendsRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  router.get('/', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const rows = await database
        .select({
          id: friendships.id,
          userAId: friendships.userAId,
          userBId: friendships.userBId,
          createdAt: friendships.createdAt,
        })
        .from(friendships)
        .where(
          or(eq(friendships.userAId, req.userId!), eq(friendships.userBId, req.userId!))
        )
        .orderBy(desc(friendships.createdAt));

      const friends = [];
      for (const r of rows) {
        const peerId = r.userAId === req.userId ? r.userBId : r.userAId;
        if (await isBlockedBetween(database, req.userId!, peerId)) continue;
        const user = await getPublicUserById(database, peerId, req.userId!);
        if (!user) continue;
        const [a, b] = orderPair(req.userId!, peerId);
        const convRows = await database
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.privatePairKey, `${a}:${b}`))
          .limit(1);

        friends.push({
          friendshipId: r.id,
          user,
          conversationId: convRows[0]?.id || null,
          createdAt: r.createdAt,
        });
      }

      return res.json({ friends });
    } catch (error) {
      console.error('list friends error:', error);
      return res.status(500).json({ error: 'Failed to load friends.' });
    }
  });

  router.get('/requests', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const rows = await database
        .select()
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.status, 'pending'),
            or(
              eq(friendRequests.senderId, req.userId!),
              eq(friendRequests.receiverId, req.userId!)
            )
          )
        )
        .orderBy(desc(friendRequests.createdAt));

      const requests = [];
      for (const r of rows) {
        const sender = await getPublicUserById(database, r.senderId, req.userId!);
        const receiver = await getPublicUserById(database, r.receiverId, req.userId!);
        if (!sender || !receiver) continue;
        requests.push({
          id: r.id,
          sender,
          receiver,
          status: r.status as 'pending' | 'accepted' | 'rejected',
          direction: r.receiverId === req.userId ? 'incoming' : 'outgoing',
          createdAt: r.createdAt,
        });
      }

      return res.json({ requests });
    } catch (error) {
      console.error('list friend requests error:', error);
      return res.status(500).json({ error: 'Failed to load friend requests.' });
    }
  });

  router.post('/requests', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const targetUserId = typeof req.body?.userId === 'string' ? req.body.userId : null;
      const targetUsername =
        typeof req.body?.username === 'string'
          ? req.body.username.replace(/^@+/, '').toLowerCase()
          : null;

      let peerRow: { id: string } | undefined;
      if (targetUserId) {
        const rows = await database
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);
        peerRow = rows[0];
      } else if (targetUsername) {
        const rows = await database
          .select({ id: users.id })
          .from(users)
          .where(eq(users.usernameNormalized, targetUsername))
          .limit(1);
        peerRow = rows[0];
      }

      if (!peerRow) {
        return res.status(404).json({ error: 'User not found.' });
      }
      if (peerRow.id === req.userId) {
        return res.status(400).json({ error: 'You cannot add yourself.' });
      }
      if (await isBlockedBetween(database, req.userId!, peerRow.id)) {
        return res.status(403).json({ error: 'Cannot send request to this user.' });
      }

      const privacyRows = await database
        .select({ allowChatRequests: privacySettings.allowChatRequests })
        .from(privacySettings)
        .where(eq(privacySettings.userId, peerRow.id))
        .limit(1);
      if (privacyRows[0] && privacyRows[0].allowChatRequests === 0) {
        return res.status(403).json({ error: 'This user is not accepting new requests.' });
      }

      const [a, b] = orderPair(req.userId!, peerRow.id);
      const alreadyFriends = await database
        .select({ id: friendships.id })
        .from(friendships)
        .where(and(eq(friendships.userAId, a), eq(friendships.userBId, b)))
        .limit(1);
      if (alreadyFriends.length > 0) {
        return res.status(409).json({ error: 'You are already connected.' });
      }

      const reverseRows = await database
        .select({ id: friendRequests.id })
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.senderId, peerRow.id),
            eq(friendRequests.receiverId, req.userId!),
            eq(friendRequests.status, 'pending')
          )
        )
        .limit(1);

      const reversePending = reverseRows[0];
      const nowIso = new Date().toISOString();

      if (reversePending) {
        await database.transaction(async (tx) => {
          await tx
            .update(friendRequests)
            .set({ status: 'accepted', updatedAt: nowIso })
            .where(eq(friendRequests.id, reversePending.id));

          await tx
            .insert(friendships)
            .values({
              id: crypto.randomUUID(),
              userAId: a,
              userBId: b,
              createdAt: nowIso,
            })
            .onConflictDoNothing();
        });
        return res.status(201).json({ status: 'accepted', autoAccepted: true });
      }

      const reqId = crypto.randomUUID();
      await database
        .insert(friendRequests)
        .values({
          id: reqId,
          senderId: req.userId!,
          receiverId: peerRow.id,
          status: 'pending',
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: [friendRequests.senderId, friendRequests.receiverId],
          set: {
            status: 'pending',
            updatedAt: nowIso,
          },
        });

      const me = await getPublicUserById(database, req.userId!, req.userId!);
      await createNotification(database, {
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
    } catch (error) {
      console.error('send friend request error:', error);
      return res.status(500).json({ error: 'Failed to send friend request.' });
    }
  });

  router.post('/requests/:id/respond', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const requestId = String(req.params.id);
      const action =
        req.body?.action === 'accept'
          ? 'accepted'
          : req.body?.action === 'reject'
          ? 'rejected'
          : null;
      if (!action) {
        return res.status(400).json({ error: 'Action must be accept or reject.' });
      }

      const rows = await database
        .select()
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.id, requestId),
            eq(friendRequests.receiverId, req.userId!),
            eq(friendRequests.status, 'pending')
          )
        )
        .limit(1);

      const requestRow = rows[0];
      if (!requestRow) {
        return res.status(404).json({ error: 'Pending request not found.' });
      }

      const nowIso = new Date().toISOString();
      const [a, b] = orderPair(requestRow.senderId, requestRow.receiverId);

      await database.transaction(async (tx) => {
        await tx
          .update(friendRequests)
          .set({ status: action, updatedAt: nowIso })
          .where(eq(friendRequests.id, requestRow.id));
        if (action === 'accepted') {
          await tx
            .insert(friendships)
            .values({
              id: crypto.randomUUID(),
              userAId: a,
              userBId: b,
              createdAt: nowIso,
            })
            .onConflictDoNothing();
        }
      });

      if (action === 'accepted') {
        const me = await getPublicUserById(database, req.userId!, req.userId!);
        await createNotification(database, {
          id: crypto.randomUUID(),
          userId: requestRow.senderId,
          type: 'friend_accepted',
          actorId: req.userId!,
          entityId: requestRow.id,
          title: 'Request accepted',
          body: `@${me?.username || 'someone'} accepted your connection request.`,
        });
        getIO()?.to(`user:${requestRow.senderId}`).emit('friend:accepted', { userId: req.userId! });
      }

      return res.json({ status: action });
    } catch (error) {
      console.error('respond friend request error:', error);
      return res.status(500).json({ error: 'Failed to respond to friend request.' });
    }
  });

  router.delete('/:friendId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const friendId = String(req.params.friendId);
      const [a, b] = orderPair(req.userId!, friendId);
      await database
        .delete(friendships)
        .where(and(eq(friendships.userAId, a), eq(friendships.userBId, b)));
      return res.json({ removed: true });
    } catch (error) {
      console.error('remove friend error:', error);
      return res.status(500).json({ error: 'Failed to remove friend.' });
    }
  });

  return router;
}
