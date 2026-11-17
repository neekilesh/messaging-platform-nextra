import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
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

export function createGroupsRouter(db: DatabaseSync) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  router.post('/', requireAuth, (req: AuthedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 240) : '';
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
      new Set([req.userId!, ...rawMemberIds.filter((x): x is string => typeof x === 'string' && x.length > 0)])
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

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO groups (id, name, description, avatar_url, privacy, max_members, creator_id, current_epoch, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(groupId, name, description, avatarUrl, privacy, MAX_GROUP_MEMBERS, req.userId!, nowIso, nowIso);

      db.prepare(
        `INSERT INTO conversations (id, type, group_id, private_pair_key, disappearing_seconds, last_message_at, created_at, updated_at)
         VALUES (?, 'group', ?, NULL, 0, NULL, ?, ?)`
      ).run(convId, groupId, nowIso, nowIso);

      for (const memberId of uniqueMemberIds) {
        const exists = db.prepare(`SELECT id FROM users WHERE id = ?`).get(memberId);
        if (!exists) {
          throw new Error('INVALID_MEMBER');
        }
        const role: GroupRole = memberId === req.userId! ? 'owner' : 'member';
        db.prepare(
          `INSERT INTO group_members (id, group_id, user_id, role, joined_epoch, joined_at)
           VALUES (?, ?, ?, ?, 1, ?)`
        ).run(crypto.randomUUID(), groupId, memberId, role, nowIso);

        db.prepare(
          `INSERT INTO conversation_participants (id, conversation_id, user_id, joined_at)
           VALUES (?, ?, ?, ?)`
        ).run(crypto.randomUUID(), convId, memberId, nowIso);
      }

      for (const env of epochEnvelopes) {
        if (!uniqueMemberIds.includes(env.userId)) continue;
        db.prepare(
          `INSERT INTO group_encryption_states (id, group_id, epoch, user_id, sender_user_id, ephemeral_public_jwk, wrapped_epoch_key, iv, created_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          groupId,
          env.userId,
          req.userId!,
          env.ephemeralPublicJwk,
          env.wrappedEpochKey,
          env.iv,
          nowIso
        );
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      if (err instanceof Error && err.message === 'INVALID_MEMBER') {
        return res.status(400).json({ error: 'One or more selected users do not exist.' });
      }
      throw err;
    }

    const io = getIO();
    const creator = getPublicUserById(db, req.userId!, req.userId!);
    for (const memberId of uniqueMemberIds) {
      if (io) {
        io.in(`user:${memberId}`).socketsJoin(`conv:${convId}`);
        io.to(`user:${memberId}`).emit('group:created', { groupId, conversationId: convId });
      }
      if (memberId !== req.userId!) {
        createNotification(db, {
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

    return res.status(201).json({ groupId, conversationId: convId, memberCount: uniqueMemberIds.length });
  });

  router.get('/:id', requireAuth, (req: AuthedRequest, res) => {
    const groupId = req.params.id;
    const isMember = db
      .prepare(`SELECT role, joined_epoch FROM group_members WHERE group_id = ? AND user_id = ?`)
      .get(groupId, req.userId!) as { role: GroupRole; joined_epoch: number } | undefined;

    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this group.' });
    }

    const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(groupId) as
      | {
          id: string;
          name: string;
          description: string;
          avatar_url: string | null;
          privacy: 'private' | 'invite_only';
          max_members: number;
          creator_id: string;
          current_epoch: number;
          created_at: string;
        }
      | undefined;

    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const conv = db.prepare(`SELECT id FROM conversations WHERE group_id = ?`).get(groupId) as { id: string };

    const memberRows = db
      .prepare(`SELECT user_id, role, joined_epoch, joined_at FROM group_members WHERE group_id = ? ORDER BY joined_at ASC`)
      .all(groupId) as Array<{ user_id: string; role: GroupRole; joined_epoch: number; joined_at: string }>;

    const members = memberRows
      .map((m) => {
        const u = getPublicUserById(db, m.user_id, req.userId!);
        if (!u) return null;
        return {
          userId: m.user_id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          role: m.role,
          joinedEpoch: m.joined_epoch,
          joinedAt: m.joined_at,
          isOnline: u.isOnline,
          ecdhPublicJwk: u.ecdhPublicJwk,
          ecdsaPublicJwk: u.ecdsaPublicJwk,
          fingerprint: u.fingerprint,
        };
      })
      .filter(Boolean);

    const envelopes = db
      .prepare(
        `SELECT epoch, sender_user_id, ephemeral_public_jwk, wrapped_epoch_key, iv
         FROM group_encryption_states
         WHERE group_id = ? AND user_id = ?
         ORDER BY epoch ASC`
      )
      .all(groupId, req.userId!) as Array<{
      epoch: number;
      sender_user_id: string;
      ephemeral_public_jwk: string;
      wrapped_epoch_key: string;
      iv: string;
    }>;

    return res.json({
      group: {
        id: group.id,
        conversationId: conv.id,
        name: group.name,
        description: group.description,
        avatarUrl: group.avatar_url,
        privacy: group.privacy,
        maxMembers: group.max_members,
        creatorId: group.creator_id,
        currentEpoch: group.current_epoch,
        memberCount: members.length,
        members,
        myEpochEnvelopes: envelopes.map((e) => ({
          epoch: e.epoch,
          senderUserId: e.sender_user_id,
          ephemeralPublicJwk: e.ephemeral_public_jwk,
          wrappedEpochKey: e.wrapped_epoch_key,
          iv: e.iv,
        })),
        createdAt: group.created_at,
      },
    });
  });

  router.patch('/:id', requireAuth, (req: AuthedRequest, res) => {
    const groupId = req.params.id;
    const myMembership = db
      .prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`)
      .get(groupId, req.userId!) as { role: GroupRole } | undefined;

    if (!myMembership || (myMembership.role !== 'owner' && myMembership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only group owners or administrators can update group settings.' });
    }

    const current = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(groupId) as
      | { name: string; description: string; avatar_url: string | null; privacy: string }
      | undefined;
    if (!current) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const body = req.body || {};
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : current.name;
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 240) : current.description;
    const avatarUrl = body.avatarUrl !== undefined ? body.avatarUrl : current.avatar_url;
    const privacy = body.privacy === 'invite_only' ? 'invite_only' : body.privacy === 'private' ? 'private' : current.privacy;
    const nowIso = new Date().toISOString();

    db.prepare(`UPDATE groups SET name = ?, description = ?, avatar_url = ?, privacy = ?, updated_at = ? WHERE id = ?`).run(
      name,
      description,
      avatarUrl,
      privacy,
      nowIso,
      groupId
    );

    const conv = db.prepare(`SELECT id FROM conversations WHERE group_id = ?`).get(groupId) as { id: string } | undefined;
    if (conv) {
      getIO()?.to(`conv:${conv.id}`).emit('group:updated', { groupId, conversationId: conv.id });
    }

    return res.json({ success: true });
  });

  router.post('/:id/members', requireAuth, (req: AuthedRequest, res) => {
    const groupId = req.params.id;
    const myMembership = db
      .prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`)
      .get(groupId, req.userId!) as { role: GroupRole } | undefined;

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
    const targetExists = db.prepare(`SELECT id FROM users WHERE id = ?`).get(targetUserId);
    if (!targetExists) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const nowIso = new Date().toISOString();
    let newEpoch = 1;
    let convId = '';

    db.exec('BEGIN IMMEDIATE');
    try {
      const group = db
        .prepare(`SELECT current_epoch, max_members, name FROM groups WHERE id = ?`)
        .get(groupId) as { current_epoch: number; max_members: number; name: string } | undefined;
      if (!group) {
        throw new Error('NOT_FOUND');
      }

      const alreadyMember = db
        .prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?`)
        .get(groupId, targetUserId);
      if (alreadyMember) {
        throw new Error('ALREADY_MEMBER');
      }

      const countRow = db
        .prepare(`SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ?`)
        .get(groupId) as { cnt: number };

      // Strict backend transactional enforcement of 25-member limit!
      if (countRow.cnt >= group.max_members) {
        throw new Error('CAPACITY_EXCEEDED');
      }

      newEpoch = group.current_epoch + 1;
      const conv = db.prepare(`SELECT id FROM conversations WHERE group_id = ?`).get(groupId) as { id: string };
      convId = conv.id;

      db.prepare(`UPDATE groups SET current_epoch = ?, updated_at = ? WHERE id = ?`).run(newEpoch, nowIso, groupId);

      db.prepare(
        `INSERT INTO group_members (id, group_id, user_id, role, joined_epoch, joined_at)
         VALUES (?, ?, ?, 'member', ?, ?)`
      ).run(crypto.randomUUID(), groupId, targetUserId, newEpoch, nowIso);

      db.prepare(
        `INSERT OR IGNORE INTO conversation_participants (id, conversation_id, user_id, joined_at)
         VALUES (?, ?, ?, ?)`
      ).run(crypto.randomUUID(), convId, targetUserId, nowIso);

      // Store rotated new-epoch key envelopes (never expose prior epochs to the new member!)
      const activeMembers = db
        .prepare(`SELECT user_id FROM group_members WHERE group_id = ?`)
        .all(groupId) as Array<{ user_id: string }>;
      const activeSet = new Set(activeMembers.map((m) => m.user_id));

      for (const env of epochEnvelopes) {
        if (!activeSet.has(env.userId)) continue;
        db.prepare(
          `INSERT INTO group_encryption_states (id, group_id, epoch, user_id, sender_user_id, ephemeral_public_jwk, wrapped_epoch_key, iv, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          groupId,
          newEpoch,
          env.userId,
          req.userId!,
          env.ephemeralPublicJwk,
          env.wrappedEpochKey,
          env.iv,
          nowIso
        );
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      if (err instanceof Error) {
        if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Group not found.' });
        if (err.message === 'ALREADY_MEMBER') return res.status(409).json({ error: 'User is already a group member.' });
        if (err.message === 'CAPACITY_EXCEEDED') {
          return res.status(400).json({
            error: `Group capacity reached (${MAX_GROUP_MEMBERS} members maximum).`,
            code: 'GROUP_CAPACITY_EXCEEDED',
          });
        }
      }
      throw err;
    }

    const io = getIO();
    if (io) {
      io.in(`user:${targetUserId}`).socketsJoin(`conv:${convId}`);
      io.to(`conv:${convId}`).emit('group:updated', { groupId, conversationId: convId, epoch: newEpoch });
      io.to(`user:${targetUserId}`).emit('group:created', { groupId, conversationId: convId });
    }

    return res.status(201).json({ added: true, currentEpoch: newEpoch });
  });

  router.delete('/:id/members/:userId', requireAuth, (req: AuthedRequest, res) => {
    const groupId = req.params.id;
    const targetUserId = req.params.userId;
    const isSelfLeave = targetUserId === req.userId;

    const myMembership = db
      .prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`)
      .get(groupId, req.userId!) as { role: GroupRole } | undefined;

    if (!myMembership) {
      return res.status(403).json({ error: 'Not a group member.' });
    }

    const targetMembership = db
      .prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`)
      .get(groupId, targetUserId) as { role: GroupRole } | undefined;

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
        return res.status(403).json({ error: 'Only the group owner can remove an administrator.' });
      }
    } else if (myMembership.role === 'owner') {
      // Promote earliest admin or member if owner leaves, or require deleting group
      const nextOwner = db
        .prepare(
          `SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?
           ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at ASC LIMIT 1`
        )
        .get(groupId, req.userId!) as { user_id: string } | undefined;
      if (!nextOwner) {
        return res.status(400).json({ error: 'Delete the group instead since you are the sole remaining member.' });
      }
    }

    const epochEnvelopes = Array.isArray(req.body?.epochEnvelopes)
      ? (req.body.epochEnvelopes as EpochEnvelopeInput[])
      : [];
    const nowIso = new Date().toISOString();
    let newEpoch = 1;
    let convId = '';

    db.exec('BEGIN IMMEDIATE');
    try {
      const group = db
        .prepare(`SELECT current_epoch FROM groups WHERE id = ?`)
        .get(groupId) as { current_epoch: number };
      const conv = db.prepare(`SELECT id FROM conversations WHERE group_id = ?`).get(groupId) as { id: string };
      convId = conv.id;

      if (isSelfLeave && myMembership.role === 'owner') {
        const nextOwner = db
          .prepare(
            `SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?
             ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at ASC LIMIT 1`
          )
          .get(groupId, req.userId!) as { user_id: string };
        db.prepare(`UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?`).run(
          groupId,
          nextOwner.user_id
        );
        db.prepare(`UPDATE groups SET creator_id = ? WHERE id = ?`).run(nextOwner.user_id, groupId);
      }

      db.prepare(`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`).run(groupId, targetUserId);
      db.prepare(`DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`).run(
        convId,
        targetUserId
      );

      // Increment epoch & rotate keys excluding the removed member so they lose access to future messages!
      newEpoch = group.current_epoch + 1;
      db.prepare(`UPDATE groups SET current_epoch = ?, updated_at = ? WHERE id = ?`).run(newEpoch, nowIso, groupId);

      const remaining = db
        .prepare(`SELECT user_id FROM group_members WHERE group_id = ?`)
        .all(groupId) as Array<{ user_id: string }>;
      const remainingSet = new Set(remaining.map((r) => r.user_id));

      for (const env of epochEnvelopes) {
        if (!remainingSet.has(env.userId)) continue;
        db.prepare(
          `INSERT INTO group_encryption_states (id, group_id, epoch, user_id, sender_user_id, ephemeral_public_jwk, wrapped_epoch_key, iv, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          groupId,
          newEpoch,
          env.userId,
          req.userId!,
          env.ephemeralPublicJwk,
          env.wrappedEpochKey,
          env.iv,
          nowIso
        );
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const io = getIO();
    if (io) {
      io.in(`user:${targetUserId}`).socketsLeave(`conv:${convId}`);
      io.to(`user:${targetUserId}`).emit('group:removed', { groupId, conversationId: convId });
      io.to(`conv:${convId}`).emit('group:updated', { groupId, conversationId: convId, epoch: newEpoch });
    }

    return res.json({ removed: true, currentEpoch: newEpoch });
  });

  router.patch('/:id/members/:userId/role', requireAuth, (req: AuthedRequest, res) => {
    const groupId = req.params.id;
    const targetUserId = req.params.userId;
    const nextRole = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'member' ? 'member' : null;
    if (!nextRole) {
      return res.status(400).json({ error: 'Role must be admin or member.' });
    }

    const myMembership = db
      .prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`)
      .get(groupId, req.userId!) as { role: GroupRole } | undefined;
    if (!myMembership || myMembership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the group owner can manage administrator roles.' });
    }

    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Owner role cannot be downgraded.' });
    }

    const result = db
      .prepare(`UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?`)
      .run(nextRole, groupId, targetUserId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Member not found.' });
    }

    const conv = db.prepare(`SELECT id FROM conversations WHERE group_id = ?`).get(groupId) as { id: string } | undefined;
    if (conv) {
      getIO()?.to(`conv:${conv.id}`).emit('group:updated', { groupId, conversationId: conv.id });
    }
    return res.json({ role: nextRole });
  });

  router.delete('/:id', requireAuth, (req: AuthedRequest, res) => {
    const groupId = req.params.id;
    const myMembership = db
      .prepare(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`)
      .get(groupId, req.userId!) as { role: GroupRole } | undefined;
    if (!myMembership || myMembership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the group owner can delete the group.' });
    }

    const conv = db.prepare(`SELECT id FROM conversations WHERE group_id = ?`).get(groupId) as { id: string } | undefined;
    db.prepare(`DELETE FROM groups WHERE id = ?`).run(groupId);
    if (conv) {
      getIO()?.to(`conv:${conv.id}`).emit('group:deleted', { groupId, conversationId: conv.id });
    }
    return res.json({ deleted: true });
  });

  return router;
}
