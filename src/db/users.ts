import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';
import { hashEmail, maskEmail } from '../../server/security.ts';

export async function getUserByFirebaseUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error('Database query failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function linkOrCreateFirebaseUser(params: {
  uid: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}) {
  try {
    const normalizedEmail = params.email.trim().toLowerCase();
    const emailH = hashEmail(normalizedEmail);
    const masked = maskEmail(normalizedEmail);
    const nowIso = new Date().toISOString();
    const cleanUsername = params.username.trim().replace(/^@+/, '');
    const usernameNorm = cleanUsername.toLowerCase();

    const result = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        uid: params.uid,
        username: cleanUsername,
        usernameNormalized: usernameNorm,
        displayName: params.displayName.trim(),
        emailHash: emailH,
        emailMasked: masked,
        passwordHash: 'firebase-oauth',
        avatarUrl: params.avatarUrl || null,
        bio: '',
        statusText: 'Encrypted on NEXORA',
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          emailHash: emailH,
          emailMasked: masked,
          updatedAt: nowIso,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Failed to synchronize user account. Please try again later.', { cause: error });
  }
}
