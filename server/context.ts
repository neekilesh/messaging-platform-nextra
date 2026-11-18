import type { Request, Response, NextFunction } from 'express';
import { and, eq, or } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import type { PgDatabase } from '../src/db/index.ts';
import {
  devices,
  identityKeys,
  notifications,
  privacySettings,
  userBlocks,
  userSessions,
  users,
} from '../src/db/schema.ts';
import { adminAuth } from '../src/lib/firebase-admin.ts';
import { hashSessionToken } from './security.ts';
import type { PublicUser } from '../src/types/nexora.ts';

export interface AuthedRequest extends Request {
  userId?: string;
  sessionId?: string;
  deviceId?: string;
  firebaseUid?: string;
}

export const onlineUserSockets = new Map<string, Set<string>>();
let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer) {
  ioInstance = io;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function isUserOnline(userId: string): boolean {
  const set = onlineUserSockets.get(userId);
  return Boolean(set && set.size > 0);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies['nexora_session'] || null;
}

export async function authenticateToken(database: PgDatabase, rawToken: string | null) {
  if (!rawToken) return null;
  try {
    const tokenHash = hashSessionToken(rawToken);
    const nowIso = new Date().toISOString();
    const rows = await database
      .select({
        sessionId: userSessions.id,
        userId: userSessions.userId,
        deviceId: userSessions.deviceId,
        expiresAt: userSessions.expiresAt,
        revokedAt: userSessions.revokedAt,
      })
      .from(userSessions)
      .where(eq(userSessions.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (row && !row.revokedAt && row.expiresAt > nowIso) {
      await Promise.all([
        database
          .update(userSessions)
          .set({ lastActiveAt: nowIso })
          .where(eq(userSessions.id, row.sessionId)),
        database
          .update(devices)
          .set({ lastActiveAt: nowIso })
          .where(eq(devices.id, row.deviceId)),
      ]);
      return {
        userId: row.userId,
        sessionId: row.sessionId,
        deviceId: row.deviceId,
      };
    }

    // Fallback: verify Firebase ID token if passed as Bearer token
    if (rawToken.includes('.')) {
      try {
        const decoded = await adminAuth.verifyIdToken(rawToken);
        const userRows = await database
          .select({ id: users.id })
          .from(users)
          .where(eq(users.uid, decoded.uid))
          .limit(1);
        if (userRows[0]) {
          return {
            userId: userRows[0].id,
            sessionId: `firebase:${decoded.uid}`,
            deviceId: 'firebase-web',
            firebaseUid: decoded.uid,
          };
        }
      } catch {
        return null;
      }
    }

    return null;
  } catch (error) {
    console.error('authenticateToken failed:', error);
    return null;
  }
}

export function createRequireAuth(database: PgDatabase) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const token = extractSessionToken(req);
      const auth = await authenticateToken(database, token);
      if (!auth) {
        return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      }
      req.userId = auth.userId;
      req.sessionId = auth.sessionId;
      req.deviceId = auth.deviceId;
      if ('firebaseUid' in auth && auth.firebaseUid) {
        req.firebaseUid = auth.firebaseUid;
      }
      return next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({ error: 'Authentication verification failed.' });
    }
  };
}

export async function getPublicUserById(
  database: PgDatabase,
  userId: string,
  viewerId?: string
): Promise<PublicUser | null> {
  try {
    const rows = await database
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        statusText: users.statusText,
        lastSeenAt: users.lastSeenAt,
        ecdhPublicJwk: identityKeys.ecdhPublicJwk,
        ecdsaPublicJwk: identityKeys.ecdsaPublicJwk,
        fingerprint: identityKeys.fingerprint,
        showOnlineStatus: privacySettings.showOnlineStatus,
      })
      .from(users)
      .leftJoin(identityKeys, eq(identityKeys.userId, users.id))
      .leftJoin(privacySettings, eq(privacySettings.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const allowPresence = row.showOnlineStatus === null ? true : row.showOnlineStatus === 1;
    const isSelf = viewerId === row.id;

    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      bio: row.bio,
      statusText: row.statusText,
      isOnline: allowPresence || isSelf ? isUserOnline(row.id) : false,
      lastSeenAt: allowPresence || isSelf ? row.lastSeenAt : null,
      ecdhPublicJwk: row.ecdhPublicJwk || null,
      ecdsaPublicJwk: row.ecdsaPublicJwk || null,
      fingerprint: row.fingerprint || null,
    };
  } catch (error) {
    console.error('getPublicUserById failed:', error);
    throw new Error('Failed to load user profile.', { cause: error });
  }
}

export async function isBlockedBetween(
  database: PgDatabase,
  userA: string,
  userB: string
): Promise<boolean> {
  try {
    const rows = await database
      .select({ id: userBlocks.id })
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.blockerId, userA), eq(userBlocks.blockedId, userB)),
          and(eq(userBlocks.blockerId, userB), eq(userBlocks.blockedId, userA))
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    console.error('isBlockedBetween failed:', error);
    return false;
  }
}

export async function createNotification(
  database: PgDatabase,
  params: {
    id: string;
    userId: string;
    type: string;
    actorId?: string | null;
    entityId?: string | null;
    title: string;
    body: string;
  }
) {
  const nowIso = new Date().toISOString();
  try {
    await database.insert(notifications).values({
      id: params.id,
      userId: params.userId,
      type: params.type,
      actorId: params.actorId || null,
      entityId: params.entityId || null,
      title: params.title,
      body: params.body,
      isRead: 0,
      createdAt: nowIso,
    });

    const io = getIO();
    if (io) {
      io.to(`user:${params.userId}`).emit('notification:new', {
        id: params.id,
        type: params.type,
        actorId: params.actorId || null,
        entityId: params.entityId || null,
        title: params.title,
        body: params.body,
        isRead: false,
        createdAt: nowIso,
      });
    }
  } catch (error) {
    console.error('createNotification failed:', error);
  }
}
