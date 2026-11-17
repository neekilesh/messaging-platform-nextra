import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`nexora-session-${process.cwd()}`).digest('hex');

const OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET ||
  crypto.createHash('sha256').update(`nexora-otp-${process.cwd()}`).digest('hex');

// Memory-hard scrypt password hashing (N=16384, r=8, p=1)
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
      return resolve(false);
    }
    const [, salt, keyHex] = parts;
    const keyBuf = Buffer.from(keyHex, 'hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      if (derivedKey.length !== keyBuf.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, keyBuf));
    });
  });
}

export function generateOtpCode(): string {
  const num = crypto.randomInt(0, 1_000_000);
  return num.toString().padStart(6, '0');
}

export function hashOtp(emailNormalized: string, purpose: string, otp: string, salt: string): string {
  return crypto
    .createHmac('sha256', OTP_HMAC_SECRET)
    .update(`${emailNormalized}:${purpose}:${salt}:${otp}`)
    .digest('hex');
}

export function verifyOtpHash(
  emailNormalized: string,
  purpose: string,
  otp: string,
  salt: string,
  expectedHash: string
): boolean {
  const actual = Buffer.from(hashOtp(emailNormalized, purpose, otp, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

export function hashEmail(emailNormalized: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`email:${emailNormalized}`).digest('hex');
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.length <= 2 ? local[0] || '*' : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

export function validateUsernameFormat(raw: string): { valid: boolean; normalized: string; reason?: string } {
  const cleaned = raw.trim().replace(/^@+/, '');
  if (cleaned.length < 3 || cleaned.length > 24) {
    return { valid: false, normalized: cleaned.toLowerCase(), reason: 'Username must be 3 to 24 characters.' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(cleaned)) {
    return {
      valid: false,
      normalized: cleaned.toLowerCase(),
      reason: 'Username may only contain letters, numbers, and underscores.',
    };
  }
  const reserved = new Set(['admin', 'root', 'system', 'nexora', 'support', 'security', 'null', 'undefined']);
  if (reserved.has(cleaned.toLowerCase())) {
    return { valid: false, normalized: cleaned.toLowerCase(), reason: 'That username is reserved.' };
  }
  return { valid: true, normalized: cleaned.toLowerCase() };
}

export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8) {
    return { valid: false, reason: 'Password must be at least 8 characters long.' };
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      valid: false,
      reason: 'Password must include uppercase, lowercase, and numeric characters.',
    };
  }
  return { valid: true };
}

// Sliding-window in-memory rate limiter for brute-force & OTP abuse protection
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function createRateLimiter(options: { windowMs: number; max: number; keyPrefix: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const emailPart = typeof req.body?.email === 'string' ? `:${req.body.email.trim().toLowerCase()}` : '';
    const key = `${options.keyPrefix}:${ip}${emailPart}`;
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    if (entry.count >= options.max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: `Too many requests. Please try again in ${retryAfterSec} seconds.`,
        code: 'RATE_LIMITED',
      });
    }
    entry.count += 1;
    return next();
  };
}
