import crypto from 'node:crypto';
import { Router } from 'express';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import {
  conversationParticipants,
  conversations,
  groupEncryptionStates,
  groupMembers,
  groups,
  users,
} from '../../src/db/schema.ts';
import { createNotification, createRequireAuth, getIO, getPublicUserById } from '../context.ts';
import type { AuthedRequest } from '../context.ts';
import type { GroupRole } from '../../src/types/nexora.ts';

export const MAX_GROUP_MEMBERS = 25;

interface EpochEnvelopeInput {
  userId: string;
  ephemeralPublicJwk: string;
  wrappedEpochKey: string;
  iv: string;
}

export function createGroupsRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  router.post('/', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 240) : '';
      const avatarUrl = typeof req.body?.avatarUrl === 'string' ? req.body.avatarUrl : null;
      const privacy = req.body?.privacy === 'invite_only' ? 'invite_only' : 'private';
      const rawMemberIds = Array.isArray(req.body?.memberIds) ? (req.body.memberIds as unknown[]) : [];
      const epochEnvelopes = Array.isArray(req.body?.epochEnvelopes)
        ? (req.body.epochEnvelopes as EpochEnvelopeInput[])
        : [];

      if (!name) {
        return res.status(400).json({ error: 'Group name is required.' });
      }

      const uniqueMemberIds = Array.from(
        new Set([
          req.userId!,
          ...rawMemberIds.filter((x): x is string => typeof x === 'string' && x.length > 0),
        ])
      );

      if (uniqueMemberIds.length > MAX_GROUP_MEMBERS) {
        return res.status(400).json({
          error: `Groups can have at most ${MAX_GROUP_MEMBERS} members including the creator.`,
          code: 'GROUP_CAPACITY_EXCEEDED',
        });
      }

      const groupId = crypto.randomUUID();
      const convId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      await database.transaction(async (tx) => {
        await tx.insert(groups).values({
          id: groupId,
          name,
          description,
          avatarUrl,
          privacy,
          maxMembers: MAX_GROUP_MEMBERS,
          creatorId: req.userId!,
          currentEpoch: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await tx.insert(conversations).values({
          id: convId,
          type: 'group',
          groupId,
          privatePairKey: null,
          disappearingSeconds: 0,
          lastMessageAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        for (const memberId of uniqueMemberIds) {
          const exists = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, memberId))
            .limit(1);
          if (exists.length === 0) {
            throw new Error('INVALID_MEMBER');
          }
          const role: GroupRole = memberId === req.userId! ? 'owner' : 'member';
          await tx.insert(groupMembers).values({
            id: crypto.randomUUID(),
            groupId,
            userId: memberId,
            role,
            joinedEpoch: 1,
            joinedAt: nowIso,
          });

          await tx.insert(conversationParticipants).values({
            id: crypto.randomUUID(),
            conversationId: convId,
            userId: memberId,
            joinedAt: nowIso,
          });
        }

        for (const env of epochEnvelopes) {
          if (!uniqueMemberIds.includes(env.userId)) continue;
          await tx.insert(groupEncryptionStates).values({
            id: crypto.randomUUID(),
            groupId,
            epoch: 1,
            userId: env.userId,
            senderUserId: req.userId!,
            ephemeralPublicJwk: env.ephemeralPublicJwk,
            wrappedEpochKey: env.wrappedEpochKey,
            iv: env.iv,
            createdAt: nowIso,
          });
        }
      });

      const io = getIO();
      const creator = await getPublicUserById(database, req.userId!, req.userId!);
      for (const memberId of uniqueMemberIds) {
        if (io) {
          io.in(`user:${memberId}`).socketsJoin(`conv:${convId}`);
          io.to(`user:${memberId}`).emit('group:created', { groupId, conversationId: convId });
        }
        if (memberId !== req.userId!) {
          await createNotification(database, {
            id: crypto.randomUUID(),
            userId: memberId,
            type: 'group_added',
            actorId: req.userId!,
            entityId: groupId,
            title: 'Added to encrypted group',
            body: `@${creator?.username || 'someone'} added you to ${name}.`,
          });
        }
      }

      return res
        .status(201)
        .json({ groupId, conversationId: convId, memberCount: uniqueMemberIds.length });
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_MEMBER') {
        return res.status(400).json({ error: 'One or more selected users do not exist.' });
      }
      console.error('create group error:', err);
      return res.status(500).json({ error: 'Failed to create group.' });
    }
  });

  router.get('/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const groupId = String(req.params.id);
      const membershipRows = await database
        .select({
          role: groupMembers.role,
          joinedEpoch: groupMembers.joinedEpoch,
        })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, req.userId!)))
        .limit(1);

      if (membershipRows.length === 0) {
        return res.status(403).json({ error: 'Not a member of this group.' });
      }

      const groupRows = await database.select().from(groups).where(eq(groups.id, groupId)).limit(1);
      const group = groupRows[0];
      if (!group) {
        return res.status(404).json({ error: 'Group not found.' });
      }

      const convRows = await database
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.groupId, groupId))
        .limit(1);
      const conv = convRows[0];

      const memberRows = await database
        .select({
          userId: groupMembers.userId,
          role: groupMembers.role,
          joinedEpoch: groupMembers.joinedEpoch,
          joinedAt: groupMembers.joinedAt,
        })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, groupId))
        .orderBy(asc(groupMembers.joinedAt));

      const members = [];
      for (const m of memberRows) {
        const u = await getPublicUserById(database, m.userId, req.userId!);
        if (!u) continue;
        members.push({
          userId: m.userId,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          role: m.role as GroupRole,
          joinedEpoch: m.joinedEpoch,
          joinedAt: m.joinedAt,
          isOnline: u.isOnline,
          ecdhPublicJwk: u.ecdhPublicJwk,
          ecdsaPublicJwk: u.ecdsaPublicJwk,
          fingerprint: u.fingerprint,
        });
      }

      const envelopes = await database
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
            eq(groupEncryptionStates.groupId, groupId),
            eq(groupEncryptionStates.userId, req.userId!)
          )
        )
        .orderBy(asc(groupEncryptionStates.epoch));

      return res.json({
        group: {
          id: group.id,
          conversationId: conv?.id || '',
          name: group.name,
          description: group.description,
          avatarUrl: group.avatarUrl,
          privacy: group.privacy as 'private' | 'invite_only',
          maxMembers: group.maxMembers,
          creatorId: group.creatorId,
          currentEpoch: group.currentEpoch,
          memberCount: members.length,
          members,
          myEpochEnvelopes: envelopes,
          createdAt: group.createdAt,
        },
      });
    } catch (error) {
      console.error('get group error:', error);
      return res.status(500).json({ error: 'Failed to load group details.' });
    }
  });

  router.patch('/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const groupId = String(req.params.id);
      const membershipRows = await database
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, req.userId!)))
        .limit(1);
      const myMembership = membershipRows[0];

      if (!myMembership || (myMembership.role !== 'owner' && myMembership.role !== 'admin')) {
        return res
          .status(403)
          .json({ error: 'Only group owners or administrators can update group settings.' });
      }

      const currentRows = await database
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);
      const current = currentRows[0];
      if (!current) {
        return res.status(404).json({ error: 'Group not found.' });
      }

      const body = req.body || {};
      const name =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 60)
          : current.name;
      const description =
        typeof body.description === 'string'
          ? body.description.trim().slice(0, 240)
          : current.description;
      const avatarUrl = body.avatarUrl !== undefined ? body.avatarUrl : current.avatarUrl;
      const privacy =
        body.privacy === 'invite_only'
          ? 'invite_only'
          : body.privacy === 'private'
          ? 'private'
          : current.privacy;
      const nowIso = new Date().toISOString();

      await database
        .update(groups)
        .set({ name, description, avatarUrl, privacy, updatedAt: nowIso })
        .where(eq(groups.id, groupId));

      const convRows = await database
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.groupId, groupId))
        .limit(1);
      if (convRows[0]) {
        getIO()?.to(`conv:${convRows[0].id}`).emit('group:updated', {
          groupId,
          conversationId: convRows[0].id,
        });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('update group error:', error);
      return res.status(500).json({ error: 'Failed to update group settings.' });
    }
  });

  router.post('/:id/members', requireAuth, async (req: AuthedRequest, res) => {
    const groupId = String(req.params.id);
    try {
      const membershipRows = await database
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, req.userId!)))
        .limit(1);
      const myMembership = membershipRows[0];

      if (!myMembership || (myMembership.role !== 'owner' && myMembership.role !== 'admin')) {
        return res.status(403).json({ error: 'Only owners and administrators can add members.' });
      }

      const targetUserId = typeof req.body?.userId === 'string' ? req.body.userId : '';
      const epochEnvelopes = Array.isArray(req.body?.epochEnvelopes)
        ? (req.body.epochEnvelopes as EpochEnvelopeInput[])
        : [];

      if (!targetUserId) {
        return res.status(400).json({ error: 'Target userId is required.' });
      }
      const targetExists = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);
      if (targetExists.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const nowIso = new Date().toISOString();
      let newEpoch = 1;
      let convId = '';

      await database.transaction(async (tx) => {
        const groupRows = await tx
          .select({
            currentEpoch: groups.currentEpoch,
            maxMembers: groups.maxMembers,
            name: groups.name,
          })
          .from(groups)
          .where(eq(groups.id, groupId))
          .limit(1);
        const group = groupRows[0];
        if (!group) throw new Error('NOT_FOUND');

        const alreadyMember = await tx
          .select({ id: groupMembers.id })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
          .limit(1);
        if (alreadyMember.length > 0) throw new Error('ALREADY_MEMBER');

        const countRows = await tx
          .select({ cnt: count() })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, groupId));
        if (Number(countRows[0]?.cnt || 0) >= group.maxMembers) {
          throw new Error('CAPACITY_EXCEEDED');
        }

        newEpoch = group.currentEpoch + 1;
        const convRows = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.groupId, groupId))
          .limit(1);
        convId = convRows[0].id;

        await tx
          .update(groups)
          .set({ currentEpoch: newEpoch, updatedAt: nowIso })
          .where(eq(groups.id, groupId));

        await tx.insert(groupMembers).values({
          id: crypto.randomUUID(),
          groupId,
          userId: targetUserId,
          role: 'member',
          joinedEpoch: newEpoch,
          joinedAt: nowIso,
        });

        await tx
          .insert(conversationParticipants)
          .values({
            id: crypto.randomUUID(),
            conversationId: convId,
            userId: targetUserId,
            joinedAt: nowIso,
          })
          .onConflictDoNothing();

        const activeMembers = await tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, groupId));
        const activeSet = new Set(activeMembers.map((m) => m.userId));

        for (const env of epochEnvelopes) {
          if (!activeSet.has(env.userId)) continue;
          await tx.insert(groupEncryptionStates).values({
            id: crypto.randomUUID(),
            groupId,
            epoch: newEpoch,
            userId: env.userId,
            senderUserId: req.userId!,
            ephemeralPublicJwk: env.ephemeralPublicJwk,
            wrappedEpochKey: env.wrappedEpochKey,
            iv: env.iv,
            createdAt: nowIso,
          });
        }
      });

      const io = getIO();
      if (io) {
        io.in(`user:${targetUserId}`).socketsJoin(`conv:${convId}`);
        io.to(`conv:${convId}`).emit('group:updated', {
          groupId,
          conversationId: convId,
          epoch: newEpoch,
        });
        io.to(`user:${targetUserId}`).emit('group:created', { groupId, conversationId: convId });
      }

      return res.status(201).json({ added: true, currentEpoch: newEpoch });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Group not found.' });
        if (err.message === 'ALREADY_MEMBER') {
          return res.status(409).json({ error: 'User is already a group member.' });
        }
        if (err.message === 'CAPACITY_EXCEEDED') {
          return res.status(400).json({
            error: `Group capacity reached (${MAX_GROUP_MEMBERS} members maximum).`,
            code: 'GROUP_CAPACITY_EXCEEDED',
          });
        }
      }
      console.error('add group member error:', err);
      return res.status(500).json({ error: 'Failed to add member.' });
    }
  });

  router.delete('/:id/members/:userId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const groupId = String(req.params.id);
      const targetUserId = String(req.params.userId);
      const isSelfLeave = targetUserId === req.userId;

      const myRows = await database
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, req.userId!)))
        .limit(1);
      const myMembership = myRows[0];

      if (!myMembership) {
        return res.status(403).json({ error: 'Not a group member.' });
      }

      const targetRows = await database
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
        .limit(1);
      const targetMembership = targetRows[0];

      if (!targetMembership) {
        return res.status(404).json({ error: 'Member not found in group.' });
      }

      if (!isSelfLeave) {
        if (myMembership.role === 'member') {
          return res.status(403).json({ error: 'Insufficient permissions to remove members.' });
        }
        if (targetMembership.role === 'owner') {
          return res.status(403).json({ error: 'Group owner cannot be removed.' });
        }
        if (myMembership.role === 'admin' && targetMembership.role === 'admin') {
          return res
            .status(403)
            .json({ error: 'Only the group owner can remove an administrator.' });
        }
      } else if (myMembership.role === 'owner') {
        const nextOwners = await database
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), ne(groupMembers.userId, req.userId!)))
          .orderBy(
            sql`CASE ${groupMembers.role} WHEN 'admin' THEN 0 ELSE 1 END`,
            asc(groupMembers.joinedAt)
          )
          .limit(1);
        if (nextOwners.length === 0) {
          return res
            .status(400)
            .json({ error: 'Delete the group instead since you are the sole remaining member.' });
        }
      }

      const epochEnvelopes = Array.isArray(req.body?.epochEnvelopes)
        ? (req.body.epochEnvelopes as EpochEnvelopeInput[])
        : [];
      const nowIso = new Date().toISOString();
      let newEpoch = 1;
      let convId = '';

      await database.transaction(async (tx) => {
        const groupRows = await tx
          .select({ currentEpoch: groups.currentEpoch })
          .from(groups)
          .where(eq(groups.id, groupId))
          .limit(1);
        const convRows = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.groupId, groupId))
          .limit(1);
        const group = groupRows[0];
        convId = convRows[0].id;

        if (isSelfLeave && myMembership.role === 'owner') {
          const nextOwners = await tx
            .select({ userId: groupMembers.userId })
            .from(groupMembers)
            .where(and(eq(groupMembers.groupId, groupId), ne(groupMembers.userId, req.userId!)))
            .orderBy(
              sql`CASE ${groupMembers.role} WHEN 'admin' THEN 0 ELSE 1 END`,
              asc(groupMembers.joinedAt)
            )
            .limit(1);
          const nextOwner = nextOwners[0];
          await tx
            .update(groupMembers)
            .set({ role: 'owner' })
            .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, nextOwner.userId)));
          await tx
            .update(groups)
            .set({ creatorId: nextOwner.userId })
            .where(eq(groups.id, groupId));
        }

        await tx
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));
        await tx
          .delete(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, convId),
              eq(conversationParticipants.userId, targetUserId)
            )
          );

        newEpoch = group.currentEpoch + 1;
        await tx
          .update(groups)
          .set({ currentEpoch: newEpoch, updatedAt: nowIso })
          .where(eq(groups.id, groupId));

        const remaining = await tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, groupId));
        const remainingSet = new Set(remaining.map((r) => r.userId));

        for (const env of epochEnvelopes) {
          if (!remainingSet.has(env.userId)) continue;
          await tx.insert(groupEncryptionStates).values({
            id: crypto.randomUUID(),
            groupId,
            epoch: newEpoch,
            userId: env.userId,
            senderUserId: req.userId!,
            ephemeralPublicJwk: env.ephemeralPublicJwk,
            wrappedEpochKey: env.wrappedEpochKey,
            iv: env.iv,
            createdAt: nowIso,
          });
        }
      });

      const io = getIO();
      if (io) {
        io.in(`user:${targetUserId}`).socketsLeave(`conv:${convId}`);
        io.to(`user:${targetUserId}`).emit('group:removed', { groupId, conversationId: convId });
        io.to(`conv:${convId}`).emit('group:updated', {
          groupId,
          conversationId: convId,
          epoch: newEpoch,
        });
      }

      return res.json({ removed: true, currentEpoch: newEpoch });
    } catch (error) {
      console.error('remove group member error:', error);
      return res.status(500).json({ error: 'Failed to remove group member.' });
    }
  });

  router.patch('/:id/members/:userId/role', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const groupId = String(req.params.id);
      const targetUserId = String(req.params.userId);
      const nextRole =
        req.body?.role === 'admin' ? 'admin' : req.body?.role === 'member' ? 'member' : null;
      if (!nextRole) {
        return res.status(400).json({ error: 'Role must be admin or member.' });
      }

      const myRows = await database
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, req.userId!)))
        .limit(1);
      if (!myRows[0] || myRows[0].role !== 'owner') {
        return res
          .status(403)
          .json({ error: 'Only the group owner can manage administrator roles.' });
      }

      if (targetUserId === req.userId) {
        return res.status(400).json({ error: 'Owner role cannot be downgraded.' });
      }

      const updated = await database
        .update(groupMembers)
        .set({ role: nextRole })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
        .returning({ id: groupMembers.id });

      if (updated.length === 0) {
        return res.status(404).json({ error: 'Member not found.' });
      }

      const convRows = await database
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.groupId, groupId))
        .limit(1);
      if (convRows[0]) {
        getIO()?.to(`conv:${convRows[0].id}`).emit('group:updated', {
          groupId,
          conversationId: convRows[0].id,
        });
      }
      return res.json({ role: nextRole });
    } catch (error) {
      console.error('update member role error:', error);
      return res.status(500).json({ error: 'Failed to update member role.' });
    }
  });

  router.delete('/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const groupId = String(req.params.id);
      const myRows = await database
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, req.userId!)))
        .limit(1);
      if (!myRows[0] || myRows[0].role !== 'owner') {
        return res.status(403).json({ error: 'Only the group owner can delete the group.' });
      }

      const convRows = await database
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.groupId, groupId))
        .limit(1);
      await database.delete(groups).where(eq(groups.id, groupId));
      if (convRows[0]) {
        getIO()?.to(`conv:${convRows[0].id}`).emit('group:deleted', {
          groupId,
          conversationId: convRows[0].id,
        });
      }
      return res.json({ deleted: true });
    } catch (error) {
      console.error('delete group error:', error);
      return res.status(500).json({ error: 'Failed to delete group.' });
    }
  });

  return router;
}
