import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createPool, db } from '../src/db/index.ts';
import { messages, stories, users } from '../src/db/schema.ts';
import { createApiApp, runRetentionCleanup } from '../server/app.ts';
import { setupSocketServer } from '../server/socket.ts';
import { recordStreakActivity } from '../server/streaks.ts';

const subtle = crypto.webcrypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64');
}

function b64ToBuf(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function generateTestKeyBundle() {
  const ecdh = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ecdsa = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const ecdhPublicJwk = JSON.stringify(await subtle.exportKey('jwk', ecdh.publicKey));
  const ecdsaPublicJwk = JSON.stringify(await subtle.exportKey('jwk', ecdsa.publicKey));
  return {
    ecdhPrivateKey: ecdh.privateKey,
    ecdsaPrivateKey: ecdsa.privateKey,
    ecdhPublicJwk,
    ecdsaPublicJwk,
    fingerprint: '11111 22222 33333 44444 55555',
  };
}

async function wrapKeyForRecipient(rawKey: Uint8Array, recipientPublicJwkStr: string, infoText: string) {
  const epk = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const peerPub = await subtle.importKey('jwk', JSON.parse(recipientPublicJwkStr), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedBits = await subtle.deriveBits({ name: 'ECDH', public: peerPub }, epk.privateKey, 256);
  const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const wrapAes = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(infoText) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const iv = crypto.randomBytes(12);
  const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv }, wrapAes, rawKey);
  return {
    ephemeralPublicJwk: JSON.stringify(await subtle.exportKey('jwk', epk.publicKey)),
    wrappedKey: bufToB64(wrapped),
    iv: bufToB64(iv),
  };
}

async function unwrapKey(
  envelope: { ephemeralPublicJwk: string; wrappedKey: string; iv: string },
  myPrivateKey: CryptoKey,
  infoText: string
) {
  const epkPub = await subtle.importKey(
    'jwk',
    JSON.parse(envelope.ephemeralPublicJwk),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedBits = await subtle.deriveBits({ name: 'ECDH', public: epkPub }, myPrivateKey, 256);
  const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const wrapAes = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(infoText) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const unwrapped = await subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(envelope.iv) }, wrapAes, b64ToBuf(envelope.wrappedKey));
  return new Uint8Array(unwrapped);
}

