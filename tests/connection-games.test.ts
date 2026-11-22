import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { createPool, db } from '../src/db/index.ts';
import {
  dailyChallengeAssignments,
  dailyChallenges,
  dailyConnectionStreaks,
  deepTalkAnswers,
  deepTalkQuestions,
  friendships,
  notifications,
  users,
} from '../src/db/schema.ts';
import { createApiApp } from '../server/app.ts';
import { setupSocketServer } from '../server/socket.ts';
import {
  runDailyChallengeScheduler,
  startDailyChallengeScheduler,
} from '../server/routes/connection-games.ts';

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
  const ecdsa = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const ecdhPublicJwk = JSON.stringify(await subtle.exportKey('jwk', ecdh.publicKey));
  const ecdsaPublicJwk = JSON.stringify(await subtle.exportKey('jwk', ecdsa.publicKey));
  return {
    ecdhPrivateKey: ecdh.privateKey,
    ecdsaPrivateKey: ecdsa.privateKey,
    ecdhPublicJwk,
    ecdsaPublicJwk,
    fingerprint: '22222 33333 44444 55555 66666',
  };
}

async function wrapKeyForRecipient(
  rawKey: Uint8Array,
  recipientPublicJwkStr: string,
  infoText = 'nexora-e2ee-key-wrap-v1'
) {
  const epk = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const peerPub = await subtle.importKey(
    'jwk',
    JSON.parse(recipientPublicJwkStr),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
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

async function encryptAnswerForPair(
  text: string,
  aad: string,
  sender: { userId: string; ecdhPublicJwk: string },
  peer: { userId: string; ecdhPublicJwk: string }
) {
  const msgKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const aesKey = await subtle.importKey('raw', msgKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertextBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    aesKey,
    enc.encode(JSON.stringify({ text }))
  );

  return {
    ciphertext: bufToB64(ciphertextBuf),
    iv: bufToB64(iv),
    aad,
    recipientEnvelopes: {
      [sender.userId]: await wrapKeyForRecipient(msgKey, sender.ecdhPublicJwk),
      [peer.userId]: await wrapKeyForRecipient(msgKey, peer.ecdhPublicJwk),
    },
  };
}

async function decryptAnswerForUser(
  answer: {
    ciphertext: string;
    iv: string;
    aad: string;
    recipientEnvelopes: Record<string, { ephemeralPublicJwk: string; wrappedKey: string; iv: string }>;
  },
  userId: string,
  ecdhPrivateKey: CryptoKey
): Promise<string> {
  const env = answer.recipientEnvelopes[userId];
  assert.ok(env, `Missing recipient envelope for user ${userId}`);
  const epkPub = await subtle.importKey(
    'jwk',
    JSON.parse(env.ephemeralPublicJwk),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedBits = await subtle.deriveBits({ name: 'ECDH', public: epkPub }, ecdhPrivateKey, 256);
  const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const wrapAes = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: enc.encode('nexora-e2ee-key-wrap-v1'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const rawKey = new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(env.iv) }, wrapAes, b64ToBuf(env.wrappedKey))
  );
  const aesKey = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(answer.iv), additionalData: enc.encode(answer.aad) },
    aesKey,
    b64ToBuf(answer.ciphertext)
  );
  return (JSON.parse(dec.decode(plainBuf)) as { text: string }).text;
}

