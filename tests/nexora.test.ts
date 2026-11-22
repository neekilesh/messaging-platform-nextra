import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createPool, db } from '../src/db/index.ts';
import { messageReactions, messages, stories, users } from '../src/db/schema.ts';
import { createApiApp, runRetentionCleanup } from '../server/app.ts';
import { setupSocketServer } from '../server/socket.ts';

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

  test('E2EE Message Reactions: encrypted storage, multi-recipient decryption, update/remove, and 403 isolation', async () => {
    const alice = await registerUser('react_a@nexora.test', 'ReactAlice');
    const bob = await registerUser('react_b@nexora.test', 'ReactBob');
    const eve = await registerUser('react_e@nexora.test', 'ReactEve');

    const convRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: bob.user.id }) },
      alice.token
    );
    assert.equal(convRes.status, 201);
    const convId = convRes.data.conversationId as string;

    const msgId = crypto.randomUUID();
    const sendRes = await api(
      `/api/v1/conversations/${convId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          id: msgId,
          kind: 'text',
          ciphertext: bufToB64(crypto.randomBytes(24)),
          iv: bufToB64(crypto.randomBytes(12)),
          aad: `${convId}:${alice.user.id}:${msgId}`,
          recipientEnvelopes: {},
        }),
      },
      alice.token
    );
    assert.equal(sendRes.status, 201);

    async function buildEncryptedReactionPayload(userId: string, emojis: string[]) {
      const aad = `nexora-reaction:${convId}:${msgId}:${userId}`;
      const rawKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const aesKey = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
      const ciphertextBuf = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
        aesKey,
        enc.encode(
          JSON.stringify({
            type: 'reaction',
            conversationId: convId,
            messageId: msgId,
            userId,
            emojis,
            updatedAt: new Date().toISOString(),
          })
        )
      );
      const envAlice = await wrapKeyForRecipient(rawKey, alice.keys.ecdhPublicJwk, 'nexora-e2ee-reaction-v1');
      const envBob = await wrapKeyForRecipient(rawKey, bob.keys.ecdhPublicJwk, 'nexora-e2ee-reaction-v1');
      return {
        ciphertext: bufToB64(ciphertextBuf),
        iv: bufToB64(iv),
        aad,
        recipientEnvelopes: {
          [alice.user.id]: envAlice,
          [bob.user.id]: envBob,
        },
      };
    }

    // Tampered AAD rejected
    const payload1 = await buildEncryptedReactionPayload(bob.user.id, ['❤️', '🔥']);
    const badAadRes = await api(
      `/api/v1/conversations/messages/${msgId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ ...payload1, aad: `nexora-reaction:tampered:${msgId}:${bob.user.id}` }),
      },
      bob.token
    );
    assert.equal(badAadRes.status, 400);

    // Non-participant Eve gets 403
    const eveReact = await api(
      `/api/v1/conversations/messages/${msgId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify(await buildEncryptedReactionPayload(eve.user.id, ['😂'])),
      },
      eve.token
    );
    assert.equal(eveReact.status, 403);

    // Bob adds E2EE reactions ['❤️', '🔥']
    const bobReact1 = await api(
      `/api/v1/conversations/messages/${msgId}/reactions`,
      { method: 'POST', body: JSON.stringify(payload1) },
      bob.token
    );
    assert.equal(bobReact1.status, 200);
    assert.equal(bobReact1.data.reactions.length, 0);
    assert.equal(bobReact1.data.encryptedReactions.length, 1);

    // Verify DB stores opaque sentinel and ciphertext without plaintext emoji
    const dbReactRows = await db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.messageId, msgId));
    assert.equal(dbReactRows.length, 1);
    assert.equal(dbReactRows[0].emoji, '__e2ee__');
    assert.equal(dbReactRows[0].ciphertext?.includes('❤️'), false);
    assert.equal(dbReactRows[0].ciphertext?.includes('🔥'), false);

    // Alice fetches message and decrypts Bob's E2EE reaction
    const aliceMsgs = await api(`/api/v1/conversations/${convId}/messages`, {}, alice.token);
    assert.equal(aliceMsgs.status, 200);
    const encR = aliceMsgs.data.messages[0].encryptedReactions[0];
    assert.ok(encR.recipientEnvelopes[alice.user.id]);
    assert.equal(encR.recipientEnvelopes[bob.user.id], undefined);
    const unwrappedKey = await unwrapKey(
      encR.recipientEnvelopes[alice.user.id],
      alice.keys.ecdhPrivateKey,
      'nexora-e2ee-reaction-v1'
    );
    const aesDecryptKey = await subtle.importKey('raw', unwrappedKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plainReactBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(encR.iv), additionalData: enc.encode(encR.aad) },
      aesDecryptKey,
      b64ToBuf(encR.ciphertext)
    );
    const decodedReact = JSON.parse(dec.decode(plainReactBuf));
    assert.deepEqual(decodedReact.emojis, ['❤️', '🔥']);
    assert.equal(decodedReact.userId, bob.user.id);

    // Bob updates reaction to ['🔥'] (upsert overwrites previous encrypted row)
    const payload2 = await buildEncryptedReactionPayload(bob.user.id, ['🔥']);
    const bobReact2 = await api(
      `/api/v1/conversations/messages/${msgId}/reactions`,
      { method: 'POST', body: JSON.stringify(payload2) },
      bob.token
    );
    assert.equal(bobReact2.status, 200);
    const encR2 = bobReact2.data.encryptedReactions[0];
    const unwrappedKey2 = await unwrapKey(
      encR2.recipientEnvelopes[bob.user.id],
      bob.keys.ecdhPrivateKey,
      'nexora-e2ee-reaction-v1'
    );
    const aesDecryptKey2 = await subtle.importKey('raw', unwrappedKey2, { name: 'AES-GCM' }, false, ['decrypt']);
    const plainReactBuf2 = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(encR2.iv), additionalData: enc.encode(encR2.aad) },
      aesDecryptKey2,
      b64ToBuf(encR2.ciphertext)
    );
    assert.deepEqual(JSON.parse(dec.decode(plainReactBuf2)).emojis, ['🔥']);

    // Bob removes all reactions
    const bobRemove = await api(
      `/api/v1/conversations/messages/${msgId}/reactions`,
      { method: 'POST', body: JSON.stringify({ remove: true }) },
      bob.token
    );
    assert.equal(bobRemove.status, 200);
    assert.equal(bobRemove.data.encryptedReactions.length, 0);
    const dbAfterRemove = await db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.messageId, msgId));
    assert.equal(dbAfterRemove.length, 0);
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

  test('Media Authorization & 24h Stories Expiration', async () => {
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
  });
});
