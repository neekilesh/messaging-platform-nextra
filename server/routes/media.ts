import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createRequireAuth } from '../context.ts';
import type { AuthedRequest } from '../context.ts';

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads', 'encrypted');
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25MB encrypted payload cap

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'application/pdf', 'text/plain', 'application/zip'];

function isMimeAllowed(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

export function createMediaRouter(db: DatabaseSync) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  router.post(
    '/upload',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: MAX_MEDIA_BYTES }),
    (req: AuthedRequest, res) => {
      const encryptedBuf = req.body as Buffer;
      if (!Buffer.isBuffer(encryptedBuf) || encryptedBuf.length === 0) {
        return res.status(400).json({ error: 'Encrypted media payload is required.' });
      }
      if (encryptedBuf.length > MAX_MEDIA_BYTES) {
        return res.status(413).json({ error: 'Encrypted file exceeds 25MB limit.' });
      }

      const conversationId =
        typeof req.headers['x-nexora-conversation-id'] === 'string' ? req.headers['x-nexora-conversation-id'] : null;
      const isStory = req.headers['x-nexora-story'] === '1';
      const mimeType =
        typeof req.headers['x-nexora-mime-type'] === 'string'
          ? req.headers['x-nexora-mime-type']
          : 'application/octet-stream';
      const originalSize = Number(req.headers['x-nexora-original-size'] || encryptedBuf.length);
      const durationMs = req.headers['x-nexora-duration-ms'] ? Number(req.headers['x-nexora-duration-ms']) : null;

      if (!isMimeAllowed(mimeType)) {
        return res.status(400).json({ error: 'Unsupported media file type.' });
      }

      if (conversationId) {
        const member = db
          .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
          .get(conversationId, req.userId!);
        if (!member) {
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

      db.prepare(
        `INSERT INTO message_attachments (
          id, uploader_id, conversation_id, story_id, mime_type,
          original_size, encrypted_size, storage_path, sha256_ciphertext,
          duration_ms, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        attachmentId,
        req.userId!,
        conversationId,
        mimeType,
        originalSize,
        encryptedBuf.length,
        storagePath,
        sha256Ciphertext,
        durationMs,
        nowIso
      );

      return res.status(201).json({
        attachmentId,
        encryptedSize: encryptedBuf.length,
        sha256Ciphertext,
      });
    }
  );

  router.get('/:id', requireAuth, (req: AuthedRequest, res) => {
    const attachment = db
      .prepare(`SELECT * FROM message_attachments WHERE id = ?`)
      .get(req.params.id) as
      | {
          id: string;
          uploader_id: string;
          conversation_id: string | null;
          story_id: string | null;
          storage_path: string;
          expires_at: string | null;
        }
      | undefined;

    if (!attachment) {
      return res.status(404).json({ error: 'Encrypted media not found.' });
    }

    if (attachment.expires_at && Date.parse(attachment.expires_at) <= Date.now()) {
      return res.status(410).json({ error: 'Media has expired.' });
    }

    // Strict authorization: must be uploader, conversation participant, or authorized story viewer
    let authorized = attachment.uploader_id === req.userId;

    if (!authorized && attachment.conversation_id) {
      const participant = db
        .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
        .get(attachment.conversation_id, req.userId!);
      authorized = Boolean(participant);
    }

    if (!authorized) {
      const story = db
        .prepare(`SELECT user_id, expires_at FROM stories WHERE attachment_id = ?`)
        .get(attachment.id) as { user_id: string; expires_at: string } | undefined;
      if (story && Date.parse(story.expires_at) > Date.now()) {
        const [a, b] = story.user_id < req.userId! ? [story.user_id, req.userId!] : [req.userId!, story.user_id];
        const isFriend = db
          .prepare(`SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ?`)
          .get(a, b);
        authorized = Boolean(isFriend);
      }
    }

    if (!authorized) {
      return res.status(403).json({ error: 'Unauthorized media access.' });
    }

    if (!fs.existsSync(attachment.storage_path)) {
      return res.status(404).json({ error: 'Encrypted media blob no longer exists.' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.sendFile(path.resolve(attachment.storage_path));
  });

  return router;
}