describe('NEXORA Connection Games (Deep Talk Cards & Daily Challenge) Suite', () => {
  let server: http.Server;
  let io: ReturnType<typeof setupSocketServer>;
  let baseUrl: string;
  const createdUserIds: string[] = [];
  const createdCustomQuestionIds: string[] = [];

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
    if (createdCustomQuestionIds.length > 0) {
      await db
        .delete(deepTalkQuestions)
        .where(inArray(deepTalkQuestions.id, createdCustomQuestionIds))
        .catch(() => {});
    }
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

  async function registerUser() {
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
      user: reg.data.user as { id: string; username: string; displayName: string },
      keys,
    };
  }

  test('Seeded library, expandable questions, private-only enforcement, and 403 isolation', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const eve = await registerUser();

    const catRes = await api('/api/v1/connection-games/categories', {}, alice.token);
    assert.equal(catRes.status, 200);
    assert.equal(catRes.data.categories.length, 6);
    const totalQuestions = catRes.data.categories.reduce(
      (sum: number, c: { questionCount: number }) => sum + c.questionCount,
      0
    );
    assert.ok(totalQuestions >= 30);

    const dcRows = await db.select().from(dailyChallenges);
    assert.ok(dcRows.length >= 18);

    // Add custom question to backend collection
    const addQ = await api(
      '/api/v1/connection-games/questions',
      {
        method: 'POST',
        body: JSON.stringify({
          categoryId: 'deep-meaningful',
          questionText: 'What quiet habit brings you the most peace?',
        }),
      },
      alice.token
    );
    assert.equal(addQ.status, 201);
    createdCustomQuestionIds.push(addQ.data.question.id);

    // Group conversations cannot use Connection Games (400)
    const grpRes = await api(
      '/api/v1/groups',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Group No Games',
          memberIds: [bob.user.id],
          epochEnvelopes: [],
        }),
      },
      alice.token
    );
    assert.equal(grpRes.status, 201);
    const grpOverview = await api(
      `/api/v1/connection-games/conversations/${grpRes.data.conversationId}`,
      {},
      alice.token
    );
    assert.equal(grpOverview.status, 400);

    // Create private conversation & verify non-participant Eve gets 403
    const convRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: bob.user.id }) },
      alice.token
    );
    assert.equal(convRes.status, 201);

    const eveAccess = await api(
      `/api/v1/connection-games/conversations/${convRes.data.conversationId}`,
      {},
      eve.token
    );
    assert.equal(eveAccess.status, 403);
  });

  test('Deep Talk Cards: invite accept/decline, E2EE gated reveal, reactions, skip, mutual next, unlimited refill, pause/resume, recovery', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const eve = await registerUser();

    const convRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: bob.user.id }) },
      alice.token
    );
    assert.equal(convRes.status, 201);
    const convId = convRes.data.conversationId as string;

    // 1. Start session & decline
    const inviteRes = await api(
      `/api/v1/connection-games/conversations/${convId}/deep-talk/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({ categoryId: 'getting-to-know-you', questionLimit: 5 }),
      },
      alice.token
    );
    assert.equal(inviteRes.status, 201);
    assert.equal(inviteRes.data.session.status, 'invited');

    // Initiator cannot accept own invite (403)
    const selfAccept = await api(
      `/api/v1/connection-games/deep-talk/sessions/${inviteRes.data.session.id}/respond`,
      { method: 'POST', body: JSON.stringify({ action: 'accept' }) },
      alice.token
    );
    assert.equal(selfAccept.status, 403);

    // Peer declines
    const declineRes = await api(
      `/api/v1/connection-games/deep-talk/sessions/${inviteRes.data.session.id}/respond`,
      { method: 'POST', body: JSON.stringify({ action: 'decline' }) },
      bob.token
    );
    assert.equal(declineRes.status, 200);
    assert.equal(declineRes.data.session.status, 'declined');

    // 1b. Fetch random questions by category & validate filters/exclusions
    const unauthRandom = await api('/api/v1/connection-games/deep-talk/questions/random');
    assert.equal(unauthRandom.status, 401);

    const catRandom = await api(
      '/api/v1/connection-games/deep-talk/questions/random?categoryId=dreams-future&limit=3',
      {},
      alice.token
    );
    assert.equal(catRandom.status, 200);
    assert.equal(catRandom.data.categoryId, 'dreams-future');
    assert.equal(catRandom.data.questions.length, 3);
    assert.ok(
      catRandom.data.questions.every((q: { categoryId: string }) => q.categoryId === 'dreams-future')
    );

    const excludedIds = catRandom.data.questions.map((q: { id: string }) => q.id).join(',');
    const remainingRandom = await api(
      `/api/v1/connection-games/deep-talk/questions/random?categoryId=dreams-future&limit=5&exclude=${encodeURIComponent(excludedIds)}`,
      {},
      alice.token
    );
    assert.equal(remainingRandom.status, 200);
    assert.equal(remainingRandom.data.questions.length, 2);

    const mixRandom = await api(
      '/api/v1/connection-games/questions/random?categoryId=random&limit=8',
      {},
      alice.token
    );
    assert.equal(mixRandom.status, 200);
    assert.equal(mixRandom.data.questions.length, 8);

    const invalidCatRandom = await api(
      '/api/v1/connection-games/deep-talk/questions/random?categoryId=does-not-exist',
      {},
      alice.token
    );
    assert.equal(invalidCatRandom.status, 404);

    const badLimitRandom = await api(
      '/api/v1/connection-games/deep-talk/questions/random?limit=0',
      {},
      alice.token
    );
    assert.equal(badLimitRandom.status, 400);

    // 2. Start unlimited session on a single category & accept
    const unlimitedRes = await api(
      `/api/v1/connection-games/conversations/${convId}/deep-talk/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({ categoryId: 'funny-random', questionLimit: null }),
      },
      alice.token
    );
    assert.equal(unlimitedRes.status, 201);
    const sessionId = unlimitedRes.data.session.id as string;

    // Direct session retrieval & 403 non-participant isolation
    const eveSessionGet = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}`,
      {},
      eve.token
    );
    assert.equal(eveSessionGet.status, 403);

    const aliceSessionGet = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}`,
      {},
      alice.token
    );
    assert.equal(aliceSessionGet.status, 200);
    assert.equal(aliceSessionGet.data.session.id, sessionId);

    const acceptRes = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/respond`,
      { method: 'POST', body: JSON.stringify({ action: 'accept' }) },
      bob.token
    );
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.data.session.status, 'active');

    const card0 = acceptRes.data.session.currentCard;
    assert.ok(card0?.question?.id);

    // Reject encrypted answer missing peer envelope or malformed envelope fields
    const missingPeerEnvelope = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({
          questionId: card0.question.id,
          ciphertext: 'abc',
          iv: 'def',
          aad: 'ghi',
          recipientEnvelopes: {
            [alice.user.id]: {
              ephemeralPublicJwk: '{}',
              wrappedKey: 'wrap',
              iv: 'iv1',
            },
          },
        }),
      },
      alice.token
    );
    assert.equal(missingPeerEnvelope.status, 400);

    // 3. Alice submits encrypted answer -> NOT revealed yet
    const alicePlain = 'Teleporting straight to Kyoto whenever I want!';
    const encAlice = await encryptAnswerForPair(
      alicePlain,
      `deep_talk:${convId}:${sessionId}:${card0.question.id}`,
      { userId: alice.user.id, ecdhPublicJwk: alice.keys.ecdhPublicJwk },
      { userId: bob.user.id, ecdhPublicJwk: bob.keys.ecdhPublicJwk }
    );

    const ansAlice = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({ questionId: card0.question.id, ...encAlice }),
      },
      alice.token
    );
    assert.equal(ansAlice.status, 201);
    assert.equal(ansAlice.data.revealed, false);

    // Duplicate answer returns 409
    const dupAlice = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({ questionId: card0.question.id, ...encAlice }),
      },
      alice.token
    );
    assert.equal(dupAlice.status, 409);

    // GATED REVEAL CHECK: Bob reloads overview before answering -> must NOT see Alice's answer
    const bobPeek = await api(
      `/api/v1/connection-games/conversations/${convId}?tz=UTC`,
      {},
      bob.token
    );
    assert.equal(bobPeek.status, 200);
    const peekCard = bobPeek.data.activeDeepTalkSession.currentCard;
    assert.equal(peekCard.peerAnswered, true);
    assert.equal(peekCard.myAnswered, false);
    assert.equal(peekCard.revealed, false);
    assert.equal(peekCard.answers.length, 0);

    // 4. Bob submits encrypted answer -> mutual reveal unlocked!
    const bobPlain = 'Talking to animals at dawn!';
    const encBob = await encryptAnswerForPair(
      bobPlain,
      `deep_talk:${convId}:${sessionId}:${card0.question.id}`,
      { userId: bob.user.id, ecdhPublicJwk: bob.keys.ecdhPublicJwk },
      { userId: alice.user.id, ecdhPublicJwk: alice.keys.ecdhPublicJwk }
    );
    const ansBob = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({ questionId: card0.question.id, ...encBob }),
      },
      bob.token
    );
    assert.equal(ansBob.status, 201);
    assert.equal(ansBob.data.revealed, true);
    assert.equal(ansBob.data.session.currentCard.answers.length, 2);

    // DB must NOT store plaintext
    const dbAnsRows = await db
      .select()
      .from(deepTalkAnswers)
      .where(eq(deepTalkAnswers.sessionId, sessionId));
    assert.equal(dbAnsRows.length, 2);
    assert.equal(dbAnsRows.some((r) => r.ciphertext.includes('Kyoto')), false);

    // Bob decrypts Alice's answer and Alice decrypts Bob's answer
    const bobViewOfAliceAns = ansBob.data.session.currentCard.answers.find(
      (a: { userId: string }) => a.userId === alice.user.id
    );
    assert.equal(
      await decryptAnswerForUser(bobViewOfAliceAns, bob.user.id, bob.keys.ecdhPrivateKey),
      alicePlain
    );

    const aliceReload = await api(
      `/api/v1/connection-games/conversations/${convId}?tz=UTC`,
      {},
      alice.token
    );
    assert.equal(aliceReload.status, 200);
    const aliceViewOfBobAns = aliceReload.data.activeDeepTalkSession.currentCard.answers.find(
      (a: { userId: string }) => a.userId === bob.user.id
    );
    assert.equal(
      await decryptAnswerForUser(aliceViewOfBobAns, alice.user.id, alice.keys.ecdhPrivateKey),
      bobPlain
    );

    // 5. React to revealed answer
    const reactRes = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/react`,
      {
        method: 'POST',
        body: JSON.stringify({ answerId: bobViewOfAliceAns.id, emoji: '❤️' }),
      },
      bob.token
    );
    assert.equal(reactRes.status, 200);
    const reactedAns = reactRes.data.session.currentCard.answers.find(
      (a: { id: string }) => a.id === bobViewOfAliceAns.id
    );
    assert.equal(reactedAns.reactions.length, 1);
    assert.equal(reactedAns.reactions[0].emoji, '❤️');

    // 6. Mutual ready to advance
    const nextAlice = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/next`,
      { method: 'POST' },
      alice.token
    );
    assert.equal(nextAlice.status, 200);
    assert.equal(nextAlice.data.advanced, false);
    assert.deepEqual(nextAlice.data.session.readyUserIds, [alice.user.id]);

    const nextBob = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/next`,
      { method: 'POST' },
      bob.token
    );
    assert.equal(nextBob.status, 200);
    assert.equal(nextBob.data.advanced, true);
    assert.equal(nextBob.data.session.currentQuestionIndex, 1);

    // 7. Pause & Resume (cannot start another session while paused -> 409)
    const pauseRes = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/status`,
      { method: 'POST', body: JSON.stringify({ action: 'pause' }) },
      alice.token
    );
    assert.equal(pauseRes.status, 200);
    assert.equal(pauseRes.data.session.status, 'paused');

    const conflictWhilePaused = await api(
      `/api/v1/connection-games/conversations/${convId}/deep-talk/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({ categoryId: 'random', questionLimit: 5 }),
      },
      alice.token
    );
    assert.equal(conflictWhilePaused.status, 409);

    const resumeRes = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/status`,
      { method: 'POST', body: JSON.stringify({ action: 'resume' }) },
      bob.token
    );
    assert.equal(resumeRes.status, 200);
    assert.equal(resumeRes.data.session.status, 'active');

    // 8. Skip through remaining cards up to index 5 to verify unlimited refill works cleanly!
    for (let step = 0; step < 5; step++) {
      const skipRes = await api(
        `/api/v1/connection-games/deep-talk/sessions/${sessionId}/skip`,
        { method: 'POST' },
        alice.token
      );
      assert.equal(skipRes.status, 200);
      assert.equal(skipRes.data.session.status, 'active');
      assert.ok(skipRes.data.session.currentCard);
    }

    // Reconnect state recovery check
    const recovered = await api(
      `/api/v1/connection-games/conversations/${convId}?tz=UTC`,
      {},
      bob.token
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.activeDeepTalkSession.currentQuestionIndex, 6);
    assert.equal(recovered.data.activeDeepTalkSession.revealedHistory.length, 1);

    // End session cleanly
    const endRes = await api(
      `/api/v1/connection-games/deep-talk/sessions/${sessionId}/status`,
      { method: 'POST', body: JSON.stringify({ action: 'end' }) },
      alice.token
    );
    assert.equal(endRes.status, 200);
    assert.equal(endRes.data.session.status, 'ended');
  });

  test('Daily Connection Challenge: 1 shared challenge per pair per day, E2EE reveal, streak milestones, missed-day reset, skip & notification privacy', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    // Disable connection game notifications for Alice to test preference guard
    const privPatch = await api(
      '/api/v1/users/me/privacy',
      { method: 'PATCH', body: JSON.stringify({ allowConnectionGameNotifications: false }) },
      alice.token
    );
    assert.equal(privPatch.status, 200);
    assert.equal(privPatch.data.privacy.allowConnectionGameNotifications, false);

    const convRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: bob.user.id }) },
      alice.token
    );
    assert.equal(convRes.status, 201);
    const convId = convRes.data.conversationId as string;

    // 1. Both participants get the exact same todayChallenge
    const dcAlice = await api(
      `/api/v1/connection-games/conversations/${convId}/daily-challenge?tz=America/New_York`,
      {},
      alice.token
    );
    const dcBob = await api(
      `/api/v1/connection-games/conversations/${convId}/daily-challenge?tz=America/New_York`,
      {},
      bob.token
    );
    assert.equal(dcAlice.status, 200);
    assert.equal(dcBob.status, 200);
    assert.equal(dcAlice.data.todayChallenge.id, dcBob.data.todayChallenge.id);
    assert.equal(
      dcAlice.data.todayChallenge.challenge.id,
      dcBob.data.todayChallenge.challenge.id
    );
    assert.equal(dcAlice.data.todayChallenge.userState, 'new_challenge');

    const assignId = dcAlice.data.todayChallenge.id as string;
    const todayDate = dcAlice.data.todayDate as string;

    // Seed a 2-day consecutive completed streak ending yesterday so completing today reaches the 3-day milestone!
    const [y, m, d] = todayDate.split('-').map(Number);
    const yesterdayDate = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    await db
      .update(dailyConnectionStreaks)
      .set({
        currentStreak: 2,
        longestStreak: 2,
        totalCompleted: 2,
        lastCompletedDate: yesterdayDate,
      })
      .where(eq(dailyConnectionStreaks.conversationId, convId));

    // Insert a stale pending challenge from 2 days ago to verify automatic expiration
    const twoDaysAgo = new Date(Date.UTC(y, m - 1, d - 2)).toISOString().slice(0, 10);
    await db.insert(dailyChallengeAssignments).values({
      id: crypto.randomUUID(),
      conversationId: convId,
      privatePairKey: `${[alice.user.id, bob.user.id].sort().join(':')}`,
      challengeId: 'dc_fun_1',
      challengeDate: twoDaysAgo,
      timezone: 'America/New_York',
      lifecycleStatus: 'pending',
      expiresAt: '2020-01-01T00:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    });

    // 2. Bob responds first -> Alice is waiting_for_you & Bob is waiting_for_friend; Alice didn't get notification (disabled)
    const bobText = 'Grateful for how calm you always stay under pressure.';
    const encBob = await encryptAnswerForPair(
      bobText,
      `daily_challenge:${convId}:${assignId}`,
      { userId: bob.user.id, ecdhPublicJwk: bob.keys.ecdhPublicJwk },
      { userId: alice.user.id, ecdhPublicJwk: alice.keys.ecdhPublicJwk }
    );
    const respBob = await api(
      `/api/v1/connection-games/conversations/${convId}/daily-challenge/respond`,
      {
        method: 'POST',
        body: JSON.stringify({ assignmentId: assignId, ...encBob }),
      },
      bob.token
    );
    assert.equal(respBob.status, 201);
    assert.equal(respBob.data.todayChallenge.userState, 'waiting_for_friend');
    assert.equal(respBob.data.todayChallenge.revealed, false);

    // Duplicate response returns 409
    const dupBob = await api(
      `/api/v1/connection-games/conversations/${convId}/daily-challenge/respond`,
      {
        method: 'POST',
        body: JSON.stringify({ assignmentId: assignId, ...encBob }),
      },
      bob.token
    );
    assert.equal(dupBob.status, 409);

    // Alice peeks -> waiting_for_you, cannot see Bob's text yet
    const aliceCheck = await api(
      `/api/v1/connection-games/conversations/${convId}/daily-challenge?tz=America/New_York`,
      {},
      alice.token
    );
    assert.equal(aliceCheck.status, 200);
    assert.equal(aliceCheck.data.todayChallenge.userState, 'waiting_for_you');
    assert.equal(aliceCheck.data.todayChallenge.responses.length, 0);
    // Past expired assignment shows up in history as missed
    assert.equal(aliceCheck.data.history.length, 1);
    assert.equal(aliceCheck.data.history[0].userState, 'missed');

    // Alice suppressed connection game notifications -> 0 connection notifications for Alice
    const aliceNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, alice.user.id), eq(notifications.type, 'daily_challenge_ready'))
      );
    assert.equal(aliceNotifs.length, 0);

    // 3. Alice completes -> mutual reveal + 3-day milestone unlocked + Bob gets notifications
    const aliceText = 'You always bring light into difficult weeks!';
    const encAlice = await encryptAnswerForPair(
      aliceText,
      `daily_challenge:${convId}:${assignId}`,
      { userId: alice.user.id, ecdhPublicJwk: alice.keys.ecdhPublicJwk },
      { userId: bob.user.id, ecdhPublicJwk: bob.keys.ecdhPublicJwk }
    );
    const respAlice = await api(
      `/api/v1/connection-games/conversations/${convId}/daily-challenge/respond`,
      {
        method: 'POST',
        body: JSON.stringify({ assignmentId: assignId, ...encAlice }),
      },
      alice.token
    );
    assert.equal(respAlice.status, 201);
    assert.equal(respAlice.data.todayChallenge.userState, 'both_completed');
    assert.equal(respAlice.data.todayChallenge.revealed, true);
    assert.equal(respAlice.data.todayChallenge.responses.length, 2);
    assert.equal(respAlice.data.connectionStreak.currentStreak, 3);
    assert.equal(respAlice.data.connectionStreak.longestStreak, 3);
    assert.equal(respAlice.data.connectionStreak.milestoneReached, 3);

    // Decrypt Bob's response as Alice
    const bobEntry = respAlice.data.todayChallenge.responses.find(
      (r: { userId: string }) => r.userId === bob.user.id
    );
    assert.equal(
      await decryptAnswerForUser(bobEntry, alice.user.id, alice.keys.ecdhPrivateKey),
      bobText
    );

    // React to completed daily challenge response
    const reactDaily = await api(
      `/api/v1/connection-games/conversations/${convId}/daily-challenge/react`,
      { method: 'POST', body: JSON.stringify({ responseId: bobEntry.id, emoji: '✨' }) },
      alice.token
    );
    assert.equal(reactDaily.status, 200);
    const reactedResp = reactDaily.data.todayChallenge.responses.find(
      (r: { id: string }) => r.id === bobEntry.id
    );
    assert.equal(reactedResp.reactions[0].emoji, '✨');

    // Bob received both completion & 3-day milestone notifications
    const bobNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, bob.user.id));
    assert.ok(bobNotifs.some((n) => n.type === 'daily_challenge_completed'));
    assert.ok(bobNotifs.some((n) => n.type === 'connection_streak_milestone'));

    // 4. Verify missed-day streak reset preserves longestStreak
    const threeDaysAgo = new Date(Date.UTC(y, m - 1, d - 3)).toISOString().slice(0, 10);
    await db
      .update(dailyConnectionStreaks)
      .set({ lastCompletedDate: threeDaysAgo })
      .where(eq(dailyConnectionStreaks.conversationId, convId));

    const resetCheck = await api(
      `/api/v1/connection-games/conversations/${convId}/daily-challenge?tz=America/New_York`,
      {},
      alice.token
    );
    assert.equal(resetCheck.status, 200);
    assert.equal(resetCheck.data.connectionStreak.currentStreak, 0);
    assert.equal(resetCheck.data.connectionStreak.longestStreak, 3);

    // 5. Verify skip works on a new pair's pending challenge
    const eve = await registerUser();
    const conv2Res = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: eve.user.id }) },
      alice.token
    );
    const conv2Id = conv2Res.data.conversationId as string;
    const dc2 = await api(
      `/api/v1/connection-games/conversations/${conv2Id}/daily-challenge?tz=UTC`,
      {},
      alice.token
    );
    const skip2 = await api(
      `/api/v1/connection-games/conversations/${conv2Id}/daily-challenge/skip`,
      { method: 'POST', body: JSON.stringify({ assignmentId: dc2.data.todayChallenge.id }) },
      alice.token
    );
    assert.equal(skip2.status, 200);
    assert.equal(skip2.data.todayChallenge.userState, 'skipped');
  });

  test('Daily Connection Challenge Scheduler: timezone rollover, 24h idempotency, active-friend filtering, and notifications', async () => {
    const tokyoAlice = await registerUser();
    const tokyoBob = await registerUser();
    const nyCarol = await registerUser();
    const nyDave = await registerUser();
    const blockedEve = await registerUser();
    const strangerFrank = await registerUser();

    // 1. Validate PUT /api/v1/connection-games/timezone & PATCH /api/v1/users/me timezone
    const badTzRes = await api(
      '/api/v1/connection-games/timezone',
      { method: 'PUT', body: JSON.stringify({ timezone: 'Mars/Olympus_Mons' }) },
      tokyoAlice.token
    );
    assert.equal(badTzRes.status, 400);

    const setTokyoAlice = await api(
      '/api/v1/connection-games/timezone',
      { method: 'PUT', body: JSON.stringify({ timezone: 'Asia/Tokyo' }) },
      tokyoAlice.token
    );
    assert.equal(setTokyoAlice.status, 200);
    assert.equal(setTokyoAlice.data.timezone, 'Asia/Tokyo');

    const setTokyoBob = await api(
      '/api/v1/users/me',
      { method: 'PATCH', body: JSON.stringify({ timezone: 'Asia/Tokyo' }) },
      tokyoBob.token
    );
    assert.equal(setTokyoBob.status, 200);

    const badUserTz = await api(
      '/api/v1/users/me',
      { method: 'PATCH', body: JSON.stringify({ timezone: 'Not/A_Zone' }) },
      nyCarol.token
    );
    assert.equal(badUserTz.status, 400);

    await api(
      '/api/v1/connection-games/timezone',
      { method: 'PUT', body: JSON.stringify({ timezone: 'America/New_York' }) },
      nyCarol.token
    );
    await api(
      '/api/v1/connection-games/timezone',
      { method: 'PUT', body: JSON.stringify({ timezone: 'America/New_York' }) },
      nyDave.token
    );

    // Alice opts out of connection game notifications; Bob leaves them enabled
    await api(
      '/api/v1/users/me/privacy',
      { method: 'PATCH', body: JSON.stringify({ allowConnectionGameNotifications: false }) },
      tokyoAlice.token
    );

    // 2. Establish friendships & private conversations for Tokyo pair and NY pair
    const makeFriends = async (u1: string, u2: string) => {
      const [a, b] = [u1, u2].sort();
      await db.insert(friendships).values({
        id: crypto.randomUUID(),
        userAId: a,
        userBId: b,
        createdAt: '2026-06-01T00:00:00.000Z',
      });
    };
    await makeFriends(tokyoAlice.user.id, tokyoBob.user.id);
    await makeFriends(nyCarol.user.id, nyDave.user.id);
    await makeFriends(tokyoAlice.user.id, blockedEve.user.id);

    const tokyoConvRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: tokyoBob.user.id }) },
      tokyoAlice.token
    );
    const nyConvRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: nyDave.user.id }) },
      nyCarol.token
    );
    const blockedConvRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: blockedEve.user.id }) },
      tokyoAlice.token
    );
    // Non-friend with zero messages / game history
    const strangerConvRes = await api(
      '/api/v1/conversations/private',
      { method: 'POST', body: JSON.stringify({ userId: strangerFrank.user.id }) },
      tokyoAlice.token
    );

    // Block Eve after creating the private conversation
    const blkRes = await api(
      `/api/v1/users/${blockedEve.user.id}/block`,
      { method: 'POST' },
      tokyoAlice.token
    );
    assert.equal(blkRes.status, 200);

    const tokyoConvId = tokyoConvRes.data.conversationId as string;
    const nyConvId = nyConvRes.data.conversationId as string;
    const blockedConvId = blockedConvRes.data.conversationId as string;
    const strangerConvId = strangerConvRes.data.conversationId as string;
    const scopedConvIds = [tokyoConvId, nyConvId, blockedConvId, strangerConvId];

    // 3. Run scheduler at 2026-06-01T16:00:00Z:
    //    - Asia/Tokyo (UTC+9) = 2026-06-02 01:00 -> assigns '2026-06-02'
    //    - America/New_York (EDT UTC-4) = 2026-06-01 12:00 -> assigns '2026-06-01'
    //    - Blocked & stranger pairs are skipped
    const sweep1 = await runDailyChallengeScheduler(db, {
      now: new Date('2026-06-01T16:00:00.000Z'),
      conversationIds: scopedConvIds,
    });
    assert.equal(sweep1.processedPairs, 2);
    assert.equal(sweep1.assignedCount, 2);
    assert.equal(sweep1.skippedAlreadyAssigned, 0);
    assert.equal(sweep1.errors, 0);

    const tokyoAssignments1 = await db
      .select()
      .from(dailyChallengeAssignments)
      .where(eq(dailyChallengeAssignments.conversationId, tokyoConvId));
    assert.equal(tokyoAssignments1.length, 1);
    assert.equal(tokyoAssignments1[0].challengeDate, '2026-06-02');
    assert.equal(tokyoAssignments1[0].timezone, 'Asia/Tokyo');

    const nyAssignments1 = await db
      .select()
      .from(dailyChallengeAssignments)
      .where(eq(dailyChallengeAssignments.conversationId, nyConvId));
    assert.equal(nyAssignments1.length, 1);
    assert.equal(nyAssignments1[0].challengeDate, '2026-06-01');
    assert.equal(nyAssignments1[0].timezone, 'America/New_York');

    const blockedAssignments = await db
      .select()
      .from(dailyChallengeAssignments)
      .where(eq(dailyChallengeAssignments.conversationId, blockedConvId));
    assert.equal(blockedAssignments.length, 0);

    const strangerAssignments = await db
      .select()
      .from(dailyChallengeAssignments)
      .where(eq(dailyChallengeAssignments.conversationId, strangerConvId));
    assert.equal(strangerAssignments.length, 0);

    // Notification preferences honored
    const bobNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, tokyoBob.user.id), eq(notifications.type, 'daily_challenge_assigned'))
      );
    assert.equal(bobNotifs.length, 1);

    const aliceNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, tokyoAlice.user.id), eq(notifications.type, 'daily_challenge_assigned'))
      );
    assert.equal(aliceNotifs.length, 0);

    // 4. Re-run 6 hours later (2026-06-01T22:00:00Z): same local calendar day in both Tokyo & NY -> idempotent
    const sweep2 = await runDailyChallengeScheduler(db, {
      now: new Date('2026-06-01T22:00:00.000Z'),
      conversationIds: scopedConvIds,
    });
    assert.equal(sweep2.processedPairs, 2);
    assert.equal(sweep2.assignedCount, 0);
    assert.equal(sweep2.skippedAlreadyAssigned, 2);

    // 5. Re-run 24 hours later (2026-06-02T16:00:00Z): new local day in both timezones -> expires Day 1 & assigns Day 2
    const sweep3 = await runDailyChallengeScheduler(db, {
      now: new Date('2026-06-02T16:00:00.000Z'),
      conversationIds: scopedConvIds,
    });
    assert.equal(sweep3.processedPairs, 2);
    assert.equal(sweep3.assignedCount, 2);
    assert.equal(sweep3.expiredCount, 2);

    const tokyoAssignments2 = await db
      .select()
      .from(dailyChallengeAssignments)
      .where(eq(dailyChallengeAssignments.conversationId, tokyoConvId));
    assert.equal(tokyoAssignments2.length, 2);
    const tokyoDay1 = tokyoAssignments2.find((a) => a.challengeDate === '2026-06-02');
    const tokyoDay2 = tokyoAssignments2.find((a) => a.challengeDate === '2026-06-03');
    assert.ok(tokyoDay1 && tokyoDay2);
    assert.equal(tokyoDay1.lifecycleStatus, 'expired');
    assert.equal(tokyoDay2.lifecycleStatus, 'pending');
    assert.notEqual(tokyoDay1.challengeId, tokyoDay2.challengeId);

    const nyAssignments2 = await db
      .select()
      .from(dailyChallengeAssignments)
      .where(eq(dailyChallengeAssignments.conversationId, nyConvId));
    assert.equal(nyAssignments2.length, 2);
    const nyDay1 = nyAssignments2.find((a) => a.challengeDate === '2026-06-01');
    const nyDay2 = nyAssignments2.find((a) => a.challengeDate === '2026-06-02');
    assert.ok(nyDay1 && nyDay2);
    assert.equal(nyDay1.lifecycleStatus, 'expired');
    assert.equal(nyDay2.lifecycleStatus, 'pending');

    // 6. Verify startDailyChallengeScheduler lifecycle handle (runNow + stop)
    const handle = startDailyChallengeScheduler(db, {
      intervalMs: 60_000,
      initialDelayMs: 60_000,
      notify: false,
    });
    const manualRun = await handle.runNow(new Date('2026-06-02T17:00:00.000Z'));
    assert.ok(manualRun.processedPairs >= 2);
    assert.equal(manualRun.errors, 0);
    handle.stop();
    assert.equal(handle.isRunning(), false);
  });
});
