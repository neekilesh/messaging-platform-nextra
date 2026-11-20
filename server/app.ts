import fs from 'node:fs';
import express from 'express';
import { and, isNotNull, lte, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from '../src/db/index.ts';
import {
  messageAttachments,
  messages,
  stories,
} from '../src/db/schema.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createUsersRouter } from './routes/users.ts';
import { createFriendsRouter } from './routes/friends.ts';
import { createConversationsRouter } from './routes/conversations.ts';
import { createGroupsRouter } from './routes/groups.ts';
import { createMediaRouter } from './routes/media.ts';
import { createStoriesRouter } from './routes/stories.ts';
import { createNotificationsRouter } from './routes/notifications.ts';
import { getIO } from './context.ts';

export async function runRetentionCleanup(database: PgDatabase) {
  const nowIso = new Date().toISOString();

  const expiredAttachments = await database
    .select({
      id: messageAttachments.id,
      storagePath: messageAttachments.storagePath,
    })
    .from(messageAttachments)
    .where(and(isNotNull(messageAttachments.expiresAt), lte(messageAttachments.expiresAt, nowIso)));

  for (const att of expiredAttachments) {
    try {
      if (fs.existsSync(att.storagePath)) {
        fs.unlinkSync(att.storagePath);
      }
    } catch {
      // Ignore file unlink errors during cleanup
    }
    await database.delete(messageAttachments).where(eq(messageAttachments.id, att.id));
  }

  const expiredMsgs = await database
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
    })
    .from(messages)
    .where(and(isNotNull(messages.expiresAt), lte(messages.expiresAt, nowIso)));

  if (expiredMsgs.length > 0) {
    await database
      .delete(messages)
      .where(and(isNotNull(messages.expiresAt), lte(messages.expiresAt, nowIso)));

    const io = getIO();
    if (io) {
      for (const m of expiredMsgs) {
        io.to(`conv:${m.conversationId}`).emit('message:expired', {
          conversationId: m.conversationId,
          messageId: m.id,
        });
      }
    }
  }

  await database.delete(stories).where(lte(stories.expiresAt, nowIso));
}

export function createApiApp(database: PgDatabase) {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Allow cross-origin requests from Netlify or configured origins with credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-nexora-conversation-id, x-nexora-story, x-nexora-mime-type, x-nexora-original-size, x-nexora-duration-ms'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  });

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/v1/health', async (_req, res) => {
    let databaseStatus: 'connected' | 'disconnected' = 'disconnected';
    try {
      await database.execute(sql`SELECT 1`);
      databaseStatus = 'connected';
    } catch {
      databaseStatus = 'disconnected';
    }
    res.json({ status: 'ok', service: 'nexora', database: databaseStatus });
  });

  app.use('/api/v1/auth', createAuthRouter(database));
  app.use('/api/v1/users', createUsersRouter(database));
  app.use('/api/v1/friends', createFriendsRouter(database));
  app.use('/api/v1/conversations', createConversationsRouter(database));
  app.use('/api/v1/groups', createGroupsRouter(database));
  app.use('/api/v1/media', createMediaRouter(database));
  app.use('/api/v1/stories', createStoriesRouter(database));
  app.use('/api/v1/notifications', createNotificationsRouter(database));

  app.use('/api', (_req, res) => {
    return res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}
