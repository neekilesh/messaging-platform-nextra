import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { DatabaseSync } from 'node:sqlite';
import { authenticateToken, onlineUserSockets, parseCookies, setIO } from './context.ts';

export function setupSocketServer(httpServer: HttpServer, db: DatabaseSync): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  setIO(io);

  io.use((socket, next) => {
    const authToken =
      (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
      parseCookies(socket.handshake.headers.cookie)['nexora_session'] ||
      null;

    const auth = authenticateToken(db, authToken);
    if (!auth) {
      return next(new Error('UNAUTHORIZED'));
    }
    socket.data.userId = auth.userId;
    socket.data.sessionId = auth.sessionId;
    return next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;

    if (!onlineUserSockets.has(userId)) {
      onlineUserSockets.set(userId, new Set());
    }
    const userSockets = onlineUserSockets.get(userId)!;
    const wasOffline = userSockets.size === 0;
    userSockets.add(socket.id);

    socket.join(`user:${userId}`);

    // Join all conversation rooms this user participates in
    const convRows = db
      .prepare(`SELECT conversation_id FROM conversation_participants WHERE user_id = ?`)
      .all(userId) as Array<{ conversation_id: string }>;

    for (const row of convRows) {
      socket.join(`conv:${row.conversation_id}`);
    }

    const nowIso = new Date().toISOString();
    db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).run(nowIso, userId);

    if (wasOffline) {
      const privacy = db
        .prepare(`SELECT show_online_status FROM privacy_settings WHERE user_id = ?`)
        .get(userId) as { show_online_status: number } | undefined;
      if (!privacy || privacy.show_online_status === 1) {
        io.emit('presence:update', { userId, isOnline: true, lastSeenAt: nowIso });
      }
    }

    socket.on('conversation:join', (conversationId: string) => {
      if (typeof conversationId !== 'string') return;
      const member = db
        .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
        .get(conversationId, userId);
      if (member) {
        socket.join(`conv:${conversationId}`);
      }
    });

    socket.on('typing:start', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) return;
      const member = db
        .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
        .get(conversationId, userId);
      if (!member) return;
      socket.to(`conv:${conversationId}`).emit('typing:update', {
        conversationId,
        userId,
        isTyping: true,
      });
    });

    socket.on('typing:stop', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) return;
      const member = db
        .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
        .get(conversationId, userId);
      if (!member) return;
      socket.to(`conv:${conversationId}`).emit('typing:update', {
        conversationId,
        userId,
        isTyping: false,
      });
    });

    socket.on('message:delivered', (payload: { messageId?: string; conversationId?: string }) => {
      const messageId = payload?.messageId;
      if (!messageId) return;
      const msg = db
        .prepare(`SELECT id, conversation_id, sender_id FROM messages WHERE id = ?`)
        .get(messageId) as { id: string; conversation_id: string; sender_id: string } | undefined;
      if (!msg || msg.sender_id === userId) return;

      const member = db
        .prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`)
        .get(msg.conversation_id, userId);
      if (!member) return;

      const ts = new Date().toISOString();
      db.prepare(
        `INSERT INTO message_receipts (id, message_id, user_id, status, updated_at)
         VALUES (?, ?, ?, 'delivered', ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET
           status = CASE WHEN message_receipts.status = 'read' THEN 'read' ELSE 'delivered' END,
           updated_at = excluded.updated_at`
      ).run(`${msg.id}:${userId}`, msg.id, userId, ts);

      io.to(`conv:${msg.conversation_id}`).emit('message:receipt', {
        conversationId: msg.conversation_id,
        messageId: msg.id,
        userId,
        status: 'delivered',
        updatedAt: ts,
      });
    });

    socket.on('disconnect', () => {
      const set = onlineUserSockets.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUserSockets.delete(userId);
          const disconnectIso = new Date().toISOString();
          db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).run(disconnectIso, userId);
          const privacy = db
            .prepare(`SELECT show_online_status FROM privacy_settings WHERE user_id = ?`)
            .get(userId) as { show_online_status: number } | undefined;
          if (!privacy || privacy.show_online_status === 1) {
            io.emit('presence:update', { userId, isOnline: false, lastSeenAt: disconnectIso });
          }
        }
      }
    });
  });

  return io;
}
