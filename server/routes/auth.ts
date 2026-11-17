import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  createRateLimiter,
  generateOtpCode,
  generateSessionToken,
  hashEmail,
  hashOtp,
  hashPassword,
  hashSessionToken,
  maskEmail,
  validatePasswordStrength,
  validateUsernameFormat,
  verifyOtpHash,
  verifyPassword,
} from '../security.ts';
import { sendVerificationOtpEmail } from '../email.ts';
import { createRequireAuth, getPublicUserById } from '../context.ts';
import type { AuthedRequest } from '../context.ts';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthRouter(db: DatabaseSync) {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  const otpLimiter = createRateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'otp' });
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 15, keyPrefix: 'login' });

  router.post('/request-otp', otpLimiter, async (req, res) => {
    try {
      const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const purpose = req.body?.purpose === 'reset' ? 'reset' : 'register';

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }

      const emailH = hashEmail(emailRaw);
      const existingUser = db
        .prepare(`SELECT id FROM users WHERE email_hash = ?`)
        .get(emailH) as { id: string } | undefined;

      if (purpose === 'register' && existingUser) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      if (purpose === 'reset' && !existingUser) {
        return res.status(404).json({ error: 'No account is registered with that email address.' });
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const latest = db
        .prepare(
          `SELECT resend_available_at FROM email_verifications
           WHERE email_normalized = ? AND purpose = ?
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(emailRaw, purpose) as { resend_available_at: string } | undefined;

      if (latest && Date.parse(latest.resend_available_at) > nowMs) {
        const waitSec = Math.ceil((Date.parse(latest.resend_available_at) - nowMs) / 1000);
        return res.status(429).json({
          error: `Please wait ${waitSec}s before requesting another code.`,
          retryAfterSec: waitSec,
        });
      }

      const otp = generateOtpCode();
      const salt = crypto.randomBytes(16).toString('hex');
      const otpHash = hashOtp(emailRaw, purpose, otp, salt);
      const id = crypto.randomUUID();
      const expiresAt = new Date(nowMs + OTP_TTL_MS).toISOString();
      const resendAvailableAt = new Date(nowMs + RESEND_COOLDOWN_MS).toISOString();

      db.prepare(
        `INSERT INTO email_verifications (id, email_normalized, purpose, otp_hash, salt, attempts, verified, expires_at, resend_available_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
      ).run(id, emailRaw, purpose, otpHash, salt, expiresAt, resendAvailableAt, nowIso);

      const emailResult = await sendVerificationOtpEmail(emailRaw, otp, purpose);
      return res.json({
        verificationId: id,
        expiresAt,
        cooldownSeconds: 30,
        deliveredViaSmtp: emailResult.deliveredViaSmtp,
        ...(emailResult.devOtpPreview ? { devOtpPreview: emailResult.devOtpPreview } : {}),
      });
    } catch (error) {
      console.error('request-otp error:', error);
      return res.status(500).json({ error: 'Failed to issue verification code.' });
    }
  });

  router.post('/verify-otp', otpLimiter, (req, res) => {
    const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
    const purpose = req.body?.purpose === 'reset' ? 'reset' : 'register';

    if (!emailRaw || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'Enter a valid 6-digit verification code.' });
    }

    const record = db
      .prepare(
        `SELECT * FROM email_verifications
         WHERE email_normalized = ? AND purpose = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(emailRaw, purpose) as
      | {
          id: string;
          otp_hash: string;
          salt: string;
          attempts: number;
          verified: number;
          expires_at: string;
        }
      | undefined;

    if (!record) {
      return res.status(400).json({ error: 'No verification request found for this email.' });
    }

    if (Date.parse(record.expires_at) <= Date.now()) {
      return res.status(400).json({ error: 'Verification code has expired. Request a new one.' });
    }

    if (record.attempts >= 5) {
      return res.status(429).json({ error: 'Too many invalid OTP attempts. Request a new code.' });
    }

    const valid = verifyOtpHash(emailRaw, purpose, otp, record.salt, record.otp_hash);
    if (!valid) {
      db.prepare(`UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?`).run(record.id);
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }

    const verificationToken = generateSessionToken();
    const tokenHash = hashSessionToken(verificationToken);

    db.prepare(
      `UPDATE email_verifications
       SET verified = 1, verification_token_hash = ?
       WHERE id = ?`
    ).run(tokenHash, record.id);

    return res.json({
      verified: true,
      verificationToken,
    });
  });

  router.get('/check-username', (req, res) => {
    const username = typeof req.query.username === 'string' ? req.query.username : '';
    const check = validateUsernameFormat(username);
    if (!check.valid) {
      return res.json({ available: false, reason: check.reason, normalized: check.normalized });
    }
    const existing = db
      .prepare(`SELECT 1 FROM users WHERE username_normalized = ?`)
      .get(check.normalized);
    return res.json({
      available: !existing,
      normalized: check.normalized,
      ...(existing ? { reason: 'Username is already taken.' } : {}),
    });
  });

  router.post('/register', otpLimiter, async (req, res) => {
    try {
      const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const verificationToken = typeof req.body?.verificationToken === 'string' ? req.body.verificationToken : '';
      const usernameRaw = typeof req.body?.username === 'string' ? req.body.username.trim().replace(/^@+/, '') : '';
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const avatarUrl = typeof req.body?.avatarUrl === 'string' ? req.body.avatarUrl : null;
      const deviceName = typeof req.body?.deviceName === 'string' ? req.body.deviceName.slice(0, 80) : 'Web Browser';
      const platform = typeof req.body?.platform === 'string' ? req.body.platform.slice(0, 40) : 'Web';
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

      if (!emailRaw || !verificationToken) {
        return res.status(400).json({ error: 'Verified email token is required.' });
      }

      const tokenHash = hashSessionToken(verificationToken);
      const verif = db
        .prepare(
          `SELECT id, expires_at FROM email_verifications
           WHERE email_normalized = ? AND purpose = 'register' AND verified = 1 AND verification_token_hash = ?
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(emailRaw, tokenHash) as { id: string; expires_at: string } | undefined;

      if (!verif || Date.parse(verif.expires_at) <= Date.now()) {
        return res.status(400).json({ error: 'Email verification is invalid or expired.' });
      }

      const usernameCheck = validateUsernameFormat(usernameRaw);
      if (!usernameCheck.valid) {
        return res.status(400).json({ error: usernameCheck.reason });
      }
      if (displayName.length < 1 || displayName.length > 50) {
        return res.status(400).json({ error: 'Display name must be 1 to 50 characters.' });
      }
      const pwCheck = validatePasswordStrength(password);
      if (!pwCheck.valid) {
        return res.status(400).json({ error: pwCheck.reason });
      }
      if (!keys?.ecdhPublicJwk || !keys?.ecdsaPublicJwk || !keys?.fingerprint) {
        return res.status(400).json({ error: 'End-to-end encryption public keys are required.' });
      }

      const emailH = hashEmail(emailRaw);
      const existingUsername = db
        .prepare(`SELECT 1 FROM users WHERE username_normalized = ?`)
        .get(usernameCheck.normalized);
      if (existingUsername) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      const existingEmail = db.prepare(`SELECT 1 FROM users WHERE email_hash = ?`).get(emailH);
      if (existingEmail) {
        return res.status(409).json({ error: 'Email is already registered.' });
      }

      const passwordHash = await hashPassword(password);
      const userId = crypto.randomUUID();
      const deviceId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const rawSessionToken = generateSessionToken();
      const sessionTokenHash = hashSessionToken(rawSessionToken);
      const nowIso = new Date().toISOString();
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const masked = maskEmail(emailRaw);

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          `INSERT INTO users (id, username, username_normalized, display_name, email_hash, email_masked, password_hash, avatar_url, bio, status_text, last_seen_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 'Encrypted on NEXORA', ?, ?, ?)`
        ).run(userId, usernameRaw, usernameCheck.normalized, displayName, emailH, masked, passwordHash, avatarUrl, nowIso, nowIso, nowIso);

        db.prepare(
          `INSERT INTO privacy_settings (user_id, show_online_status, show_read_receipts, allow_chat_requests, story_default_visibility, allow_discovery_by_username, updated_at)
           VALUES (?, 1, 1, 1, 'friends', 1, ?)`
        ).run(userId, nowIso);

        db.prepare(
          `INSERT INTO devices (id, user_id, device_name, platform, last_active_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(deviceId, userId, deviceName, platform, nowIso, nowIso);

        db.prepare(
          `INSERT INTO user_sessions (id, user_id, device_id, token_hash, user_agent, ip_address, last_active_at, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          sessionId,
          userId,
          deviceId,
          sessionTokenHash,
          String(req.headers['user-agent'] || '').slice(0, 200),
          String(req.ip || ''),
          nowIso,
          sessionExpiresAt,
          nowIso
        );

        db.prepare(
          `INSERT INTO identity_keys (id, user_id, device_id, ecdh_public_jwk, ecdsa_public_jwk, encrypted_key_backup, backup_salt, backup_iv, fingerprint, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          userId,
          deviceId,
          keys.ecdhPublicJwk,
          keys.ecdsaPublicJwk,
          keys.encryptedPrivateKey || null,
          keys.salt || null,
          keys.iv || null,
          keys.fingerprint,
          nowIso,
          nowIso
        );

        // Consume verification token
        db.prepare(`DELETE FROM email_verifications WHERE id = ?`).run(verif.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      res.cookie('nexora_session', rawSessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_TTL_MS,
        path: '/',
      });

      const user = getPublicUserById(db, userId, userId)!;
      return res.status(201).json({
        sessionToken: rawSessionToken,
        user: { ...user, maskedEmail: masked, createdAt: nowIso },
      });
    } catch (error) {
      console.error('register error:', error);
      return res.status(500).json({ error: 'Account registration failed.' });
    }
  });

  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const identifierRaw = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const deviceName = typeof req.body?.deviceName === 'string' ? req.body.deviceName.slice(0, 80) : 'Web Browser';
      const platform = typeof req.body?.platform === 'string' ? req.body.platform.slice(0, 40) : 'Web';

      if (!identifierRaw || !password) {
        return res.status(400).json({ error: 'Username or email and password are required.' });
      }

      let userRow:
        | {
            id: string;
            password_hash: string;
            email_masked: string;
            created_at: string;
          }
        | undefined;

      if (identifierRaw.includes('@') && !identifierRaw.startsWith('@')) {
        const emailH = hashEmail(identifierRaw.toLowerCase());
        userRow = db
          .prepare(`SELECT id, password_hash, email_masked, created_at FROM users WHERE email_hash = ?`)
          .get(emailH) as typeof userRow;
      } else {
        const cleanUser = identifierRaw.replace(/^@+/, '').toLowerCase();
        userRow = db
          .prepare(`SELECT id, password_hash, email_masked, created_at FROM users WHERE username_normalized = ?`)
          .get(cleanUser) as typeof userRow;
      }

      if (!userRow) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      const validPassword = await verifyPassword(password, userRow.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      const deviceId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const rawSessionToken = generateSessionToken();
      const sessionTokenHash = hashSessionToken(rawSessionToken);
      const nowIso = new Date().toISOString();
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

      db.prepare(
        `INSERT INTO devices (id, user_id, device_name, platform, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(deviceId, userRow.id, deviceName, platform, nowIso, nowIso);

      db.prepare(
        `INSERT INTO user_sessions (id, user_id, device_id, token_hash, user_agent, ip_address, last_active_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        sessionId,
        userRow.id,
        deviceId,
        sessionTokenHash,
        String(req.headers['user-agent'] || '').slice(0, 200),
        String(req.ip || ''),
        nowIso,
        sessionExpiresAt,
        nowIso
      );

      const keyBackup = db
        .prepare(
          `SELECT ecdh_public_jwk, ecdsa_public_jwk, encrypted_key_backup, backup_salt, backup_iv, fingerprint
           FROM identity_keys WHERE user_id = ?`
        )
        .get(userRow.id) as
        | {
            ecdh_public_jwk: string;
            ecdsa_public_jwk: string;
            encrypted_key_backup: string | null;
            backup_salt: string | null;
            backup_iv: string | null;
            fingerprint: string;
          }
        | undefined;

      res.cookie('nexora_session', rawSessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_TTL_MS,
        path: '/',
      });

      const user = getPublicUserById(db, userRow.id, userRow.id)!;
      return res.json({
        sessionToken: rawSessionToken,
        user: { ...user, maskedEmail: userRow.email_masked, createdAt: userRow.created_at },
        keyBackup:
          keyBackup && keyBackup.encrypted_key_backup
            ? {
                encryptedPrivateKey: keyBackup.encrypted_key_backup,
                salt: keyBackup.backup_salt,
                iv: keyBackup.backup_iv,
                ecdhPublicJwk: keyBackup.ecdh_public_jwk,
                ecdsaPublicJwk: keyBackup.ecdsa_public_jwk,
                fingerprint: keyBackup.fingerprint,
              }
            : null,
      });
    } catch (error) {
      console.error('login error:', error);
      return res.status(500).json({ error: 'Sign in failed.' });
    }
  });

  router.post('/reset-password', otpLimiter, async (req, res) => {
    try {
      const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const verificationToken = typeof req.body?.verificationToken === 'string' ? req.body.verificationToken : '';
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

      const pwCheck = validatePasswordStrength(newPassword);
      if (!pwCheck.valid) {
        return res.status(400).json({ error: pwCheck.reason });
      }

      const tokenHash = hashSessionToken(verificationToken);
      const verif = db
        .prepare(
          `SELECT id, expires_at FROM email_verifications
           WHERE email_normalized = ? AND purpose = 'reset' AND verified = 1 AND verification_token_hash = ?
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(emailRaw, tokenHash) as { id: string; expires_at: string } | undefined;

      if (!verif || Date.parse(verif.expires_at) <= Date.now()) {
        return res.status(400).json({ error: 'Password reset verification is invalid or expired.' });
      }

      const emailH = hashEmail(emailRaw);
      const user = db.prepare(`SELECT id FROM users WHERE email_hash = ?`).get(emailH) as { id: string } | undefined;
      if (!user) {
        return res.status(404).json({ error: 'Account not found.' });
      }

      const passwordHash = await hashPassword(newPassword);
      const nowIso = new Date().toISOString();

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(passwordHash, nowIso, user.id);
        db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(nowIso, user.id);
        db.prepare(`DELETE FROM email_verifications WHERE id = ?`).run(verif.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('reset-password error:', error);
      return res.status(500).json({ error: 'Failed to reset password.' });
    }
  });

  router.post('/logout', requireAuth, (req: AuthedRequest, res) => {
    const nowIso = new Date().toISOString();
    db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ?`).run(nowIso, req.sessionId!);
    res.clearCookie('nexora_session', { path: '/' });
    return res.json({ success: true });
  });

  router.get('/me', requireAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(`SELECT email_masked, created_at FROM users WHERE id = ?`)
      .get(req.userId!) as { email_masked: string; created_at: string } | undefined;
    const user = getPublicUserById(db, req.userId!, req.userId!);
    if (!user || !row) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({
      user: { ...user, maskedEmail: row.email_masked, createdAt: row.created_at },
    });
  });

  router.get('/devices', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT s.id, s.device_id, d.device_name, d.platform, s.ip_address, s.last_active_at, s.created_at
         FROM user_sessions s
         JOIN devices d ON d.id = s.device_id
         WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
         ORDER BY s.last_active_at DESC`
      )
      .all(req.userId!, new Date().toISOString()) as Array<{
      id: string;
      device_id: string;
      device_name: string;
      platform: string;
      ip_address: string;
      last_active_at: string;
      created_at: string;
    }>;

    return res.json({
      devices: rows.map((r) => ({
        id: r.id,
        deviceId: r.device_id,
        deviceName: r.device_name,
        platform: r.platform,
        ipAddress: r.ip_address || 'Private',
        lastActiveAt: r.last_active_at,
        createdAt: r.created_at,
        isCurrent: r.id === req.sessionId,
      })),
    });
  });

  router.delete('/devices/:sessionId', requireAuth, (req: AuthedRequest, res) => {
    const targetSessionId = req.params.sessionId;
    const nowIso = new Date().toISOString();
    const result = db
      .prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ?`)
      .run(nowIso, targetSessionId, req.userId!);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    return res.json({ success: true });
  });

  return router;
}
