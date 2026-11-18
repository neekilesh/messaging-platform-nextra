import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from '../src/db/index.ts';
import {
  conversationParticipants,
  messageReceipts,
  messages,
  privacySettings,
  users,
} from '../src/db/schema.ts';
import { authenticateToken, onlineUserSockets, parseCookies, setIO } from './context.ts';

export function setupSocketServer(httpServer: HttpServer, database: PgDatabase): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  setIO(io);

  io.use(async (socket, next) => {
    try {
      const authToken =
        (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
        parseCookies(socket.handshake.headers.cookie)['nexora_session'] ||
        null;

      const auth = await authenticateToken(database, authToken);
      if (!auth) {
        return next(new Error('UNAUTHORIZED'));
      }
      socket.data.userId = auth.userId;
      socket.data.sessionId = auth.sessionId;
      return next();
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;

    if (!onlineUserSockets.has(userId)) {
      onlineUserSockets.set(userId, new Set());
    }
    const userSockets = onlineUserSockets.get(userId)!;
    const wasOffline = userSockets.size === 0;
    userSockets.add(socket.id);

    socket.join(`user:${userId}`);

    try {
      const convRows = await database
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));

      for (const row of convRows) {
        socket.join(`conv:${row.conversationId}`);
      }

      const nowIso = new Date().toISOString();
      await database.update(users).set({ lastSeenAt: nowIso }).where(eq(users.id, userId));

      if (wasOffline) {
        const privacyRows = await database
          .select({ showOnlineStatus: privacySettings.showOnlineStatus })
          .from(privacySettings)
          .where(eq(privacySettings.userId, userId))
          .limit(1);
        const privacy = privacyRows[0];
        if (!privacy || privacy.showOnlineStatus === 1) {
          io.emit('presence:update', { userId, isOnline: true, lastSeenAt: nowIso });
        }
      }
    } catch (err) {
      console.error('Socket connection initialization DB error:', err);
    }

    socket.on('conversation:join', async (conversationId: string) => {
      if (typeof conversationId !== 'string') return;
      try {
        const member = await database
          .select({ id: conversationParticipants.id })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, conversationId),
              eq(conversationParticipants.userId, userId)
            )
          )
          .limit(1);
        if (member.length > 0) {
          socket.join(`conv:${conversationId}`);
        }
      } catch {
        // ignore socket room check error
      }
    });

    socket.on('typing:start', async (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) return;
      try {
        const member = await database
          .select({ id: conversationParticipants.id })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, conversationId),
              eq(conversationParticipants.userId, userId)
            )
          )
          .limit(1);
        if (member.length === 0) return;
        socket.to(`conv:${conversationId}`).emit('typing:update', {
          conversationId,
          userId,
          isTyping: true,
        });
      } catch {
        // ignore typing error
      }
    });

    socket.on('typing:stop', async (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) return;
      try {
        const member = await database
          .select({ id: conversationParticipants.id })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, conversationId),
              eq(conversationParticipants.userId, userId)
            )
          )
          .limit(1);
        if (member.length === 0) return;
        socket.to(`conv:${conversationId}`).emit('typing:update', {
          conversationId,
          userId,
          isTyping: false,
        });
      } catch {
        // ignore typing error
      }
    });

    socket.on('message:delivered', async (payload: { messageId?: string; conversationId?: string }) => {
      const messageId = payload?.messageId;
      if (!messageId) return;
      try {
        const msgRows = await database
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderId: messages.senderId,
          })
          .from(messages)
          .where(eq(messages.id, messageId))
          .limit(1);
        const msg = msgRows[0];
        if (!msg || msg.senderId === userId) return;

        const member = await database
          .select({ id: conversationParticipants.id })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, msg.conversationId),
              eq(conversationParticipants.userId, userId)
            )
          )
          .limit(1);
        if (member.length === 0) return;

        const ts = new Date().toISOString();
        await database
          .insert(messageReceipts)
          .values({
            id: `${msg.id}:${userId}`,
            messageId: msg.id,
            userId,
            status: 'delivered',
            updatedAt: ts,
          })
          .onConflictDoUpdate({
            target: [messageReceipts.messageId, messageReceipts.userId],
            set: {
              status: sql`CASE WHEN ${messageReceipts.status} = 'read' THEN 'read' ELSE 'delivered' END`,
              updatedAt: ts,
            },
          });

        io.to(`conv:${msg.conversationId}`).emit('message:receipt', {
          conversationId: msg.conversationId,
          messageId: msg.id,
          userId,
          status: 'delivered',
          updatedAt: ts,
        });
      } catch {
        // ignore delivery receipt error
      }
    });

    socket.on('disconnect', async () => {
      const set = onlineUserSockets.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUserSockets.delete(userId);
          const disconnectIso = new Date().toISOString();
          try {
            await database.update(users).set({ lastSeenAt: disconnectIso }).where(eq(users.id, userId));
            const privacyRows = await database
              .select({ showOnlineStatus: privacySettings.showOnlineStatus })
              .from(privacySettings)
              .where(eq(privacySettings.userId, userId))
              .limit(1);
            const privacy = privacyRows[0];
            if (!privacy || privacy.showOnlineStatus === 1) {
              io.emit('presence:update', { userId, isOnline: false, lastSeenAt: disconnectIso });
            }
          } catch {
            // ignore disconnect update error
          }
        }
      }
    });
  });

  return io;
}
