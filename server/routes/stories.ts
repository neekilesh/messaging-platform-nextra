import crypto from 'node:crypto';
import { Router } from 'express';
import { and, asc, count, desc, eq, gt, or } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import {
  friendships,
  messageAttachments,
  stories,
  storyReactions,
  storyViews,
  users,
} from '../../src/db/schema.ts';
import { createNotification, createRequireAuth, getIO, isBlockedBetween } from '../context.ts';
import type { AuthedRequest } from '../context.ts';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export function createStoriesRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  router.get('/', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const nowIso = new Date().toISOString();

      const friendRows = await database
        .select({
          userAId: friendships.userAId,
          userBId: friendships.userBId,
        })
        .from(friendships)
        .where(
          or(eq(friendships.userAId, req.userId!), eq(friendships.userBId, req.userId!))
        );

      const allowedUserIds = new Set<string>([req.userId!]);
      for (const f of friendRows) {
        const peer = f.userAId === req.userId ? f.userBId : f.userAId;
        if (!(await isBlockedBetween(database, req.userId!, peer))) {
          allowedUserIds.add(peer);
        }
      }

      const storiesRows = await database
        .select({
          id: stories.id,
          userId: stories.userId,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          mediaType: stories.mediaType,
          attachmentId: stories.attachmentId,
          ciphertextMeta: stories.ciphertextMeta,
          iv: stories.iv,
          recipientEnvelopesJson: stories.recipientEnvelopesJson,
          visibility: stories.visibility,
          expiresAt: stories.expiresAt,
          createdAt: stories.createdAt,
        })
        .from(stories)
        .innerJoin(users, eq(users.id, stories.userId))
        .where(gt(stories.expiresAt, nowIso))
        .orderBy(asc(stories.createdAt));

      const result = [];
      for (const s of storiesRows) {
        if (!allowedUserIds.has(s.userId)) continue;
        const envelopes = JSON.parse(s.recipientEnvelopesJson || '{}') as Record<
          string,
          { ephemeralPublicJwk: string; wrappedKey: string; iv: string }
        >;

        if (s.userId !== req.userId && !envelopes[req.userId!]) {
          continue;
        }

        const viewedRows = await database
          .select({ id: storyViews.id })
          .from(storyViews)
          .where(and(eq(storyViews.storyId, s.id), eq(storyViews.viewerId, req.userId!)))
          .limit(1);
        const viewedByMe = viewedRows.length > 0;

        const viewCountRows = await database
          .select({ cnt: count() })
          .from(storyViews)
          .where(eq(storyViews.storyId, s.id));
        const viewCount = Number(viewCountRows[0]?.cnt || 0);

        let viewers = undefined;
        if (s.userId === req.userId) {
          const viewerRows = await database
            .select({
              viewerId: storyViews.viewerId,
              viewedAt: storyViews.viewedAt,
              username: users.username,
              displayName: users.displayName,
              avatarUrl: users.avatarUrl,
            })
            .from(storyViews)
            .innerJoin(users, eq(users.id, storyViews.viewerId))
            .where(eq(storyViews.storyId, s.id))
            .orderBy(desc(storyViews.viewedAt));

          viewers = viewerRows.map((v) => ({
            userId: v.viewerId,
            username: v.username,
            displayName: v.displayName,
            avatarUrl: v.avatarUrl,
            viewedAt: v.viewedAt,
          }));
        }

        const reactionRows = await database
          .select({
            userId: storyReactions.userId,
            emoji: storyReactions.emoji,
            createdAt: storyReactions.createdAt,
            username: users.username,
          })
          .from(storyReactions)
          .innerJoin(users, eq(users.id, storyReactions.userId))
          .where(eq(storyReactions.storyId, s.id));

        result.push({
          id: s.id,
          userId: s.userId,
          username: s.username,
          displayName: s.displayName,
          avatarUrl: s.avatarUrl,
          mediaType: s.mediaType as 'image' | 'video',
          attachmentId: s.attachmentId,
          ciphertextMeta: s.ciphertextMeta,
          iv: s.iv,
          recipientEnvelopes: envelopes[req.userId!] ? { [req.userId!]: envelopes[req.userId!] } : {},
          visibility: s.visibility as 'friends' | 'close_friends',
          expiresAt: s.expiresAt,
          createdAt: s.createdAt,
          viewedByMe,
          viewCount,
          ...(viewers ? { viewers } : {}),
          reactions: reactionRows.map((r) => ({
            userId: r.userId,
            username: r.username,
            emoji: r.emoji,
            createdAt: r.createdAt,
          })),
        });
      }

      return res.json({ stories: result });
    } catch (error) {
      console.error('list stories error:', error);
      return res.status(500).json({ error: 'Failed to load stories.' });
    }
  });

  router.post('/', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const mediaType = body.mediaType === 'video' ? 'video' : 'image';
      const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : '';
      const ciphertextMeta = typeof body.ciphertextMeta === 'string' ? body.ciphertextMeta : '';
      const iv = typeof body.iv === 'string' ? body.iv : '';
      const recipientEnvelopes = body.recipientEnvelopes
        ? JSON.stringify(body.recipientEnvelopes)
        : '{}';
      const visibility = body.visibility === 'close_friends' ? 'close_friends' : 'friends';

      if (!attachmentId || !ciphertextMeta || !iv) {
        return res.status(400).json({ error: 'Encrypted story media and metadata are required.' });
      }

      const attRows = await database
        .select({ id: messageAttachments.id, uploaderId: messageAttachments.uploaderId })
        .from(messageAttachments)
        .where(eq(messageAttachments.id, attachmentId))
        .limit(1);
      const att = attRows[0];
      if (!att || att.uploaderId !== req.userId) {
        return res.status(403).json({ error: 'Invalid story attachment.' });
      }

      const storyId = crypto.randomUUID();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + STORY_TTL_MS).toISOString();

      await database.transaction(async (tx) => {
        await tx.insert(stories).values({
          id: storyId,
          userId: req.userId!,
          mediaType,
          attachmentId,
          ciphertextMeta,
          iv,
          recipientEnvelopesJson: recipientEnvelopes,
          visibility,
          expiresAt,
          createdAt: nowIso,
        });

        await tx
          .update(messageAttachments)
          .set({ storyId, expiresAt })
          .where(eq(messageAttachments.id, attachmentId));
      });

      getIO()?.emit('story:new', { userId: req.userId!, storyId });
      return res.status(201).json({ id: storyId, expiresAt });
    } catch (error) {
      console.error('create story error:', error);
      return res.status(500).json({ error: 'Failed to publish story.' });
    }
  });

  router.post('/:id/view', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const storyId = String(req.params.id);
      const rows = await database
        .select({ id: stories.id, userId: stories.userId, expiresAt: stories.expiresAt })
        .from(stories)
        .where(eq(stories.id, storyId))
        .limit(1);
      const story = rows[0];

      if (!story || Date.parse(story.expiresAt) <= Date.now()) {
        return res.status(404).json({ error: 'Story not found or expired.' });
      }

      if (story.userId !== req.userId) {
        await database
          .insert(storyViews)
          .values({
            id: crypto.randomUUID(),
            storyId: story.id,
            viewerId: req.userId!,
            viewedAt: new Date().toISOString(),
          })
          .onConflictDoNothing();
      }

      return res.json({ viewed: true });
    } catch (error) {
      console.error('view story error:', error);
      return res.status(500).json({ error: 'Failed to record story view.' });
    }
  });

  router.post('/:id/react', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const storyId = String(req.params.id);
      const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 16) : '';
      if (!emoji) {
        return res.status(400).json({ error: 'Emoji is required.' });
      }

      const rows = await database
        .select({ id: stories.id, userId: stories.userId, expiresAt: stories.expiresAt })
        .from(stories)
        .where(eq(stories.id, storyId))
        .limit(1);
      const story = rows[0];

      if (!story || Date.parse(story.expiresAt) <= Date.now()) {
        return res.status(404).json({ error: 'Story not found or expired.' });
      }

      const nowIso = new Date().toISOString();
      await database
        .insert(storyReactions)
        .values({
          id: crypto.randomUUID(),
          storyId: story.id,
          userId: req.userId!,
          emoji,
          createdAt: nowIso,
        })
        .onConflictDoUpdate({
          target: [storyReactions.storyId, storyReactions.userId],
          set: { emoji, createdAt: nowIso },
        });

      if (story.userId !== req.userId) {
        const actorRows = await database
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, req.userId!))
          .limit(1);
        await createNotification(database, {
          id: crypto.randomUUID(),
          userId: story.userId,
          type: 'story_reaction',
          actorId: req.userId!,
          entityId: story.id,
          title: 'Story reaction',
          body: `@${actorRows[0]?.username || 'someone'} reacted ${emoji} to your story.`,
        });
      }

      return res.json({ reacted: true, emoji });
    } catch (error) {
      console.error('react story error:', error);
      return res.status(500).json({ error: 'Failed to react to story.' });
    }
  });

  router.delete('/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const storyId = String(req.params.id);
      const deleted = await database
        .delete(stories)
        .where(and(eq(stories.id, storyId), eq(stories.userId, req.userId!)))
        .returning({ id: stories.id });

      if (deleted.length === 0) {
        return res.status(404).json({ error: 'Story not found.' });
      }
      return res.json({ deleted: true });
    } catch (error) {
      console.error('delete story error:', error);
      return res.status(500).json({ error: 'Failed to delete story.' });
    }
  });

  return router;
}
