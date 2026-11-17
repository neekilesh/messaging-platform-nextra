import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { Server as SocketIOServer } from 'socket.io';
import { hashSessionToken } from './security.ts';
import type { PublicUser } from '../src/types/nexora.ts';

export interface AuthedRequest extends Request {
  userId?: string;
  sessionId?: string;
  deviceId?: string;
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

export function authenticateToken(db: DatabaseSync, rawToken: string | null) {
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);
  const nowIso = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT s.id as session_id, s.user_id, s.device_id, s.expires_at, s.revoked_at
       FROM user_sessions s
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | {
        session_id: string;
        user_id: string;
        device_id: string;
        expires_at: string;
        revoked_at: string | null;
      }
    | undefined;

  if (!row || row.revoked_at || row.expires_at <= nowIso) {
    return null;
  }

  db.prepare(`UPDATE user_sessions SET last_active_at = ? WHERE id = ?`).run(nowIso, row.session_id);
  db.prepare(`UPDATE devices SET last_active_at = ? WHERE id = ?`).run(nowIso, row.device_id);
  return {
    userId: row.user_id,
    sessionId: row.session_id,
    deviceId: row.device_id,
  };
}

export function createRequireAuth(db: DatabaseSync) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = extractSessionToken(req);
    const auth = authenticateToken(db, token);
    if (!auth) {
      return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
    }
    req.userId = auth.userId;
    req.sessionId = auth.sessionId;
    req.deviceId = auth.deviceId;
    return next();
  };
}

export function getPublicUserById(db: DatabaseSync, userId: string, viewerId?: string): PublicUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.status_text, u.last_seen_at,
              ik.ecdh_public_jwk, ik.ecdsa_public_jwk, ik.fingerprint,
              ps.show_online_status
       FROM users u
       LEFT JOIN identity_keys ik ON ik.user_id = u.id
       LEFT JOIN privacy_settings ps ON ps.user_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: string;
        username: string;
        display_name: string;
        avatar_url: string | null;
        bio: string;
        status_text: string;
        last_seen_at: string | null;
        ecdh_public_jwk: string | null;
        ecdsa_public_jwk: string | null;
        fingerprint: string | null;
        show_online_status: number | null;
      }
    | undefined;

  if (!row) return null;
  const allowPresence = row.show_online_status === null ? true : row.show_online_status === 1;
  const isSelf = viewerId === row.id;

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    statusText: row.status_text,
    isOnline: (allowPresence || isSelf) ? isUserOnline(row.id) : false,
    lastSeenAt: allowPresence || isSelf ? row.last_seen_at : null,
    ecdhPublicJwk: row.ecdh_public_jwk || null,
    ecdsaPublicJwk: row.ecdsa_public_jwk || null,
    fingerprint: row.fingerprint || null,
  };
}

export function isBlockedBetween(db: DatabaseSync, userA: string, userB: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 as blocked FROM user_blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function createNotification(
  db: DatabaseSync,
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
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, actor_id, entity_id, title, body, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(params.id, params.userId, params.type, params.actorId || null, params.entityId || null, params.title, params.body, nowIso);

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
}
