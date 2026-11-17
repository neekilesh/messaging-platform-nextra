import fs from 'node:fs';
import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createAuthRouter } from './routes/auth.ts';
import { createUsersRouter } from './routes/users.ts';
import { createFriendsRouter } from './routes/friends.ts';
import { createConversationsRouter } from './routes/conversations.ts';
import { createGroupsRouter } from './routes/groups.ts';
import { createMediaRouter } from './routes/media.ts';
import { createStoriesRouter } from './routes/stories.ts';
import { createNotificationsRouter } from './routes/notifications.ts';
import { getIO } from './context.ts';

export function runRetentionCleanup(db: DatabaseSync) {
  const nowIso = new Date().toISOString();

  // Delete expired encrypted attachments from disk first
  const expiredAttachments = db
    .prepare(
      `SELECT id, storage_path FROM message_attachments
       WHERE expires_at IS NOT NULL AND expires_at <= ?`
    )
    .all(nowIso) as Array<{ id: string; storage_path: string }>;

  for (const att of expiredAttachments) {
    try {
      if (fs.existsSync(att.storage_path)) {
        fs.unlinkSync(att.storage_path);
      }
    } catch {
      // Ignore file unlink errors during cleanup
    }
    db.prepare(`DELETE FROM message_attachments WHERE id = ?`).run(att.id);
  }

  // Delete expired disappearing messages & broadcast removals
  const expiredMsgs = db
    .prepare(`SELECT id, conversation_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?`)
    .all(nowIso) as Array<{ id: string; conversation_id: string }>;

  if (expiredMsgs.length > 0) {
    db.prepare(`DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(nowIso);
    const io = getIO();
    if (io) {
      for (const m of expiredMsgs) {
        io.to(`conv:${m.conversation_id}`).emit('message:expired', {
          conversationId: m.conversation_id,
          messageId: m.id,
        });
      }
    }
  }

  // Delete expired 24-hour stories
  db.prepare(`DELETE FROM stories WHERE expires_at <= ?`).run(nowIso);

  // Delete expired unverified OTPs
  db.prepare(`DELETE FROM email_verifications WHERE expires_at <= ?`).run(nowIso);
}

export function createApiApp(db: DatabaseSync) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'nexora' });
  });

  app.use('/api/v1/auth', createAuthRouter(db));
  app.use('/api/v1/users', createUsersRouter(db));
  app.use('/api/v1/friends', createFriendsRouter(db));
  app.use('/api/v1/conversations', createConversationsRouter(db));
  app.use('/api/v1/groups', createGroupsRouter(db));
  app.use('/api/v1/media', createMediaRouter(db));
  app.use('/api/v1/stories', createStoriesRouter(db));
  app.use('/api/v1/notifications', createNotificationsRouter(db));

  return app;
}
