import crypto from 'node:crypto';
import { Router } from 'express';
import { and, asc, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import {
  identityKeys,
  privacySettings,
  reports,
  userBlocks,
  users,
} from '../../src/db/schema.ts';
import { createRequireAuth, getPublicUserById, isBlockedBetween } from '../context.ts';
import type { AuthedRequest } from '../context.ts';
import { validateUsernameFormat } from '../security.ts';

export function createUsersRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  router.get('/search', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const qRaw =
        typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@+/, '').toLowerCase() : '';
      if (!qRaw) {
        return res.json({ users: [] });
      }

      const pattern = `%${qRaw}%`;
      const rows = await database
        .select({ id: users.id })
        .from(users)
        .leftJoin(privacySettings, eq(privacySettings.userId, users.id))
        .where(
          and(
            ne(users.id, req.userId!),
            or(
              isNull(privacySettings.allowDiscoveryByUsername),
              eq(privacySettings.allowDiscoveryByUsername, 1)
            ),
            or(ilike(users.usernameNormalized, pattern), ilike(users.displayName, pattern))
          )
        )
        .orderBy(
          sql`CASE WHEN ${users.usernameNormalized} = ${qRaw} THEN 0 WHEN ${users.usernameNormalized} LIKE ${`${qRaw}%`} THEN 1 ELSE 2 END`,
          asc(users.usernameNormalized)
        )
        .limit(25);

      const results = [];
      for (const r of rows) {
        if (await isBlockedBetween(database, req.userId!, r.id)) continue;
        const u = await getPublicUserById(database, r.id, req.userId!);
        if (u) results.push(u);
      }

      return res.json({ users: results });
    } catch (error) {
      console.error('users/search error:', error);
      return res.status(500).json({ error: 'Search failed.' });
    }
  });

  router.get('/me/privacy', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const rows = await database
        .select()
        .from(privacySettings)
        .where(eq(privacySettings.userId, req.userId!))
        .limit(1);
      const row = rows[0];

      return res.json({
        privacy: {
          showOnlineStatus: row ? row.showOnlineStatus === 1 : true,
          showReadReceipts: row ? row.showReadReceipts === 1 : true,
          allowChatRequests: row ? row.allowChatRequests === 1 : true,
          storyDefaultVisibility:
            row?.storyDefaultVisibility === 'close_friends' ? 'close_friends' : 'friends',
          allowDiscoveryByUsername: row ? row.allowDiscoveryByUsername === 1 : true,
        },
      });
    } catch (error) {
      console.error('get privacy error:', error);
      return res.status(500).json({ error: 'Failed to load privacy settings.' });
    }
  });

  router.patch('/me/privacy', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const nowIso = new Date().toISOString();
      const showOnlineStatus = body.showOnlineStatus === false ? 0 : 1;
      const showReadReceipts = body.showReadReceipts === false ? 0 : 1;
      const allowChatRequests = body.allowChatRequests === false ? 0 : 1;
      const storyDefaultVisibility =
        body.storyDefaultVisibility === 'close_friends' ? 'close_friends' : 'friends';
      const allowDiscoveryByUsername = body.allowDiscoveryByUsername === false ? 0 : 1;

      await database
        .insert(privacySettings)
        .values({
          userId: req.userId!,
          showOnlineStatus,
          showReadReceipts,
          allowChatRequests,
          storyDefaultVisibility,
          allowDiscoveryByUsername,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: privacySettings.userId,
          set: {
            showOnlineStatus,
            showReadReceipts,
            allowChatRequests,
            storyDefaultVisibility,
            allowDiscoveryByUsername,
            updatedAt: nowIso,
          },
        });

      return res.json({
        privacy: {
          showOnlineStatus: showOnlineStatus === 1,
          showReadReceipts: showReadReceipts === 1,
          allowChatRequests: allowChatRequests === 1,
          storyDefaultVisibility,
          allowDiscoveryByUsername: allowDiscoveryByUsername === 1,
        },
      });
    } catch (error) {
      console.error('update privacy error:', error);
      return res.status(500).json({ error: 'Failed to update privacy settings.' });
    }
  });

  router.get('/me/blocked', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const rows = await database
        .select({
          blockedId: userBlocks.blockedId,
          createdAt: userBlocks.createdAt,
        })
        .from(userBlocks)
        .where(eq(userBlocks.blockerId, req.userId!))
        .orderBy(desc(userBlocks.createdAt));

      const blocked = [];
      for (const r of rows) {
        const user = await getPublicUserById(database, r.blockedId, req.userId!);
        if (user) blocked.push({ user, blockedAt: r.createdAt });
      }

      return res.json({ blocked });
    } catch (error) {
      console.error('get blocked error:', error);
      return res.status(500).json({ error: 'Failed to load blocked users.' });
    }
  });

  router.patch('/me', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      const nowIso = new Date().toISOString();

      const currentRows = await database
        .select({
          username: users.username,
          usernameNormalized: users.usernameNormalized,
          displayName: users.displayName,
          bio: users.bio,
          statusText: users.statusText,
          avatarUrl: users.avatarUrl,
          usernameChangedAt: users.usernameChangedAt,
        })
        .from(users)
        .where(eq(users.id, req.userId!))
        .limit(1);

      const current = currentRows[0];
      if (!current) {
        return res.status(404).json({ error: 'User not found.' });
      }

      let nextUsername = current.username;
      let nextUsernameNorm = current.usernameNormalized;
      let nextChangedAt = current.usernameChangedAt;

      if (
        typeof body.username === 'string' &&
        body.username.trim().replace(/^@+/, '').toLowerCase() !== current.usernameNormalized
      ) {
        const cleanRaw = body.username.trim().replace(/^@+/, '');
        const check = validateUsernameFormat(cleanRaw);
        if (!check.valid) {
          return res.status(400).json({ error: check.reason });
        }
        if (current.usernameChangedAt) {
          const daysSince =
            (Date.now() - Date.parse(current.usernameChangedAt)) / (1000 * 60 * 60 * 24);
          if (daysSince < 7) {
            return res
              .status(400)
              .json({ error: 'Usernames can only be changed once every 7 days.' });
          }
        }
        const conflict = await database
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.usernameNormalized, check.normalized), ne(users.id, req.userId!)))
          .limit(1);
        if (conflict.length > 0) {
          return res.status(409).json({ error: 'Username is already taken.' });
        }
        nextUsername = cleanRaw;
        nextUsernameNorm = check.normalized;
        nextChangedAt = nowIso;
      }

      const displayName =
        typeof body.displayName === 'string' && body.displayName.trim().length > 0
          ? body.displayName.trim().slice(0, 50)
          : current.displayName;
      const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 200) : current.bio;
      const statusText =
        typeof body.statusText === 'string'
          ? body.statusText.trim().slice(0, 80)
          : current.statusText;
      const avatarUrl =
        body.avatarUrl !== undefined
          ? typeof body.avatarUrl === 'string'
            ? body.avatarUrl
            : null
          : current.avatarUrl;

      await database
        .update(users)
        .set({
          username: nextUsername,
          usernameNormalized: nextUsernameNorm,
          displayName,
          bio,
          statusText,
          avatarUrl,
          usernameChangedAt: nextChangedAt,
          updatedAt: nowIso,
        })
        .where(eq(users.id, req.userId!));

      const updated = await getPublicUserById(database, req.userId!, req.userId!);
      return res.json({ user: updated });
    } catch (error) {
      console.error('update profile error:', error);
      return res.status(500).json({ error: 'Failed to update profile.' });
    }
  });

  router.post('/me/keys', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const body = req.body || {};
      if (!body.ecdhPublicJwk || !body.ecdsaPublicJwk || !body.fingerprint) {
        return res.status(400).json({ error: 'Public keys and fingerprint are required.' });
      }
      const nowIso = new Date().toISOString();
      const existing = await database
        .select({
          encryptedKeyBackup: identityKeys.encryptedKeyBackup,
          backupSalt: identityKeys.backupSalt,
          backupIv: identityKeys.backupIv,
        })
        .from(identityKeys)
        .where(eq(identityKeys.userId, req.userId!))
        .limit(1);

      const prev = existing[0];
      const nextBackup = body.encryptedPrivateKey
        ? String(body.encryptedPrivateKey)
        : prev?.encryptedKeyBackup || null;
      const nextSalt = body.salt ? String(body.salt) : prev?.backupSalt || null;
      const nextIv = body.iv ? String(body.iv) : prev?.backupIv || null;

      await database
        .insert(identityKeys)
        .values({
          id: crypto.randomUUID(),
          userId: req.userId!,
          deviceId: req.deviceId || 'default',
          ecdhPublicJwk: String(body.ecdhPublicJwk),
          ecdsaPublicJwk: String(body.ecdsaPublicJwk),
          encryptedKeyBackup: nextBackup,
          backupSalt: nextSalt,
          backupIv: nextIv,
          fingerprint: String(body.fingerprint),
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: identityKeys.userId,
          set: {
            deviceId: req.deviceId || 'default',
            ecdhPublicJwk: String(body.ecdhPublicJwk),
            ecdsaPublicJwk: String(body.ecdsaPublicJwk),
            encryptedKeyBackup: nextBackup,
            backupSalt: nextSalt,
            backupIv: nextIv,
            fingerprint: String(body.fingerprint),
            updatedAt: nowIso,
          },
        });

      return res.json({ success: true });
    } catch (error) {
      console.error('update keys error:', error);
      return res.status(500).json({ error: 'Failed to update encryption keys.' });
    }
  });

  router.get('/:userId/keys', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const targetUserId = String(req.params.userId);
      const rows = await database
        .select({
          userId: identityKeys.userId,
          ecdhPublicJwk: identityKeys.ecdhPublicJwk,
          ecdsaPublicJwk: identityKeys.ecdsaPublicJwk,
          fingerprint: identityKeys.fingerprint,
        })
        .from(identityKeys)
        .where(eq(identityKeys.userId, targetUserId))
        .limit(1);

      const keyRow = rows[0];
      if (!keyRow) {
        return res.status(404).json({ error: 'User keys not found.' });
      }
      return res.json({
        keys: {
          userId: keyRow.userId,
          ecdhPublicJwk: keyRow.ecdhPublicJwk,
          ecdsaPublicJwk: keyRow.ecdsaPublicJwk,
          fingerprint: keyRow.fingerprint,
        },
      });
    } catch (error) {
      console.error('get keys error:', error);
      return res.status(500).json({ error: 'Failed to load user keys.' });
    }
  });

  router.post('/:userId/block', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const targetId = String(req.params.userId);
      if (targetId === req.userId) {
        return res.status(400).json({ error: 'Cannot block yourself.' });
      }
      const nowIso = new Date().toISOString();
      await database
        .insert(userBlocks)
        .values({
          id: crypto.randomUUID(),
          blockerId: req.userId!,
          blockedId: targetId,
          createdAt: nowIso,
        })
        .onConflictDoNothing();
      return res.json({ blocked: true });
    } catch (error) {
      console.error('block user error:', error);
      return res.status(500).json({ error: 'Failed to block user.' });
    }
  });

  router.delete('/:userId/block', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const targetId = String(req.params.userId);
      await database
        .delete(userBlocks)
        .where(and(eq(userBlocks.blockerId, req.userId!), eq(userBlocks.blockedId, targetId)));
      return res.json({ blocked: false });
    } catch (error) {
      console.error('unblock user error:', error);
      return res.status(500).json({ error: 'Failed to unblock user.' });
    }
  });

  router.post('/:userId/report', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const targetId = String(req.params.userId);
      const reason =
        typeof req.body?.reason === 'string'
          ? req.body.reason.trim().slice(0, 120)
          : 'Abuse or spam';
      const details =
        typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 500) : '';
      await database.insert(reports).values({
        id: crypto.randomUUID(),
        reporterId: req.userId!,
        reportedUserId: targetId,
        reason,
        details,
        createdAt: new Date().toISOString(),
      });
      return res.status(201).json({ reported: true });
    } catch (error) {
      console.error('report user error:', error);
      return res.status(500).json({ error: 'Failed to submit report.' });
    }
  });

  router.get('/profile/:username', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const clean = String(req.params.username).replace(/^@+/, '').toLowerCase();
      const rows = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameNormalized, clean))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return res.status(404).json({ error: 'User not found.' });
      }
      if (await isBlockedBetween(database, req.userId!, row.id)) {
        return res.status(403).json({ error: 'Profile unavailable.' });
      }
      const user = await getPublicUserById(database, row.id, req.userId!);
      return res.json({ user });
    } catch (error) {
      console.error('get profile error:', error);
      return res.status(500).json({ error: 'Failed to load profile.' });
    }
  });

  return router;
}
