import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createRequireAuth, getPublicUserById, isBlockedBetween } from '../context.ts';
import type { AuthedRequest } from '../context.ts';
import { validateUsernameFormat } from '../security.ts';

export function createUsersRouter(db: DatabaseSync) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  // Search users strictly by username or display name — NEVER expose private email
  router.get('/search', requireAuth, (req: AuthedRequest, res) => {
    const qRaw = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@+/, '').toLowerCase() : '';
    if (!qRaw) {
      return res.json({ users: [] });
    }

    const pattern = `%${qRaw}%`;
    const rows = db
      .prepare(
        `SELECT u.id
         FROM users u
         LEFT JOIN privacy_settings ps ON ps.user_id = u.id
         WHERE u.id != ?
           AND (ps.allow_discovery_by_username IS NULL OR ps.allow_discovery_by_username = 1)
           AND (u.username_normalized LIKE ? OR LOWER(u.display_name) LIKE ?)
         ORDER BY
           CASE WHEN u.username_normalized = ? THEN 0
                WHEN u.username_normalized LIKE ? THEN 1
                ELSE 2 END,
           u.username_normalized ASC
         LIMIT 25`
      )
      .all(req.userId!, pattern, pattern, qRaw, `${qRaw}%`) as Array<{ id: string }>;

    const users = rows
      .filter((r) => !isBlockedBetween(db, req.userId!, r.id))
      .map((r) => getPublicUserById(db, r.id, req.userId!))
      .filter(Boolean);

    return res.json({ users });
  });

  router.get('/me/privacy', requireAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(`SELECT * FROM privacy_settings WHERE user_id = ?`)
      .get(req.userId!) as
      | {
          show_online_status: number;
          show_read_receipts: number;
          allow_chat_requests: number;
          story_default_visibility: string;
          allow_discovery_by_username: number;
        }
      | undefined;

    return res.json({
      privacy: {
        showOnlineStatus: row ? row.show_online_status === 1 : true,
        showReadReceipts: row ? row.show_read_receipts === 1 : true,
        allowChatRequests: row ? row.allow_chat_requests === 1 : true,
        storyDefaultVisibility: row?.story_default_visibility === 'close_friends' ? 'close_friends' : 'friends',
        allowDiscoveryByUsername: row ? row.allow_discovery_by_username === 1 : true,
      },
    });
  });

  router.patch('/me/privacy', requireAuth, (req: AuthedRequest, res) => {
    const body = req.body || {};
    const nowIso = new Date().toISOString();
    const showOnlineStatus = body.showOnlineStatus === false ? 0 : 1;
    const showReadReceipts = body.showReadReceipts === false ? 0 : 1;
    const allowChatRequests = body.allowChatRequests === false ? 0 : 1;
    const storyDefaultVisibility = body.storyDefaultVisibility === 'close_friends' ? 'close_friends' : 'friends';
    const allowDiscoveryByUsername = body.allowDiscoveryByUsername === false ? 0 : 1;

    db.prepare(
      `INSERT INTO privacy_settings (user_id, show_online_status, show_read_receipts, allow_chat_requests, story_default_visibility, allow_discovery_by_username, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         show_online_status = excluded.show_online_status,
         show_read_receipts = excluded.show_read_receipts,
         allow_chat_requests = excluded.allow_chat_requests,
         story_default_visibility = excluded.story_default_visibility,
         allow_discovery_by_username = excluded.allow_discovery_by_username,
         updated_at = excluded.updated_at`
    ).run(
      req.userId!,
      showOnlineStatus,
      showReadReceipts,
      allowChatRequests,
      storyDefaultVisibility,
      allowDiscoveryByUsername,
      nowIso
    );

    return res.json({
      privacy: {
        showOnlineStatus: showOnlineStatus === 1,
        showReadReceipts: showReadReceipts === 1,
        allowChatRequests: allowChatRequests === 1,
        storyDefaultVisibility,
        allowDiscoveryByUsername: allowDiscoveryByUsername === 1,
      },
    });
  });

  router.get('/me/blocked', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(`SELECT blocked_id, created_at FROM user_blocks WHERE blocker_id = ? ORDER BY created_at DESC`)
      .all(req.userId!) as Array<{ blocked_id: string; created_at: string }>;

    const blocked = rows
      .map((r) => {
        const user = getPublicUserById(db, r.blocked_id, req.userId!);
        return user ? { user, blockedAt: r.created_at } : null;
      })
      .filter(Boolean);

    return res.json({ blocked });
  });

  router.patch('/me', requireAuth, (req: AuthedRequest, res) => {
    const body = req.body || {};
    const nowIso = new Date().toISOString();

    const current = db
      .prepare(`SELECT username, username_normalized, display_name, bio, status_text, avatar_url, username_changed_at FROM users WHERE id = ?`)
      .get(req.userId!) as
      | {
          username: string;
          username_normalized: string;
          display_name: string;
          bio: string;
          status_text: string;
          avatar_url: string | null;
          username_changed_at: string | null;
        }
      | undefined;

    if (!current) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let nextUsername = current.username;
    let nextUsernameNorm = current.username_normalized;
    let nextChangedAt = current.username_changed_at;

    if (typeof body.username === 'string' && body.username.trim().replace(/^@+/, '').toLowerCase() !== current.username_normalized) {
      const cleanRaw = body.username.trim().replace(/^@+/, '');
      const check = validateUsernameFormat(cleanRaw);
      if (!check.valid) {
        return res.status(400).json({ error: check.reason });
      }
      if (current.username_changed_at) {
        const daysSince = (Date.now() - Date.parse(current.username_changed_at)) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) {
          return res.status(400).json({ error: 'Usernames can only be changed once every 7 days.' });
        }
      }
      const conflict = db
        .prepare(`SELECT 1 FROM users WHERE username_normalized = ? AND id != ?`)
        .get(check.normalized, req.userId!);
      if (conflict) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      nextUsername = cleanRaw;
      nextUsernameNorm = check.normalized;
      nextChangedAt = nowIso;
    }

    const displayName =
      typeof body.displayName === 'string' && body.displayName.trim().length > 0
        ? body.displayName.trim().slice(0, 50)
        : current.display_name;
    const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 200) : current.bio;
    const statusText = typeof body.statusText === 'string' ? body.statusText.trim().slice(0, 80) : current.status_text;
    const avatarUrl = body.avatarUrl !== undefined ? (typeof body.avatarUrl === 'string' ? body.avatarUrl : null) : current.avatar_url;

    db.prepare(
      `UPDATE users
       SET username = ?, username_normalized = ?, display_name = ?, bio = ?, status_text = ?, avatar_url = ?, username_changed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextUsername, nextUsernameNorm, displayName, bio, statusText, avatarUrl, nextChangedAt, nowIso, req.userId!);

    const updated = getPublicUserById(db, req.userId!, req.userId!);
    return res.json({ user: updated });
  });

  router.post('/me/keys', requireAuth, (req: AuthedRequest, res) => {
    const body = req.body || {};
    if (!body.ecdhPublicJwk || !body.ecdsaPublicJwk || !body.fingerprint) {
      return res.status(400).json({ error: 'Public keys and fingerprint are required.' });
    }
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO identity_keys (id, user_id, device_id, ecdh_public_jwk, ecdsa_public_jwk, encrypted_key_backup, backup_salt, backup_iv, fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         device_id = excluded.device_id,
         ecdh_public_jwk = excluded.ecdh_public_jwk,
         ecdsa_public_jwk = excluded.ecdsa_public_jwk,
         encrypted_key_backup = COALESCE(excluded.encrypted_key_backup, identity_keys.encrypted_key_backup),
         backup_salt = COALESCE(excluded.backup_salt, identity_keys.backup_salt),
         backup_iv = COALESCE(excluded.backup_iv, identity_keys.backup_iv),
         fingerprint = excluded.fingerprint,
         updated_at = excluded.updated_at`
    ).run(
      crypto.randomUUID(),
      req.userId!,
      req.deviceId || 'default',
      String(body.ecdhPublicJwk),
      String(body.ecdsaPublicJwk),
      body.encryptedPrivateKey ? String(body.encryptedPrivateKey) : null,
      body.salt ? String(body.salt) : null,
      body.iv ? String(body.iv) : null,
      String(body.fingerprint),
      nowIso,
      nowIso
    );

    return res.json({ success: true });
  });

  router.get('/:userId/keys', requireAuth, (req: AuthedRequest, res) => {
    const keyRow = db
      .prepare(`SELECT user_id, ecdh_public_jwk, ecdsa_public_jwk, fingerprint FROM identity_keys WHERE user_id = ?`)
      .get(req.params.userId) as
      | { user_id: string; ecdh_public_jwk: string; ecdsa_public_jwk: string; fingerprint: string }
      | undefined;

    if (!keyRow) {
      return res.status(404).json({ error: 'User keys not found.' });
    }
    return res.json({
      keys: {
        userId: keyRow.user_id,
        ecdhPublicJwk: keyRow.ecdh_public_jwk,
        ecdsaPublicJwk: keyRow.ecdsa_public_jwk,
        fingerprint: keyRow.fingerprint,
      },
    });
  });

  router.post('/:userId/block', requireAuth, (req: AuthedRequest, res) => {
    const targetId = req.params.userId;
    if (targetId === req.userId) {
      return res.status(400).json({ error: 'Cannot block yourself.' });
    }
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO user_blocks (id, blocker_id, blocked_id, created_at) VALUES (?, ?, ?, ?)`
    ).run(crypto.randomUUID(), req.userId!, targetId, nowIso);
    return res.json({ blocked: true });
  });

  router.delete('/:userId/block', requireAuth, (req: AuthedRequest, res) => {
    db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`).run(req.userId!, req.params.userId);
    return res.json({ blocked: false });
  });

  router.post('/:userId/report', requireAuth, (req: AuthedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 120) : 'Abuse or spam';
    const details = typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 500) : '';
    db.prepare(
      `INSERT INTO reports (id, reporter_id, reported_user_id, reason, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), req.userId!, req.params.userId, reason, details, new Date().toISOString());
    return res.status(201).json({ reported: true });
  });

  router.get('/profile/:username', requireAuth, (req: AuthedRequest, res) => {
    const clean = req.params.username.replace(/^@+/, '').toLowerCase();
    const row = db
      .prepare(`SELECT id FROM users WHERE username_normalized = ?`)
      .get(clean) as { id: string } | undefined;
    if (!row) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (isBlockedBetween(db, req.userId!, row.id)) {
      return res.status(403).json({ error: 'Profile unavailable.' });
    }
    const user = getPublicUserById(db, row.id, req.userId!);
    return res.json({ user });
  });

  return router;
}