describe('NEXORA Full-Stack Integration & Security Suite', () => {
  let server: http.Server;
  let io: ReturnType<typeof setupSocketServer>;
  let baseUrl: string;
  const runTag = crypto.randomBytes(3).toString('hex');
  const createdUserIds: string[] = [];

  before(async () => {
    process.env.NODE_ENV = 'test';
    const app = createApiApp(db);
    server = http.createServer(app);
    io = setupSocketServer(server, db);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    io?.close();
    server?.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
    }
    await createPool().end().catch(() => {});
  });

  async function api(path: string, init: RequestInit = {}, token?: string) {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (typeof init.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function registerUser(_email: string, _username: string) {
    const keys = await generateTestKeyBundle();
    const reg = await api('/api/v1/auth/instant', {
      method: 'POST',
      body: JSON.stringify({
        keys: {
          ecdhPublicJwk: keys.ecdhPublicJwk,
          ecdsaPublicJwk: keys.ecdsaPublicJwk,
          fingerprint: keys.fingerprint,
        },
      }),
    });
    assert.equal(reg.status, 201);
    createdUserIds.push(reg.data.user.id);
    return {
      token: reg.data.sessionToken as string,
      accessKey: reg.data.accessKey as string,
      user: reg.data.user,
      keys,
    };
  }

  test('Auth: Zero-form Instant Device Pass, auto-handle uniqueness, and Access Key restore', async () => {
    const aliceKeys = await generateTestKeyBundle();

    // Missing E2EE keys rejected
    const missingKeys = await api('/api/v1/auth/instant', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(missingKeys.status, 400);

    // 1-click Instant Device Pass succeeds with auto-generated handle + Access Key
    const instantRes = await api('/api/v1/auth/instant', {
      method: 'POST',
      body: JSON.stringify({
        keys: {
          ecdhPublicJwk: aliceKeys.ecdhPublicJwk,
          ecdsaPublicJwk: aliceKeys.ecdsaPublicJwk,
          fingerprint: aliceKeys.fingerprint,
        },
      }),
    });
    assert.equal(instantRes.status, 201);
    assert.ok(instantRes.data.sessionToken);
    assert.ok(instantRes.data.accessKey?.startsWith('nxk_'));
    assert.ok(instantRes.data.user?.username);
    createdUserIds.push(instantRes.data.user.id);

    // Auto-generated handle is marked taken in availability check
    const dupCheck = await api(
      `/api/v1/auth/check-username?username=${instantRes.data.user.username.toLowerCase()}`
    );
    assert.equal(dupCheck.data.available, false);

    // Reject unrecognized Access Key
    const badKey = await api('/api/v1/auth/access-key', {
      method: 'POST',
      body: JSON.stringify({ accessKey: 'nxk_invalid000000000000' }),
    });
    assert.equal(badKey.status, 401);

    // Restore session using issued Access Key succeeds
    const goodRestore = await api('/api/v1/auth/access-key', {
      method: 'POST',
      body: JSON.stringify({ accessKey: instantRes.data.accessKey }),
    });
    assert.equal(goodRestore.status, 200);
    assert.ok(goodRestore.data.sessionToken);
    assert.equal(goodRestore.data.user.id, instantRes.data.user.id);
  });

  test('Private E2EE Messaging: real ciphertext storage, recipient decryption, and 403 isolation', async () => {
    const alice = await registerUser('e2ee_a@nexora.test', 'MysticSoul');
    const bob = await registerUser('e2ee_b@nexora.test', 'CyberGhost');
    const eve = await registerUser('e2ee_c@nexora.test', 'GalaxyQueen');

    // Search by username must never expose email
    const search = await api(`/api/v1/users/search?q=${bob.user.username}`, {}, alice.token);
    assert.equal(search.status, 200);
    assert.equal(search.data.users[0].username, bob.user.username);
    assert.equal('email' in search.data.users[0], false);

    // Create private conversation
    const convRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: bob.user.id }) },
      alice.token
    );
    assert.equal(convRes.status, 201);
    const convId = convRes.data.conversationId as string;

    // Alice encrypts message client-side
    const secretText = 'Top secret NEXORA coordinates: 42.3601 N';
    const msgId = crypto.randomUUID();
    const aad = `${convId}:${alice.user.id}:${msgId}`;
    const msgKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const aesKey = await subtle.importKey('raw', msgKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const ciphertextBuf = await subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      aesKey,
      enc.encode(JSON.stringify({ text: secretText }))
    );

    const envAlice = await wrapKeyForRecipient(msgKey, alice.keys.ecdhPublicJwk, 'nexora-e2ee-key-wrap-v1');
    const envBob = await wrapKeyForRecipient(msgKey, bob.keys.ecdhPublicJwk, 'nexora-e2ee-key-wrap-v1');

    const sendRes = await api(
      `/api/v1/conversations/${convId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          id: msgId,
          kind: 'text',
          ciphertext: bufToB64(ciphertextBuf),
          iv: bufToB64(iv),
          aad,
          recipientEnvelopes: {
            [alice.user.id]: envAlice,
            [bob.user.id]: envBob,
          },
        }),
      },
      alice.token
    );
    assert.equal(sendRes.status, 201);

    // Verify database does NOT contain plaintext
    const dbMsgRows = await db
      .select({ ciphertext: messages.ciphertext })
      .from(messages)
      .where(eq(messages.id, msgId))
      .limit(1);
    assert.equal(dbMsgRows[0].ciphertext.includes('Top secret'), false);

    // Bob fetches & decrypts
    const bobMsgs = await api(`/api/v1/conversations/${convId}/messages`, {}, bob.token);
    assert.equal(bobMsgs.status, 200);
    const fetched = bobMsgs.data.messages[0];
    const unwrappedKey = await unwrapKey(
      fetched.recipientEnvelopes[bob.user.id],
      bob.keys.ecdhPrivateKey,
      'nexora-e2ee-key-wrap-v1'
    );
    const bobAes = await subtle.importKey('raw', unwrappedKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const decryptedBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(fetched.iv), additionalData: enc.encode(fetched.aad) },
      bobAes,
      b64ToBuf(fetched.ciphertext)
    );
    const decoded = JSON.parse(dec.decode(decryptedBuf));
    assert.equal(decoded.text, secretText);

    // Bob sends a cryptographically signed & encrypted read receipt
    const viewedAt = new Date().toISOString();
    const canonicalReceipt = `nexora:read-receipt:v1:${convId}:${msgId}:${bob.user.id}:${viewedAt}`;
    const sigBuf = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      bob.keys.ecdsaPrivateKey,
      enc.encode(canonicalReceipt)
    );
    const receiptKey = crypto.randomBytes(32);
    const receiptIv = crypto.randomBytes(12);
    const receiptAad = `nexora-receipt:${convId}:${msgId}:${bob.user.id}`;
    const receiptAes = await subtle.importKey('raw', receiptKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const receiptCipher = await subtle.encrypt(
      { name: 'AES-GCM', iv: receiptIv, additionalData: enc.encode(receiptAad) },
      receiptAes,
      enc.encode(
        JSON.stringify({
          type: 'read_receipt',
          conversationId: convId,
          messageId: msgId,
          readerId: bob.user.id,
          viewedAt,
          signature: bufToB64(sigBuf),
        })
      )
    );
    const receiptEnvAlice = await wrapKeyForRecipient(receiptKey, alice.keys.ecdhPublicJwk, 'nexora-e2ee-read-receipt-v1');

    // Forged signature must be rejected by server
    const forgedRes = await api(
      `/api/v1/conversations/${convId}/read`,
      {
        method: 'POST',
        body: JSON.stringify({
          receipts: [
            {
              messageId: msgId,
              readerId: bob.user.id,
              viewedAt,
              signature: bufToB64(crypto.randomBytes(64)),
            },
          ],
        }),
      },
      bob.token
    );
    assert.equal(forgedRes.status, 400);
    assert.equal(forgedRes.data.code, 'INVALID_RECEIPT_SIGNATURE');

    // Valid signed & encrypted read receipt succeeds
    const validReadRes = await api(
      `/api/v1/conversations/${convId}/read`,
      {
        method: 'POST',
        body: JSON.stringify({
          receipts: [
            {
              messageId: msgId,
              readerId: bob.user.id,
              viewedAt,
              signature: bufToB64(sigBuf),
              ciphertext: bufToB64(receiptCipher),
              iv: bufToB64(receiptIv),
              aad: receiptAad,
              recipientEnvelopes: { [alice.user.id]: receiptEnvAlice },
            },
          ],
        }),
      },
      bob.token
    );
    assert.equal(validReadRes.status, 200);

    // Alice fetches message, decrypts & verifies Bob's ECDSA read receipt
    const aliceMsgs = await api(`/api/v1/conversations/${convId}/messages`, {}, alice.token);
    assert.equal(aliceMsgs.status, 200);
    const aliceFetched = aliceMsgs.data.messages[0];
    assert.equal(aliceFetched.status, 'read');
    assert.equal(aliceFetched.readReceipts.length, 1);
    const rr = aliceFetched.readReceipts[0];
    const unwrappedReceiptKey = await unwrapKey(
      rr.recipientEnvelopes[alice.user.id],
      alice.keys.ecdhPrivateKey,
      'nexora-e2ee-read-receipt-v1'
    );
    const aliceReceiptAes = await subtle.importKey('raw', unwrappedReceiptKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const receiptPlain = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(rr.iv), additionalData: enc.encode(rr.aad) },
      aliceReceiptAes,
      b64ToBuf(rr.ciphertext)
    );
    const receiptDecoded = JSON.parse(dec.decode(receiptPlain));
    const bobVerifyKey = await subtle.importKey(
      'jwk',
      JSON.parse(bob.keys.ecdsaPublicJwk),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const sigValid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      bobVerifyKey,
      b64ToBuf(receiptDecoded.signature),
      enc.encode(`nexora:read-receipt:v1:${convId}:${msgId}:${bob.user.id}:${receiptDecoded.viewedAt}`)
    );
    assert.equal(sigValid, true);

    // Eve (unauthorized) cannot read conversation
    const eveAccess = await api(`/api/v1/conversations/${convId}/messages`, {}, eve.token);
    assert.equal(eveAccess.status, 403);
  });

  test('Groups: 25-member transactional cap & Epoch rotation on removal', async () => {
    const owner = await registerUser('grp_owner@nexora.test', 'GroupOwner1');
    const members: Array<Awaited<ReturnType<typeof registerUser>>> = [];
    for (let batchStart = 1; batchStart <= 25; batchStart += 5) {
      const batch = await Promise.all(
        Array.from({ length: 5 }, (_, idx) => {
          const i = batchStart + idx;
          return registerUser(`grp_m${i}@nexora.test`, `Member_${i}`);
        })
      );
      members.push(...batch);
    }

    // Create group with owner + 23 members = 24
    const initial23 = members.slice(0, 23);
    const grpRes = await api(
      '/api/v1/groups',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Cosmic Council',
          memberIds: initial23.map((m) => m.user.id),
          epochEnvelopes: [],
        }),
      },
      owner.token
    );
    assert.equal(grpRes.status, 201);
    assert.equal(grpRes.data.memberCount, 24);
    const groupId = grpRes.data.groupId as string;

    // Adding 25th member succeeds
    const add25 = await api(
      `/api/v1/groups/${groupId}/members`,
      {
        method: 'POST',
        body: JSON.stringify({ userId: members[23].user.id, epochEnvelopes: [] }),
      },
      owner.token
    );
    assert.equal(add25.status, 201);
    assert.equal(add25.data.currentEpoch, 2);

    // Adding 26th member MUST fail with 400 GROUP_CAPACITY_EXCEEDED
    const add26 = await api(
      `/api/v1/groups/${groupId}/members`,
      {
        method: 'POST',
        body: JSON.stringify({ userId: members[24].user.id, epochEnvelopes: [] }),
      },
      owner.token
    );
    assert.equal(add26.status, 400);
    assert.equal(add26.data.code, 'GROUP_CAPACITY_EXCEEDED');

    // Remove a member and confirm epoch advances & removed user loses access
    const removeRes = await api(
      `/api/v1/groups/${groupId}/members/${members[0].user.id}`,
      { method: 'DELETE', body: JSON.stringify({ epochEnvelopes: [] }) },
      owner.token
    );
    assert.equal(removeRes.status, 200);
    assert.equal(removeRes.data.currentEpoch, 3);

    const removedAccess = await api(`/api/v1/groups/${groupId}`, {}, members[0].token);
    assert.equal(removedAccess.status, 403);
  });

  test('Media Authorization, 24h Stories Expiration & Server-Side Streaks', async () => {
    const u1 = await registerUser('media_u1@nexora.test', 'MoonLight');
    const u2 = await registerUser('media_u2@nexora.test', 'StarGazer');
    const stranger = await registerUser('media_u3@nexora.test', 'Intruder99');

    // Connect u1 & u2 as friends
    const reqRes = await api(
      '/api/v1/friends/requests',
      { method: 'POST', body: JSON.stringify({ userId: u2.user.id }) },
      u1.token
    );
    assert.equal(reqRes.status, 201);
    const accRes = await api(
      `/api/v1/friends/requests/${reqRes.data.id}/respond`,
      { method: 'POST', body: JSON.stringify({ action: 'accept' }) },
      u2.token
    );
    assert.equal(accRes.status, 200);

    // Encrypted story upload
    const fakeCipherBytes = crypto.randomBytes(64);
    const upRes = await fetch(`${baseUrl}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${u1.token}`,
        'Content-Type': 'application/octet-stream',
        'x-nexora-story': '1',
        'x-nexora-mime-type': 'image/webp',
        'x-nexora-original-size': '64',
      },
      body: fakeCipherBytes,
    });
    assert.equal(upRes.status, 201);
    const { attachmentId } = (await upRes.json()) as { attachmentId: string };

    const storyRes = await api(
      '/api/v1/stories',
      {
        method: 'POST',
        body: JSON.stringify({
          mediaType: 'image',
          attachmentId,
          ciphertextMeta: 'encmeta',
          iv: 'enciv',
          recipientEnvelopes: {
            [u1.user.id]: { ephemeralPublicJwk: '{}', wrappedKey: 'a', iv: 'b' },
            [u2.user.id]: { ephemeralPublicJwk: '{}', wrappedKey: 'c', iv: 'd' },
          },
          visibility: 'friends',
        }),
      },
      u1.token
    );
    assert.equal(storyRes.status, 201);

    // Friend u2 CAN access encrypted story media; stranger gets 403
    const friendMedia = await fetch(`${baseUrl}/api/v1/media/${attachmentId}`, {
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    assert.equal(friendMedia.status, 200);

    const strangerMedia = await fetch(`${baseUrl}/api/v1/media/${attachmentId}`, {
      headers: { Authorization: `Bearer ${stranger.token}` },
    });
    assert.equal(strangerMedia.status, 403);

    // Expire story & run retention cleanup
    await db
      .update(stories)
      .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(stories.id, storyRes.data.id));
    await runRetentionCleanup(db);
    const storiesAfter = await api('/api/v1/stories', {}, u2.token);
    assert.equal(storiesAfter.data.stories.length, 0);

    // Server-side reciprocal Streak calculation
    const t0 = Date.now();
    const s1 = await recordStreakActivity(db, u1.user.id, u2.user.id, t0);
    assert.equal(s1.streakCount, 0);
    const s2 = await recordStreakActivity(db, u2.user.id, u1.user.id, t0 + 60_000);
    assert.equal(s2.streakCount, 1);
    assert.equal(s2.isActive, true);
  });
});
