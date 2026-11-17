import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createNotification, createRequireAuth, getIO, isBlockedBetween } from '../context.ts';
import type { AuthedRequest } from '../context.ts';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export function createStoriesRouter(db: DatabaseSync) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    const nowIso = new Date().toISOString();

    // Friend IDs
    const friendRows = db
      .prepare(`SELECT user_a_id, user_b_id FROM friendships WHERE user_a_id = ? OR user_b_id = ?`)
      .all(req.userId!, req.userId!) as Array<{ user_a_id: string; user_b_id: string }>;
    const allowedUserIds = new Set<string>([req.userId!]);
    for (const f of friendRows) {
      const peer = f.user_a_id === req.userId ? f.user_b_id : f.user_a_id;
      if (!isBlockedBetween(db, req.userId!, peer)) {
        allowedUserIds.add(peer);
      }
    }

    const storiesRows = db
      .prepare(
        `SELECT s.*, u.username, u.display_name, u.avatar_url
         FROM stories s
         JOIN users u ON u.id = s.user_id
         WHERE s.expires_at > ?
         ORDER BY s.created_at ASC`
      )
      .all(nowIso) as Array<{
      id: string;
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      media_type: 'image' | 'video';
      attachment_id: string;
      ciphertext_meta: string;
      iv: string;
      recipient_envelopes_json: string;
      visibility: 'friends' | 'close_friends';
      expires_at: string;
      created_at: string;
    }>;

    const stories = storiesRows
      .filter((s) => allowedUserIds.has(s.user_id))
      .map((s) => {
        const envelopes = JSON.parse(s.recipient_envelopes_json || '{}') as Record<
          string,
          { ephemeralPublicJwk: string; wrappedKey: string; iv: string }
        >;

        // If close_friends, only author or users included in envelopes can view
        if (s.user_id !== req.userId && !envelopes[req.userId!]) {
          return null;
        }

        const viewedByMe = Boolean(
          db.prepare(`SELECT 1 FROM story_views WHERE story_id = ? AND viewer_id = ?`).get(s.id, req.userId!)
        );
        const viewCountRow = db
          .prepare(`SELECT COUNT(*) as cnt FROM story_views WHERE story_id = ?`)
          .get(s.id) as { cnt: number };

        let viewers = undefined;
        if (s.user_id === req.userId) {
          const viewerRows = db
            .prepare(
              `SELECT sv.viewer_id, sv.viewed_at, u.username, u.display_name, u.avatar_url
               FROM story_views sv
               JOIN users u ON u.id = sv.viewer_id
               WHERE sv.story_id = ?
               ORDER BY sv.viewed_at DESC`
            )
            .all(s.id) as Array<{
            viewer_id: string;
            viewed_at: string;
            username: string;
            display_name: string;
            avatar_url: string | null;
          }>;
          viewers = viewerRows.map((v) => ({
            userId: v.viewer_id,
            username: v.username,
            displayName: v.display_name,
            avatarUrl: v.avatar_url,
            viewedAt: v.viewed_at,
          }));
        }

        const reactionRows = db
          .prepare(
            `SELECT sr.user_id, sr.emoji, sr.created_at, u.username
             FROM story_reactions sr
             JOIN users u ON u.id = sr.user_id
             WHERE sr.story_id = ?`
          )
          .all(s.id) as Array<{ user_id: string; emoji: string; created_at: string; username: string }>;

        return {
          id: s.id,
          userId: s.user_id,
          username: s.username,
          displayName: s.display_name,
          avatarUrl: s.avatar_url,
          mediaType: s.media_type,
          attachmentId: s.attachment_id,
          ciphertextMeta: s.ciphertext_meta,
          iv: s.iv,
          recipientEnvelopes: envelopes[req.userId!] ? { [req.userId!]: envelopes[req.userId!] } : {},
          visibility: s.visibility,
          expiresAt: s.expires_at,
          createdAt: s.created_at,
          viewedByMe,
          viewCount: viewCountRow.cnt,
          ...(viewers ? { viewers } : {}),
          reactions: reactionRows.map((r) => ({
            userId: r.user_id,
            username: r.username,
            emoji: r.emoji,
            createdAt: r.created_at,
          })),
        };
      })
      .filter(Boolean);

    return res.json({ stories });
  });

  router.post('/', requireAuth, (req: AuthedRequest, res) => {
    const body = req.body || {};
    const mediaType = body.mediaType === 'video' ? 'video' : 'image';
    const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : '';
    const ciphertextMeta = typeof body.ciphertextMeta === 'string' ? body.ciphertextMeta : '';
    const iv = typeof body.iv === 'string' ? body.iv : '';
    const recipientEnvelopes = body.recipientEnvelopes ? JSON.stringify(body.recipientEnvelopes) : '{}';
    const visibility = body.visibility === 'close_friends' ? 'close_friends' : 'friends';

    if (!attachmentId || !ciphertextMeta || !iv) {
      return res.status(400).json({ error: 'Encrypted story media and metadata are required.' });
    }

    const att = db
      .prepare(`SELECT id, uploader_id FROM message_attachments WHERE id = ?`)
      .get(attachmentId) as { id: string; uploader_id: string } | undefined;
    if (!att || att.uploader_id !== req.userId) {
      return res.status(403).json({ error: 'Invalid story attachment.' });
    }

    const storyId = crypto.randomUUID();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + STORY_TTL_MS).toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO stories (id, user_id, media_type, attachment_id, ciphertext_meta, iv, recipient_envelopes_json, visibility, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(storyId, req.userId!, mediaType, attachmentId, ciphertextMeta, iv, recipientEnvelopes, visibility, expiresAt, nowIso);

      db.prepare(`UPDATE message_attachments SET story_id = ?, expires_at = ? WHERE id = ?`).run(
        storyId,
        expiresAt,
        attachmentId
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    getIO()?.emit('story:new', { userId: req.userId!, storyId });
    return res.status(201).json({ id: storyId, expiresAt });
  });

  router.post('/:id/view', requireAuth, (req: AuthedRequest, res) => {
    const story = db
      .prepare(`SELECT id, user_id, expires_at FROM stories WHERE id = ?`)
      .get(req.params.id) as { id: string; user_id: string; expires_at: string } | undefined;

    if (!story || Date.parse(story.expires_at) <= Date.now()) {
      return res.status(404).json({ error: 'Story not found or expired.' });
    }

    if (story.user_id !== req.userId) {
      db.prepare(
        `INSERT OR IGNORE INTO story_views (id, story_id, viewer_id, viewed_at) VALUES (?, ?, ?, ?)`
      ).run(crypto.randomUUID(), story.id, req.userId!, new Date().toISOString());
    }

    return res.json({ viewed: true });
  });

  router.post('/:id/react', requireAuth, (req: AuthedRequest, res) => {
    const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 16) : '';
    if (!emoji) {
      return res.status(400).json({ error: 'Emoji is required.' });
    }

    const story = db
      .prepare(`SELECT id, user_id, expires_at FROM stories WHERE id = ?`)
      .get(req.params.id) as { id: string; user_id: string; expires_at: string } | undefined;

    if (!story || Date.parse(story.expires_at) <= Date.now()) {
      return res.status(404).json({ error: 'Story not found or expired.' });
    }

    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO story_reactions (id, story_id, user_id, emoji, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(story_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`
    ).run(crypto.randomUUID(), story.id, req.userId!, emoji, nowIso);

    if (story.user_id !== req.userId) {
      const actor = db.prepare(`SELECT username FROM users WHERE id = ?`).get(req.userId!) as
        | { username: string }
        | undefined;
      createNotification(db, {
        id: crypto.randomUUID(),
        userId: story.user_id,
        type: 'story_reaction',
        actorId: req.userId!,
        entityId: story.id,
        title: 'Story reaction',
        body: `@${actor?.username || 'someone'} reacted ${emoji} to your story.`,
      });
    }

    return res.json({ reacted: true, emoji });
  });

  router.delete('/:id', requireAuth, (req: AuthedRequest, res) => {
    const result = db.prepare(`DELETE FROM stories WHERE id = ? AND user_id = ?`).run(req.params.id, req.userId!);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Story not found.' });
    }
    return res.json({ deleted: true });
  });

  return router;
}
