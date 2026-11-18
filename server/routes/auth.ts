import crypto from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import {
  devices,
  emailVerifications,
  identityKeys,
  privacySettings,
  userSessions,
  users,
} from '../../src/db/schema.ts';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
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

export function createAuthRouter(database: PgDatabase) {
  const router = Router();
  const requireAuth = createRequireAuth(database);

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
      const existingUsers = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.emailHash, emailH))
        .limit(1);
      const existingUser = existingUsers[0];

      if (purpose === 'register' && existingUser) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      if (purpose === 'reset' && !existingUser) {
        return res.status(404).json({ error: 'No account is registered with that email address.' });
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const latestRows = await database
        .select({ resendAvailableAt: emailVerifications.resendAvailableAt })
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.emailNormalized, emailRaw),
            eq(emailVerifications.purpose, purpose)
          )
        )
        .orderBy(desc(emailVerifications.createdAt))
        .limit(1);
      const latest = latestRows[0];

      if (latest && Date.parse(latest.resendAvailableAt) > nowMs) {
        const waitSec = Math.ceil((Date.parse(latest.resendAvailableAt) - nowMs) / 1000);
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

      await database.insert(emailVerifications).values({
        id,
        emailNormalized: emailRaw,
        purpose,
        otpHash,
        salt,
        attempts: 0,
        verified: 0,
        expiresAt,
        resendAvailableAt,
        createdAt: nowIso,
      });

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

  router.post('/verify-otp', otpLimiter, async (req, res) => {
    try {
      const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
      const purpose = req.body?.purpose === 'reset' ? 'reset' : 'register';

      if (!emailRaw || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ error: 'Enter a valid 6-digit verification code.' });
      }

      const records = await database
        .select()
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.emailNormalized, emailRaw),
            eq(emailVerifications.purpose, purpose)
          )
        )
        .orderBy(desc(emailVerifications.createdAt))
        .limit(1);

      const record = records[0];
      if (!record) {
        return res.status(400).json({ error: 'No verification request found for this email.' });
      }

      if (Date.parse(record.expiresAt) <= Date.now()) {
        return res.status(400).json({ error: 'Verification code has expired. Request a new one.' });
      }

      if (record.attempts >= 5) {
        return res.status(429).json({ error: 'Too many invalid OTP attempts. Request a new code.' });
      }

      const valid = verifyOtpHash(emailRaw, purpose, otp, record.salt, record.otpHash);
      if (!valid) {
        await database
          .update(emailVerifications)
          .set({ attempts: record.attempts + 1 })
          .where(eq(emailVerifications.id, record.id));
        return res.status(400).json({ error: 'Incorrect verification code.' });
      }

      const verificationToken = generateSessionToken();
      const tokenHash = hashSessionToken(verificationToken);

      await database
        .update(emailVerifications)
        .set({ verified: 1, verificationTokenHash: tokenHash })
        .where(eq(emailVerifications.id, record.id));

      return res.json({
        verified: true,
        verificationToken,
      });
    } catch (error) {
      console.error('verify-otp error:', error);
      return res.status(500).json({ error: 'Verification check failed.' });
    }
  });

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

        setSessionCookie(req, res, rawSessionToken);

        const publicUser = await getPublicUserById(database, existingUser.id, existingUser.id);
        return res.json({
          needsProfile: false,
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

      const usernameRaw =
        typeof req.body?.username === 'string' ? req.body.username.trim().replace(/^@+/, '') : '';
      const displayName =
        typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
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

      if (!usernameRaw || !displayName || !keys?.ecdhPublicJwk || !keys?.ecdsaPublicJwk || !keys?.fingerprint) {
        return res.json({
          needsProfile: true,
          email: emailRaw,
          suggestedName: decoded.name || emailRaw.split('@')[0] || 'Explorer',
          avatarUrl: decoded.picture || null,
        });
      }

      const usernameCheck = validateUsernameFormat(usernameRaw);
      if (!usernameCheck.valid) {
        return res.status(400).json({ error: usernameCheck.reason });
      }
      if (displayName.length < 1 || displayName.length > 50) {
        return res.status(400).json({ error: 'Display name must be 1 to 50 characters.' });
      }

      const conflict = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameNormalized, usernameCheck.normalized))
        .limit(1);
      if (conflict.length > 0) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }

      const userId = crypto.randomUUID();
      const deviceId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const rawSessionToken = generateSessionToken();
      const sessionTokenHash = hashSessionToken(rawSessionToken);
      const nowIso = new Date().toISOString();
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const masked = maskEmail(emailRaw);
      const avatarUrl =
        typeof req.body?.avatarUrl === 'string'
          ? req.body.avatarUrl
          : decoded.picture || null;

      await database.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          uid: decoded.uid,
          username: usernameRaw,
          usernameNormalized: usernameCheck.normalized,
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
        needsProfile: false,
        sessionToken: rawSessionToken,
        user: { ...user, maskedEmail: masked, createdAt: nowIso },
      });
    } catch (error) {
      console.error('firebase auth error:', error);
      return res.status(401).json({ error: 'Google sign-in verification failed.' });
    }
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
      const verifRows = await database
        .select({
          id: emailVerifications.id,
          expiresAt: emailVerifications.expiresAt,
        })
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.emailNormalized, emailRaw),
            eq(emailVerifications.purpose, 'register'),
            eq(emailVerifications.verified, 1),
            eq(emailVerifications.verificationTokenHash, tokenHash)
          )
        )
        .orderBy(desc(emailVerifications.createdAt))
        .limit(1);

      const verif = verifRows[0];
      if (!verif || Date.parse(verif.expiresAt) <= Date.now()) {
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
      const existingUsername = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.usernameNormalized, usernameCheck.normalized))
        .limit(1);
      if (existingUsername.length > 0) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }

      const existingEmail = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.emailHash, emailH))
        .limit(1);
      if (existingEmail.length > 0) {
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

      await database.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          username: usernameRaw,
          usernameNormalized: usernameCheck.normalized,
          displayName,
          emailHash: emailH,
          emailMasked: masked,
          passwordHash,
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

        await tx.delete(emailVerifications).where(eq(emailVerifications.id, verif.id));
      });

      setSessionCookie(req, res, rawSessionToken);

      const user = await getPublicUserById(database, userId, userId);
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

      const userRows =
        identifierRaw.includes('@') && !identifierRaw.startsWith('@')
          ? await database
              .select({
                id: users.id,
                passwordHash: users.passwordHash,
                emailMasked: users.emailMasked,
                createdAt: users.createdAt,
              })
              .from(users)
              .where(eq(users.emailHash, hashEmail(identifierRaw.toLowerCase())))
              .limit(1)
          : await database
              .select({
                id: users.id,
                passwordHash: users.passwordHash,
                emailMasked: users.emailMasked,
                createdAt: users.createdAt,
              })
              .from(users)
              .where(eq(users.usernameNormalized, identifierRaw.replace(/^@+/, '').toLowerCase()))
              .limit(1);

      const userRow = userRows[0];
      if (!userRow) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      const validPassword = await verifyPassword(password, userRow.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials.' });
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

      const keyRows = await database
        .select({
          ecdhPublicJwk: identityKeys.ecdhPublicJwk,
          ecdsaPublicJwk: identityKeys.ecdsaPublicJwk,
          encryptedKeyBackup: identityKeys.encryptedKeyBackup,
          backupSalt: identityKeys.backupSalt,
          backupIv: identityKeys.backupIv,
          fingerprint: identityKeys.fingerprint,
        })
        .from(identityKeys)
        .where(eq(identityKeys.userId, userRow.id))
        .limit(1);
      const keyBackup = keyRows[0];

      setSessionCookie(req, res, rawSessionToken);

      const user = await getPublicUserById(database, userRow.id, userRow.id);
      return res.json({
        sessionToken: rawSessionToken,
        user: { ...user, maskedEmail: userRow.emailMasked, createdAt: userRow.createdAt },
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
      const verifRows = await database
        .select({
          id: emailVerifications.id,
          expiresAt: emailVerifications.expiresAt,
        })
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.emailNormalized, emailRaw),
            eq(emailVerifications.purpose, 'reset'),
            eq(emailVerifications.verified, 1),
            eq(emailVerifications.verificationTokenHash, tokenHash)
          )
        )
        .orderBy(desc(emailVerifications.createdAt))
        .limit(1);

      const verif = verifRows[0];
      if (!verif || Date.parse(verif.expiresAt) <= Date.now()) {
        return res.status(400).json({ error: 'Password reset verification is invalid or expired.' });
      }

      const emailH = hashEmail(emailRaw);
      const userRows = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.emailHash, emailH))
        .limit(1);
      const user = userRows[0];
      if (!user) {
        return res.status(404).json({ error: 'Account not found.' });
      }

      const passwordHash = await hashPassword(newPassword);
      const nowIso = new Date().toISOString();

      await database.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: nowIso })
          .where(eq(users.id, user.id));
        await tx
          .update(userSessions)
          .set({ revokedAt: nowIso })
          .where(and(eq(userSessions.userId, user.id), isNull(userSessions.revokedAt)));
        await tx.delete(emailVerifications).where(eq(emailVerifications.id, verif.id));
      });

      return res.json({ success: true });
    } catch (error) {
      console.error('reset-password error:', error);
      return res.status(500).json({ error: 'Failed to reset password.' });
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
