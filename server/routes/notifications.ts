import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import { notifications, users } from '../../src/db/schema.ts';
import { createRequireAuth } from '../context.ts';
import type { AuthedRequest } from '../context.ts';

export function createNotificationsRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  router.get('/', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const rows = await database
        .select({
          id: notifications.id,
          type: notifications.type,
          actorId: notifications.actorId,
          actorUsername: users.username,
          actorDisplayName: users.displayName,
          actorAvatarUrl: users.avatarUrl,
          entityId: notifications.entityId,
          title: notifications.title,
          body: notifications.body,
          isRead: notifications.isRead,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .leftJoin(users, eq(users.id, notifications.actorId))
        .where(eq(notifications.userId, req.userId!))
        .orderBy(desc(notifications.createdAt))
        .limit(50);

      return res.json({
        notifications: rows.map((r) => ({
          id: r.id,
          type: r.type,
          actorId: r.actorId,
          actorUsername: r.actorUsername,
          actorDisplayName: r.actorDisplayName,
          actorAvatarUrl: r.actorAvatarUrl,
          entityId: r.entityId,
          title: r.title,
          body: r.body,
          isRead: r.isRead === 1,
          createdAt: r.createdAt,
        })),
      });
    } catch (error) {
      console.error('list notifications error:', error);
      return res.status(500).json({ error: 'Failed to load notifications.' });
    }
  });

  router.post('/read-all', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await database
        .update(notifications)
        .set({ isRead: 1 })
        .where(eq(notifications.userId, req.userId!));
      return res.json({ success: true });
    } catch (error) {
      console.error('read-all notifications error:', error);
      return res.status(500).json({ error: 'Failed to mark notifications read.' });
    }
  });

  return router;
}
