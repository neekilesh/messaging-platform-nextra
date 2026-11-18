import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import {
  conversationParticipants,
  friendships,
  messageAttachments,
  stories,
} from '../../src/db/schema.ts';
import { createRequireAuth } from '../context.ts';
import type { AuthedRequest } from '../context.ts';

function resolveUploadsDir(): string {
  const preferred = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads', 'encrypted');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'nexora', 'uploads', 'encrypted');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const UPLOADS_DIR = resolveUploadsDir();
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'application/pdf', 'text/plain', 'application/zip'];

function isMimeAllowed(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

export function createMediaRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  router.post(
    '/upload',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: MAX_MEDIA_BYTES }),
    async (req: AuthedRequest, res) => {
      try {
        const encryptedBuf = req.body as Buffer;
        if (!Buffer.isBuffer(encryptedBuf) || encryptedBuf.length === 0) {
          return res.status(400).json({ error: 'Encrypted media payload is required.' });
        }
        if (encryptedBuf.length > MAX_MEDIA_BYTES) {
          return res.status(413).json({ error: 'Encrypted file exceeds 25MB limit.' });
        }

        const conversationId =
          typeof req.headers['x-nexora-conversation-id'] === 'string'
            ? req.headers['x-nexora-conversation-id']
            : null;
        const isStory = req.headers['x-nexora-story'] === '1';
        const mimeType =
          typeof req.headers['x-nexora-mime-type'] === 'string'
            ? req.headers['x-nexora-mime-type']
            : 'application/octet-stream';
        const originalSize = Number(req.headers['x-nexora-original-size'] || encryptedBuf.length);
        const durationMs = req.headers['x-nexora-duration-ms']
          ? Number(req.headers['x-nexora-duration-ms'])
          : null;

        if (!isMimeAllowed(mimeType)) {
          return res.status(400).json({ error: 'Unsupported media file type.' });
        }

        if (conversationId) {
          const member = await database
            .select({ id: conversationParticipants.id })
            .from(conversationParticipants)
            .where(
              and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.userId, req.userId!)
              )
            )
            .limit(1);
          if (member.length === 0) {
            return res.status(403).json({ error: 'Unauthorized conversation upload.' });
          }
        } else if (!isStory) {
          return res.status(400).json({ error: 'Target conversation or story context required.' });
        }

        const attachmentId = crypto.randomUUID();
        const fileName = `${attachmentId}.enc`;
        const storagePath = path.join(UPLOADS_DIR, fileName);
        const sha256Ciphertext = crypto.createHash('sha256').update(encryptedBuf).digest('base64');
        const nowIso = new Date().toISOString();

        fs.writeFileSync(storagePath, encryptedBuf);

        await database.insert(messageAttachments).values({
          id: attachmentId,
          uploaderId: req.userId!,
          conversationId,
          storyId: null,
          mimeType,
          originalSize,
          encryptedSize: encryptedBuf.length,
          storagePath,
          sha256Ciphertext,
          durationMs,
          createdAt: nowIso,
        });

        return res.status(201).json({
          attachmentId,
          encryptedSize: encryptedBuf.length,
          sha256Ciphertext,
        });
      } catch (error) {
        console.error('media upload error:', error);
        return res.status(500).json({ error: 'Failed to store encrypted media.' });
      }
    }
  );

  router.get('/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const attId = String(req.params.id);
      const rows = await database
        .select()
        .from(messageAttachments)
        .where(eq(messageAttachments.id, attId))
        .limit(1);

      const attachment = rows[0];
      if (!attachment) {
        return res.status(404).json({ error: 'Encrypted media not found.' });
      }

      if (attachment.expiresAt && Date.parse(attachment.expiresAt) <= Date.now()) {
        return res.status(410).json({ error: 'Media has expired.' });
      }

      let authorized = attachment.uploaderId === req.userId;

      if (!authorized && attachment.conversationId) {
        const participant = await database
          .select({ id: conversationParticipants.id })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, attachment.conversationId),
              eq(conversationParticipants.userId, req.userId!)
            )
          )
          .limit(1);
        authorized = participant.length > 0;
      }

      if (!authorized) {
        const storyRows = await database
          .select({ userId: stories.userId, expiresAt: stories.expiresAt })
          .from(stories)
          .where(eq(stories.attachmentId, attachment.id))
          .limit(1);
        const story = storyRows[0];
        if (story && Date.parse(story.expiresAt) > Date.now()) {
          const [a, b] =
            story.userId < req.userId! ? [story.userId, req.userId!] : [req.userId!, story.userId];
          const isFriend = await database
            .select({ id: friendships.id })
            .from(friendships)
            .where(and(eq(friendships.userAId, a), eq(friendships.userBId, b)))
            .limit(1);
          authorized = isFriend.length > 0;
        }
      }

      if (!authorized) {
        return res.status(403).json({ error: 'Unauthorized media access.' });
      }

      if (!fs.existsSync(attachment.storagePath)) {
        return res.status(404).json({ error: 'Encrypted media blob no longer exists.' });
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      return res.sendFile(path.resolve(attachment.storagePath));
    } catch (error) {
      console.error('media download error:', error);
      return res.status(500).json({ error: 'Failed to retrieve encrypted media.' });
    }
  });

  return router;
}
