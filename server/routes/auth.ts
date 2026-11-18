import crypto from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import {
  devices,
  identityKeys,
  privacySettings,
  userSessions,
  users,
} from '../../src/db/schema.ts';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
import {
  createRateLimiter,
  generateSessionToken,
  hashEmail,
  hashSessionToken,
  maskEmail,
  validateUsernameFormat,
} from '../security.ts';
import { createRequireAuth, getPublicUserById } from '../context.ts';
import type { AuthedRequest } from '../context.ts';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COSMIC_NAMES = ['Nova', 'Orion', 'Lyra', 'Vega', 'Nebula', 'Atlas', 'Pulse', 'Comet', 'Zenith', 'Aurora'];

function isHttpsRequest(req: { secure?: boolean; headers: Record<string, string | string[] | undefined> }) {
  return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

function setSessionCookie(
  req: { secure?: boolean; headers: Record<string, string | string[] | undefined> },
  res: { cookie: (name: string, val: string, opts: Record<string, unknown>) => void },
  token: string
) {
  const isHttps = isHttpsRequest(req);
  res.cookie('nexora_session', token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

async function generateUniqueHandle(database: PgDatabase, rawSeed: string): Promise<string> {
  const cleaned = rawSeed.replace(/[^a-zA-Z0-9_]/g, '');
  let base = cleaned.slice(0, 16);
  if (base.length < 3 || ['admin', 'root', 'system', 'nexora', 'support', 'security', 'null', 'undefined'].includes(base.toLowerCase())) {
    base = `Explorer_${crypto.randomBytes(2).toString('hex')}`;
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate =
      attempt === 0
        ? base
        : `${base.slice(0, 17)}_${crypto.randomBytes(2).toString('hex')}`;
    const check = validateUsernameFormat(candidate);
    if (!check.valid) continue;
    const existing = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.usernameNormalized, check.normalized))
      .limit(1);
    if (existing.length === 0) {
      return candidate;
    }
  }
  return `User_${crypto.randomBytes(4).toString('hex')}`;
}

export function createAuthRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  const instantLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'instant' });
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'login' });

  router.get('/check-username', async (req, res) => {
    try {
      const username = typeof req.query.username === 'string' ? req.query.username : '';
      const check = validateUsernameFormat(username);
      if (!check.valid) {
        return res.json({ available: false, reason: check.reason, normalized: check.normalized });
      }
      const existing = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameNormalized, check.normalized))
        .limit(1);
      return res.json({
        available: existing.length === 0,
        normalized: check.normalized,
        ...(existing.length > 0 ? { reason: 'Username is already taken.' } : {}),
      });
    } catch (error) {
      console.error('check-username error:', error);
      return res.status(500).json({ error: 'Failed to check username availability.' });
    }
  });

  router.post('/firebase', loginLimiter, async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Firebase ID token is required.' });
      }
      const idToken = authHeader.slice(7).trim();
      const decoded = await adminAuth.verifyIdToken(idToken);
      const emailRaw = (decoded.email || '').trim().toLowerCase();
      if (!emailRaw) {
        return res.status(400).json({ error: 'Google account must provide a verified email address.' });
      }

      const emailH = hashEmail(emailRaw);
      const deviceName = typeof req.body?.deviceName === 'string' ? req.body.deviceName.slice(0, 80) : 'Web Browser';
      const platform = typeof req.body?.platform === 'string' ? req.body.platform.slice(0, 40) : 'Web';

      let existingRows = await database
        .select()
        .from(users)
        .where(eq(users.uid, decoded.uid))
        .limit(1);

      if (existingRows.length === 0) {
        existingRows = await database
          .select()
          .from(users)
          .where(eq(users.emailHash, emailH))
          .limit(1);

        if (existingRows[0] && !existingRows[0].uid) {
          await database
            .update(users)
            .set({ uid: decoded.uid, updatedAt: new Date().toISOString() })
            .where(eq(users.id, existingRows[0].id));
        }
      }

      const keys = req.body?.keys as
        | {
            ecdhPublicJwk?: string;
            ecdsaPublicJwk?: string;
            fingerprint?: string;
            encryptedPrivateKey?: string;
            salt?: string;
            iv?: string;
          }
        | undefined;

      const existingUser = existingRows[0];
      if (existingUser) {
        const deviceId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        const rawSessionToken = generateSessionToken();
        const sessionTokenHash = hashSessionToken(rawSessionToken);
        const nowIso = new Date().toISOString();
        const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

        await database.insert(devices).values({
          id: deviceId,
          userId: existingUser.id,
          deviceName,
          platform,
          lastActiveAt: nowIso,
          createdAt: nowIso,
        });

        await database.insert(userSessions).values({
          id: sessionId,
          userId: existingUser.id,
          deviceId,
          tokenHash: sessionTokenHash,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
          ipAddress: String(req.ip || ''),
          lastActiveAt: nowIso,
          expiresAt: sessionExpiresAt,
          createdAt: nowIso,
        });

        const keyRows = await database
          .select()
          .from(identityKeys)
          .where(eq(identityKeys.userId, existingUser.id))
          .limit(1);
        const keyBackup = keyRows[0];

        if (!keyBackup && keys?.ecdhPublicJwk && keys?.ecdsaPublicJwk && keys?.fingerprint) {
          await database.insert(identityKeys).values({
            id: crypto.randomUUID(),
            userId: existingUser.id,
            deviceId,
            ecdhPublicJwk: keys.ecdhPublicJwk,
            ecdsaPublicJwk: keys.ecdsaPublicJwk,
            encryptedKeyBackup: keys.encryptedPrivateKey || null,
            backupSalt: keys.salt || null,
            backupIv: keys.iv || null,
            fingerprint: keys.fingerprint,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }

        setSessionCookie(req, res, rawSessionToken);

        const publicUser = await getPublicUserById(database, existingUser.id, existingUser.id);
        return res.json({
          sessionToken: rawSessionToken,
          user: {
            ...publicUser,
            maskedEmail: existingUser.emailMasked,
            createdAt: existingUser.createdAt,
          },
          keyBackup:
            keyBackup && keyBackup.encryptedKeyBackup
              ? {
                  encryptedPrivateKey: keyBackup.encryptedKeyBackup,
                  salt: keyBackup.backupSalt,
                  iv: keyBackup.backupIv,
                  ecdhPublicJwk: keyBackup.ecdhPublicJwk,
                  ecdsaPublicJwk: keyBackup.ecdsaPublicJwk,
                  fingerprint: keyBackup.fingerprint,
                }
              : null,
        });
      }

      if (!keys?.ecdhPublicJwk || !keys?.ecdsaPublicJwk || !keys?.fingerprint) {
        return res.status(400).json({ error: 'Device encryption keys are required.' });
      }

      const rawSeed = (decoded.name || emailRaw.split('@')[0] || 'Explorer').trim();
      const autoUsername = await generateUniqueHandle(database, rawSeed);
      const displayName = (decoded.name || autoUsername).trim().slice(0, 50);

      const userId = crypto.randomUUID();
      const deviceId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const rawSessionToken = generateSessionToken();
      const sessionTokenHash = hashSessionToken(rawSessionToken);
      const nowIso = new Date().toISOString();
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const masked = maskEmail(emailRaw);
      const avatarUrl = decoded.picture || null;

      await database.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          uid: decoded.uid,
          username: autoUsername,
          usernameNormalized: autoUsername.toLowerCase(),
          displayName,
          emailHash: emailH,
          emailMasked: masked,
          passwordHash: 'firebase-oauth',
          avatarUrl,
          bio: '',
          statusText: 'Encrypted on NEXORA',
          lastSeenAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await tx.insert(privacySettings).values({
          userId,
          showOnlineStatus: 1,
          showReadReceipts: 1,
          allowChatRequests: 1,
          storyDefaultVisibility: 'friends',
          allowDiscoveryByUsername: 1,
          updatedAt: nowIso,
        });

        await tx.insert(devices).values({
          id: deviceId,
          userId,
          deviceName,
          platform,
          lastActiveAt: nowIso,
          createdAt: nowIso,
        });

        await tx.insert(userSessions).values({
          id: sessionId,
          userId,
          deviceId,
          tokenHash: sessionTokenHash,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
          ipAddress: String(req.ip || ''),
          lastActiveAt: nowIso,
          expiresAt: sessionExpiresAt,
          createdAt: nowIso,
        });

        await tx.insert(identityKeys).values({
          id: crypto.randomUUID(),
          userId,
          deviceId,
          ecdhPublicJwk: keys.ecdhPublicJwk!,
          ecdsaPublicJwk: keys.ecdsaPublicJwk!,
          encryptedKeyBackup: keys.encryptedPrivateKey || null,
          backupSalt: keys.salt || null,
          backupIv: keys.iv || null,
          fingerprint: keys.fingerprint!,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      });

      setSessionCookie(req, res, rawSessionToken);

      const user = await getPublicUserById(database, userId, userId);
      return res.status(201).json({
        sessionToken: rawSessionToken,
        user: { ...user, maskedEmail: masked, createdAt: nowIso },
      });
    } catch (error) {
      console.error('firebase auth error:', error);
      return res.status(401).json({ error: 'Google sign-in verification failed.' });
    }
  });

  router.post('/instant', instantLimiter, async (req, res) => {
    try {
      const deviceName = typeof req.body?.deviceName === 'string' ? req.body.deviceName.slice(0, 80) : 'Web Browser';
      const platform = typeof req.body?.platform === 'string' ? req.body.platform.slice(0, 40) : 'Web';
      const keys = req.body?.keys as
        | {
            ecdhPublicJwk?: string;
            ecdsaPublicJwk?: string;
            fingerprint?: string;
          }
        | undefined;

      if (!keys?.ecdhPublicJwk || !keys?.ecdsaPublicJwk || !keys?.fingerprint) {
        return res.status(400).json({ error: 'Device encryption keys are required.' });
      }

      const word = COSMIC_NAMES[crypto.randomInt(0, COSMIC_NAMES.length)];
      const tag = crypto.randomBytes(2).toString('hex');
      const autoUsername = await generateUniqueHandle(database, `${word}_${tag}`);
      const displayName = `${word} ${tag.toUpperCase()}`;

      const userId = crypto.randomUUID();
      const deviceId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const rawSessionToken = generateSessionToken();
      const sessionTokenHash = hashSessionToken(rawSessionToken);
      const accessKey = `nxk_${crypto.randomBytes(16).toString('hex')}`;
      const accessKeyHash = hashSessionToken(accessKey);
      const nowIso = new Date().toISOString();
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const emailH = hashEmail(`${autoUsername.toLowerCase()}.${userId}@instant.nexora.local`);
      const masked = 'Instant Pass';

      await database.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          username: autoUsername,
          usernameNormalized: autoUsername.toLowerCase(),
          displayName,
          emailHash: emailH,
          emailMasked: masked,
          passwordHash: accessKeyHash,
          avatarUrl: null,
          bio: '',
          statusText: 'Encrypted on NEXORA',
          lastSeenAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await tx.insert(privacySettings).values({
          userId,
          showOnlineStatus: 1,
          showReadReceipts: 1,
          allowChatRequests: 1,
          storyDefaultVisibility: 'friends',
          allowDiscoveryByUsername: 1,
          updatedAt: nowIso,
        });

        await tx.insert(devices).values({
          id: deviceId,
          userId,
          deviceName,
          platform,
          lastActiveAt: nowIso,
          createdAt: nowIso,
        });

        await tx.insert(userSessions).values({
          id: sessionId,
          userId,
          deviceId,
          tokenHash: sessionTokenHash,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
          ipAddress: String(req.ip || ''),
          lastActiveAt: nowIso,
          expiresAt: sessionExpiresAt,
          createdAt: nowIso,
        });

        await tx.insert(identityKeys).values({
          id: crypto.randomUUID(),
          userId,
          deviceId,
          ecdhPublicJwk: keys.ecdhPublicJwk!,
          ecdsaPublicJwk: keys.ecdsaPublicJwk!,
          encryptedKeyBackup: null,
          backupSalt: null,
          backupIv: null,
          fingerprint: keys.fingerprint!,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      });

      setSessionCookie(req, res, rawSessionToken);

      const user = await getPublicUserById(database, userId, userId);
      return res.status(201).json({
        sessionToken: rawSessionToken,
        accessKey,
        user: { ...user, maskedEmail: masked, createdAt: nowIso },
      });
    } catch (error) {
      console.error('instant pass error:', error);
      return res.status(500).json({ error: 'Could not start instant session.' });
    }
  });

  router.post('/access-key', loginLimiter, async (req, res) => {
    try {
      const accessKey = typeof req.body?.accessKey === 'string' ? req.body.accessKey.trim() : '';
      const deviceName = typeof req.body?.deviceName === 'string' ? req.body.deviceName.slice(0, 80) : 'Web Browser';
      const platform = typeof req.body?.platform === 'string' ? req.body.platform.slice(0, 40) : 'Web';

      if (!accessKey.startsWith('nxk_')) {
        return res.status(400).json({ error: 'Invalid Access Key format.' });
      }

      const keyHash = hashSessionToken(accessKey);
      const userRows = await database
        .select({
          id: users.id,
          emailMasked: users.emailMasked,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.passwordHash, keyHash))
        .limit(1);

      const userRow = userRows[0];
      if (!userRow) {
        return res.status(401).json({ error: 'Access Key not recognized.' });
      }

      const deviceId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const rawSessionToken = generateSessionToken();
      const sessionTokenHash = hashSessionToken(rawSessionToken);
      const nowIso = new Date().toISOString();
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

      await database.insert(devices).values({
        id: deviceId,
        userId: userRow.id,
        deviceName,
        platform,
        lastActiveAt: nowIso,
        createdAt: nowIso,
      });

      await database.insert(userSessions).values({
        id: sessionId,
        userId: userRow.id,
        deviceId,
        tokenHash: sessionTokenHash,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
        ipAddress: String(req.ip || ''),
        lastActiveAt: nowIso,
        expiresAt: sessionExpiresAt,
        createdAt: nowIso,
      });

      setSessionCookie(req, res, rawSessionToken);

      const user = await getPublicUserById(database, userRow.id, userRow.id);
      return res.json({
        sessionToken: rawSessionToken,
        user: { ...user, maskedEmail: userRow.emailMasked, createdAt: userRow.createdAt },
      });
    } catch (error) {
      console.error('access-key login error:', error);
      return res.status(500).json({ error: 'Access Key sign-in failed.' });
    }
  });

  router.post('/logout', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const nowIso = new Date().toISOString();
      if (req.sessionId && !req.sessionId.startsWith('firebase:')) {
        await database
          .update(userSessions)
          .set({ revokedAt: nowIso })
          .where(eq(userSessions.id, req.sessionId));
      }
      const isHttps = isHttpsRequest(req);
      res.clearCookie('nexora_session', {
        path: '/',
        sameSite: isHttps ? 'none' : 'lax',
        secure: isHttps,
      });
      return res.json({ success: true });
    } catch (error) {
      console.error('logout error:', error);
      return res.status(500).json({ error: 'Logout failed.' });
    }
  });

  router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const rows = await database
        .select({ emailMasked: users.emailMasked, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, req.userId!))
        .limit(1);
      const row = rows[0];
      const user = await getPublicUserById(database, req.userId!, req.userId!);
      if (!user || !row) {
        return res.status(404).json({ error: 'User not found.' });
      }
      return res.json({
        user: { ...user, maskedEmail: row.emailMasked, createdAt: row.createdAt },
      });
    } catch (error) {
      console.error('/me error:', error);
      return res.status(500).json({ error: 'Failed to load profile.' });
    }
  });

  router.get('/devices', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const nowIso = new Date().toISOString();
      const rows = await database
        .select({
          id: userSessions.id,
          deviceId: userSessions.deviceId,
          deviceName: devices.deviceName,
          platform: devices.platform,
          ipAddress: userSessions.ipAddress,
          lastActiveAt: userSessions.lastActiveAt,
          createdAt: userSessions.createdAt,
        })
        .from(userSessions)
        .innerJoin(devices, eq(devices.id, userSessions.deviceId))
        .where(
          and(
            eq(userSessions.userId, req.userId!),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiresAt, nowIso)
          )
        )
        .orderBy(desc(userSessions.lastActiveAt));

      return res.json({
        devices: rows.map((r) => ({
          id: r.id,
          deviceId: r.deviceId,
          deviceName: r.deviceName,
          platform: r.platform,
          ipAddress: r.ipAddress || 'Private',
          lastActiveAt: r.lastActiveAt,
          createdAt: r.createdAt,
          isCurrent: r.id === req.sessionId,
        })),
      });
    } catch (error) {
      console.error('/devices error:', error);
      return res.status(500).json({ error: 'Failed to load active sessions.' });
    }
  });

  router.delete('/devices/:sessionId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const targetSessionId = String(req.params.sessionId);
      const nowIso = new Date().toISOString();
      const updated = await database
        .update(userSessions)
        .set({ revokedAt: nowIso })
        .where(and(eq(userSessions.id, targetSessionId), eq(userSessions.userId, req.userId!)))
        .returning({ id: userSessions.id });

      if (updated.length === 0) {
        return res.status(404).json({ error: 'Session not found.' });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error('revoke device error:', error);
      return res.status(500).json({ error: 'Failed to revoke device session.' });
    }
  });

  return router;
}
