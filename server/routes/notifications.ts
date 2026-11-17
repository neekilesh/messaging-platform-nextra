import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createRequireAuth } from '../context.ts';
import type { AuthedRequest } from '../context.ts';

export function createNotificationsRouter(db: DatabaseSync) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT n.*, u.username as actor_username, u.display_name as actor_display_name, u.avatar_url as actor_avatar_url
         FROM notifications n
         LEFT JOIN users u ON u.id = n.actor_id
         WHERE n.user_id = ?
         ORDER BY n.created_at DESC
         LIMIT 50`
      )
      .all(req.userId!) as Array<{
      id: string;
      type: string;
      actor_id: string | null;
      actor_username: string | null;
      actor_display_name: string | null;
      actor_avatar_url: string | null;
      entity_id: string | null;
      title: string;
      body: string;
      is_read: number;
      created_at: string;
    }>;

    return res.json({
      notifications: rows.map((r) => ({
        id: r.id,
        type: r.type,
        actorId: r.actor_id,
        actorUsername: r.actor_username,
        actorDisplayName: r.actor_display_name,
        actorAvatarUrl: r.actor_avatar_url,
        entityId: r.entity_id,
        title: r.title,
        body: r.body,
        isRead: r.is_read === 1,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/read-all', requireAuth, (req: AuthedRequest, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.userId!);
    return res.json({ success: true });
  });

  return router;
}
