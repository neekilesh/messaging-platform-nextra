import type {
  DecryptedMessagePayload,
  EncryptedKeyBackup,
  EncryptedMessageReaction,
  GroupEpochEnvelope,
  RecipientEnvelope,
  SignedEncryptedReadReceipt,
} from '../types/nexora';

const DB_NAME = 'nexora_e2ee_keystore';
const STORE_NAME = 'identity_keys';
const DB_VERSION = 1;

export interface StoredLocalKeyBundle {
  userId: string;
  ecdhPrivateJwk: JsonWebKey;
  ecdhPublicJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
  ecdsaPublicJwk: JsonWebKey;
  fingerprint: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function b64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalKeyBundle(bundle: StoredLocalKeyBundle): Promise<void> {
  const db = await openKeyDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(bundle);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadLocalKeyBundle(userId: string): Promise<StoredLocalKeyBundle | null> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(userId);
    req.onsuccess = () => resolve((req.result as StoredLocalKeyBundle) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function computePublicFingerprint(ecdhPublicJwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({
    crv: ecdhPublicJwk.crv,
    kty: ecdhPublicJwk.kty,
    x: ecdhPublicJwk.x,
    y: ecdhPublicJwk.y,
  });
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(canonical));
  const bytes = new Uint8Array(digest);
  const groups: string[] = [];
  for (let i = 0; i < 20; i += 4) {
    const val = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    groups.push(String(val % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}

export async function computeSafetyNumber(myPublicJwkStr: string, peerPublicJwkStr: string): Promise<string> {
  const myJwk = JSON.parse(myPublicJwkStr) as JsonWebKey;
  const peerJwk = JSON.parse(peerPublicJwkStr) as JsonWebKey;
  const a = `${myJwk.x}:${myJwk.y}`;
  const b = `${peerJwk.x}:${peerJwk.y}`;
  const sorted = a < b ? `${a}|${b}` : `${b}|${a}`;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(sorted));
  const bytes = new Uint8Array(digest);
  const blocks: string[] = [];
  for (let i = 0; i < 24; i += 4) {
    const val = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    blocks.push(String(val % 100000).padStart(5, '0'));
  }
  return blocks.join(' ');
}

export async function generateIdentityKeyPair(): Promise<Omit<StoredLocalKeyBundle, 'userId'>> {
  const ecdhPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const ecdsaPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const ecdhPrivateJwk = await crypto.subtle.exportKey('jwk', ecdhPair.privateKey);
  const ecdhPublicJwk = await crypto.subtle.exportKey('jwk', ecdhPair.publicKey);
  const ecdsaPrivateJwk = await crypto.subtle.exportKey('jwk', ecdsaPair.privateKey);
  const ecdsaPublicJwk = await crypto.subtle.exportKey('jwk', ecdsaPair.publicKey);
  const fingerprint = await computePublicFingerprint(ecdhPublicJwk);

  return {
    ecdhPrivateJwk,
    ecdhPublicJwk,
    ecdsaPrivateJwk,
    ecdsaPublicJwk,
    fingerprint,
  };
}

export async function createEncryptedKeyBackup(
  bundle: Omit<StoredLocalKeyBundle, 'userId'>,
  password: string
): Promise<EncryptedKeyBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const secretPayload = JSON.stringify({
    ecdhPrivateJwk: bundle.ecdhPrivateJwk,
    ecdsaPrivateJwk: bundle.ecdsaPrivateJwk,
  });

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, enc.encode(secretPayload));

  return {
    encryptedPrivateKey: bufToB64(ciphertext),
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    ecdhPublicJwk: JSON.stringify(bundle.ecdhPublicJwk),
    ecdsaPublicJwk: JSON.stringify(bundle.ecdsaPublicJwk),
    fingerprint: bundle.fingerprint,
  };
}

export async function restoreEncryptedKeyBackup(
  userId: string,
  password: string,
  backup: EncryptedKeyBackup
): Promise<StoredLocalKeyBundle> {
  const salt = b64ToBuf(backup.salt);
  const iv = b64ToBuf(backup.iv);
  const ciphertext = b64ToBuf(backup.encryptedPrivateKey);

  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: 310_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    wrappingKey,
    toArrayBuffer(ciphertext)
  );
  const parsed = JSON.parse(dec.decode(plaintextBuf)) as {
    ecdhPrivateJwk: JsonWebKey;
    ecdsaPrivateJwk: JsonWebKey;
  };

  const bundle: StoredLocalKeyBundle = {
    userId,
    ecdhPrivateJwk: parsed.ecdhPrivateJwk,
    ecdhPublicJwk: JSON.parse(backup.ecdhPublicJwk),
    ecdsaPrivateJwk: parsed.ecdsaPrivateJwk,
    ecdsaPublicJwk: JSON.parse(backup.ecdsaPublicJwk),
    fingerprint: backup.fingerprint,
  };
  await saveLocalKeyBundle(bundle);
  return bundle;
}

async function importEcdhPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']);
}

async function importEcdhPublicKey(jwkStrOrObj: string | JsonWebKey): Promise<CryptoKey> {
  const jwk = typeof jwkStrOrObj === 'string' ? (JSON.parse(jwkStrOrObj) as JsonWebKey) : jwkStrOrObj;
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function deriveSharedAesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  infoText: string
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: enc.encode(infoText),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function wrapSymmetricKeyForRecipients(
  rawKeyBytes: Uint8Array,
  recipients: Array<{ userId: string; ecdhPublicJwk: string }>,
  infoText = 'nexora-e2ee-key-wrap-v1'
): Promise<Record<string, RecipientEnvelope>> {
  const envelopes: Record<string, RecipientEnvelope> = {};

  for (const r of recipients) {
    const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveKey',
      'deriveBits',
    ]);
    const epkJwk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);
    const peerPub = await importEcdhPublicKey(r.ecdhPublicJwk);
    const wrapAesKey = await deriveSharedAesKey(ephemeral.privateKey, peerPub, infoText);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      wrapAesKey,
      toArrayBuffer(rawKeyBytes)
    );

    envelopes[r.userId] = {
      ephemeralPublicJwk: JSON.stringify(epkJwk),
      wrappedKey: bufToB64(wrapped),
      iv: bufToB64(iv),
    };
  }

  return envelopes;
}

export async function unwrapSymmetricKey(
  envelope: RecipientEnvelope,
  myPrivateJwk: JsonWebKey,
  infoText = 'nexora-e2ee-key-wrap-v1'
): Promise<Uint8Array> {
  const myPriv = await importEcdhPrivateKey(myPrivateJwk);
  const epkPub = await importEcdhPublicKey(envelope.ephemeralPublicJwk);
  const wrapAesKey = await deriveSharedAesKey(myPriv, epkPub, infoText);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(b64ToBuf(envelope.iv)) },
    wrapAesKey,
    toArrayBuffer(b64ToBuf(envelope.wrappedKey))
  );
  return new Uint8Array(decrypted);
}

export async function encryptPrivateMessage(
  payload: DecryptedMessagePayload,
  aadString: string,
  recipients: Array<{ userId: string; ecdhPublicJwk: string }>
): Promise<{
  ciphertext: string;
  iv: string;
  aad: string;
  recipientEnvelopes: Record<string, RecipientEnvelope>;
}> {
  const rawMsgKey = crypto.getRandomValues(new Uint8Array(32));
  const aesKey = await crypto.subtle.importKey('raw', rawMsgKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aadBytes = enc.encode(aadString);
  const plaintextBytes = enc.encode(JSON.stringify(payload));

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes },
    aesKey,
    plaintextBytes
  );

  const recipientEnvelopes = await wrapSymmetricKeyForRecipients(rawMsgKey, recipients);

  return {
    ciphertext: bufToB64(ciphertextBuf),
    iv: bufToB64(iv),
    aad: aadString,
    recipientEnvelopes,
  };
}

export async function decryptPrivateMessage(
  ciphertextB64: string,
  ivB64: string,
  aadString: string,
  myEnvelope: RecipientEnvelope,
  myPrivateJwk: JsonWebKey
): Promise<DecryptedMessagePayload> {
  const rawMsgKey = await unwrapSymmetricKey(myEnvelope, myPrivateJwk);
  const aesKey = await crypto.subtle.importKey('raw', toArrayBuffer(rawMsgKey), { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintextBuf = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(b64ToBuf(ivB64)),
      additionalData: enc.encode(aadString),
    },
    aesKey,
    toArrayBuffer(b64ToBuf(ciphertextB64))
  );
  return JSON.parse(dec.decode(plaintextBuf)) as DecryptedMessagePayload;
}

export async function createGroupEpochEnvelopes(
  members: Array<{ userId: string; ecdhPublicJwk: string }>
): Promise<{
  epochKeyRaw: Uint8Array;
  envelopes: Array<{ userId: string; ephemeralPublicJwk: string; wrappedEpochKey: string; iv: string }>;
}> {
  const epochKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const map = await wrapSymmetricKeyForRecipients(epochKeyRaw, members, 'nexora-group-epoch-v1');
  const envelopes = Object.entries(map).map(([userId, env]) => ({
    userId,
    ephemeralPublicJwk: env.ephemeralPublicJwk,
    wrappedEpochKey: env.wrappedKey,
    iv: env.iv,
  }));
  return { epochKeyRaw, envelopes };
}

export async function unwrapGroupEpochKey(
  envelope: GroupEpochEnvelope,
  myPrivateJwk: JsonWebKey
): Promise<Uint8Array> {
  return unwrapSymmetricKey(
    {
      ephemeralPublicJwk: envelope.ephemeralPublicJwk,
      wrappedKey: envelope.wrappedEpochKey,
      iv: envelope.iv,
    },
    myPrivateJwk,
    'nexora-group-epoch-v1'
  );
}

export async function encryptGroupMessage(
  payload: DecryptedMessagePayload,
  aadString: string,
  epochKeyRaw: Uint8Array
): Promise<{ ciphertext: string; iv: string; aad: string }> {
  const aesKey = await crypto.subtle.importKey('raw', toArrayBuffer(epochKeyRaw), { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aadString) },
    aesKey,
    enc.encode(JSON.stringify(payload))
  );
  return {
    ciphertext: bufToB64(ciphertextBuf),
    iv: bufToB64(iv),
    aad: aadString,
  };
}

export async function decryptGroupMessage(
  ciphertextB64: string,
  ivB64: string,
  aadString: string,
  epochKeyRaw: Uint8Array
): Promise<DecryptedMessagePayload> {
  const aesKey = await crypto.subtle.importKey('raw', toArrayBuffer(epochKeyRaw), { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(b64ToBuf(ivB64)), additionalData: enc.encode(aadString) },
    aesKey,
    toArrayBuffer(b64ToBuf(ciphertextB64))
  );
  return JSON.parse(dec.decode(plaintextBuf)) as DecryptedMessagePayload;
}

export async function compressImageIfNeeded(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }
  try {
    const imgUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = imgUrl;
    });
    URL.revokeObjectURL(imgUrl);

    const maxDim = 1600;
    let { width, height } = img;
    if (width <= maxDim && height <= maxDim && file.size < 1.2 * 1024 * 1024) {
      return file;
    }

    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.84)
    );
    return compressed && compressed.size < file.size ? compressed : file;
  } catch {
    return file;
  }
}

export async function encryptMediaBlob(blob: Blob): Promise<{
  encryptedBytes: Uint8Array;
  keyB64: string;
  ivB64: string;
  sha256CiphertextB64: string;
  originalSize: number;
  mimeType: string;
}> {
  const prepared = await compressImageIfNeeded(blob);
  const plainBuf = await prepared.arrayBuffer();
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const encryptedBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plainBuf);
  const sha256Buf = await crypto.subtle.digest('SHA-256', encryptedBuf);

  return {
    encryptedBytes: new Uint8Array(encryptedBuf),
    keyB64: bufToB64(rawKey),
    ivB64: bufToB64(iv),
    sha256CiphertextB64: bufToB64(sha256Buf),
    originalSize: prepared.size,
    mimeType: prepared.type || blob.type || 'application/octet-stream',
  };
}

export async function decryptMediaBlob(
  encryptedBuf: ArrayBuffer,
  keyB64: string,
  ivB64: string,
  mimeType: string,
  expectedSha256B64?: string | null
): Promise<Blob> {
  if (expectedSha256B64) {
    const hashBuf = await crypto.subtle.digest('SHA-256', encryptedBuf);
    const actual = bufToB64(hashBuf);
    if (actual !== expectedSha256B64) {
      throw new Error('Encrypted media integrity check failed.');
    }
  }
  const rawKey = b64ToBuf(keyB64);
  const iv = b64ToBuf(ivB64);
  const aesKey = await crypto.subtle.importKey('raw', toArrayBuffer(rawKey), { name: 'AES-GCM' }, false, ['decrypt']);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, aesKey, encryptedBuf);
  return new Blob([plainBuf], { type: mimeType || 'application/octet-stream' });
}

export function canonicalReadReceiptString(
  conversationId: string,
  messageId: string,
  readerId: string,
  viewedAt: string
): string {
  return `nexora:read-receipt:v1:${conversationId}:${messageId}:${readerId}:${viewedAt}`;
}

async function importEcdsaPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function importEcdsaPublicKey(jwkStrOrObj: string | JsonWebKey): Promise<CryptoKey> {
  const jwk = typeof jwkStrOrObj === 'string' ? (JSON.parse(jwkStrOrObj) as JsonWebKey) : jwkStrOrObj;
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

export async function signReadReceiptPayload(
  conversationId: string,
  messageId: string,
  readerId: string,
  viewedAt: string,
  ecdsaPrivateJwk: JsonWebKey
): Promise<string> {
  const signingKey = await importEcdsaPrivateKey(ecdsaPrivateJwk);
  const canonical = canonicalReadReceiptString(conversationId, messageId, readerId, viewedAt);
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    enc.encode(canonical)
  );
  return bufToB64(sigBuf);
}

export async function verifyReadReceiptSignature(
  conversationId: string,
  messageId: string,
  readerId: string,
  viewedAt: string,
  signatureB64: string,
  ecdsaPublicJwk: string | JsonWebKey
): Promise<boolean> {
  try {
    const verifyKey = await importEcdsaPublicKey(ecdsaPublicJwk);
    const canonical = canonicalReadReceiptString(conversationId, messageId, readerId, viewedAt);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      toArrayBuffer(b64ToBuf(signatureB64)),
      enc.encode(canonical)
    );
  } catch {
    return false;
  }
}

export async function signAndEncryptReadReceipt(params: {
  conversationId: string;
  messageId: string;
  readerId: string;
  viewedAt?: string;
  ecdsaPrivateJwk: JsonWebKey;
  recipients?: Array<{ userId: string; ecdhPublicJwk: string }>;
  groupEpochKeyRaw?: Uint8Array | null;
  groupEpoch?: number | null;
}): Promise<SignedEncryptedReadReceipt> {
  const viewedAt = params.viewedAt || new Date().toISOString();
  const signature = await signReadReceiptPayload(
    params.conversationId,
    params.messageId,
    params.readerId,
    viewedAt,
    params.ecdsaPrivateJwk
  );

  const innerPayload = JSON.stringify({
    type: 'read_receipt',
    conversationId: params.conversationId,
    messageId: params.messageId,
    readerId: params.readerId,
    viewedAt,
    signature,
  });
  const aad = `nexora-receipt:${params.conversationId}:${params.messageId}:${params.readerId}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));

  if (params.groupEpochKeyRaw && typeof params.groupEpoch === 'number') {
    const aesKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(params.groupEpochKeyRaw),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      aesKey,
      enc.encode(innerPayload)
    );
    return {
      messageId: params.messageId,
      readerId: params.readerId,
      viewedAt,
      signature,
      ciphertext: bufToB64(cipherBuf),
      iv: bufToB64(iv),
      aad,
      epoch: params.groupEpoch,
    };
  }

  if (params.recipients && params.recipients.length > 0) {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      aesKey,
      enc.encode(innerPayload)
    );
    const recipientEnvelopes = await wrapSymmetricKeyForRecipients(
      rawKey,
      params.recipients,
      'nexora-e2ee-read-receipt-v1'
    );
    return {
      messageId: params.messageId,
      readerId: params.readerId,
      viewedAt,
      signature,
      ciphertext: bufToB64(cipherBuf),
      iv: bufToB64(iv),
      aad,
      recipientEnvelopes,
    };
  }

  return {
    messageId: params.messageId,
    readerId: params.readerId,
    viewedAt,
    signature,
  };
}

export async function decryptAndVerifyReadReceipt(params: {
  conversationId: string;
  receipt: SignedEncryptedReadReceipt;
  myUserId: string;
  myEcdhPrivateJwk: JsonWebKey;
  signerEcdsaPublicJwk: string | null | undefined;
  groupEpochKeyRaw?: Uint8Array | null;
}): Promise<{ verified: boolean; viewedAt: string; readerId: string }> {
  const { conversationId, receipt, myUserId, myEcdhPrivateJwk, signerEcdsaPublicJwk, groupEpochKeyRaw } = params;

  if (!signerEcdsaPublicJwk || !receipt.signature) {
    return { verified: false, viewedAt: receipt.viewedAt, readerId: receipt.readerId };
  }

  let effectiveMessageId = receipt.messageId;
  let effectiveReaderId = receipt.readerId;
  let effectiveViewedAt = receipt.viewedAt;
  let effectiveSignature = receipt.signature;

  if (receipt.ciphertext && receipt.iv && receipt.aad) {
    try {
      let rawAesBytes: Uint8Array | null = null;
      if (groupEpochKeyRaw) {
        rawAesBytes = groupEpochKeyRaw;
      } else if (receipt.recipientEnvelopes?.[myUserId]) {
        rawAesBytes = await unwrapSymmetricKey(
          receipt.recipientEnvelopes[myUserId],
          myEcdhPrivateJwk,
          'nexora-e2ee-read-receipt-v1'
        );
      }

      if (rawAesBytes) {
        const aesKey = await crypto.subtle.importKey(
          'raw',
          toArrayBuffer(rawAesBytes),
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        );
        const plainBuf = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: toArrayBuffer(b64ToBuf(receipt.iv)),
            additionalData: enc.encode(receipt.aad),
          },
          aesKey,
          toArrayBuffer(b64ToBuf(receipt.ciphertext))
        );
        const parsed = JSON.parse(dec.decode(plainBuf)) as {
          type?: string;
          conversationId?: string;
          messageId?: string;
          readerId?: string;
          viewedAt?: string;
          signature?: string;
        };
        if (
          parsed.type !== 'read_receipt' ||
          parsed.conversationId !== conversationId ||
          parsed.messageId !== receipt.messageId ||
          parsed.readerId !== receipt.readerId
        ) {
          return { verified: false, viewedAt: receipt.viewedAt, readerId: receipt.readerId };
        }
        effectiveMessageId = parsed.messageId;
        effectiveReaderId = parsed.readerId;
        effectiveViewedAt = parsed.viewedAt || receipt.viewedAt;
        effectiveSignature = parsed.signature || receipt.signature;
      }
    } catch {
      return { verified: false, viewedAt: receipt.viewedAt, readerId: receipt.readerId };
    }
  }

  const verified = await verifyReadReceiptSignature(
    conversationId,
    effectiveMessageId,
    effectiveReaderId,
    effectiveViewedAt,
    effectiveSignature,
    signerEcdsaPublicJwk
  );

  return {
    verified,
    viewedAt: effectiveViewedAt,
    readerId: effectiveReaderId,
  };
}

export async function encryptMessageReaction(params: {
  conversationId: string;
  messageId: string;
  userId: string;
  emojis: string[];
  recipients?: Array<{ userId: string; ecdhPublicJwk: string }>;
  groupEpochKeyRaw?: Uint8Array | null;
  groupEpoch?: number | null;
}): Promise<{
  ciphertext: string;
  iv: string;
  aad: string;
  recipientEnvelopes: Record<string, RecipientEnvelope> | null;
  epoch: number | null;
}> {
  const normalizedEmojis = Array.from(
    new Set(params.emojis.map((e) => e.trim()).filter((e) => e.length > 0 && e.length <= 16))
  );
  const aad = `nexora-reaction:${params.conversationId}:${params.messageId}:${params.userId}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const innerPayload = JSON.stringify({
    type: 'reaction',
    conversationId: params.conversationId,
    messageId: params.messageId,
    userId: params.userId,
    emojis: normalizedEmojis,
    updatedAt: new Date().toISOString(),
  });

  if (params.groupEpochKeyRaw && typeof params.groupEpoch === 'number') {
    const aesKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(params.groupEpochKeyRaw),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      aesKey,
      enc.encode(innerPayload)
    );
    return {
      ciphertext: bufToB64(cipherBuf),
      iv: bufToB64(iv),
      aad,
      recipientEnvelopes: null,
      epoch: params.groupEpoch,
    };
  }

  if (params.recipients && params.recipients.length > 0) {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      aesKey,
      enc.encode(innerPayload)
    );
    const recipientEnvelopes = await wrapSymmetricKeyForRecipients(
      rawKey,
      params.recipients,
      'nexora-e2ee-reaction-v1'
    );
    return {
      ciphertext: bufToB64(cipherBuf),
      iv: bufToB64(iv),
      aad,
      recipientEnvelopes,
      epoch: null,
    };
  }

  throw new Error('Missing encryption key material for E2EE reaction.');
}

export async function decryptMessageReaction(params: {
  conversationId: string;
  messageId: string;
  reaction: EncryptedMessageReaction;
  myUserId: string;
  myEcdhPrivateJwk: JsonWebKey;
  groupEpochKeyRaw?: Uint8Array | null;
}): Promise<string[]> {
  const { conversationId, messageId, reaction, myUserId, myEcdhPrivateJwk, groupEpochKeyRaw } = params;
  const expectedAad = `nexora-reaction:${conversationId}:${messageId}:${reaction.userId}`;
  if (reaction.aad !== expectedAad || !reaction.ciphertext || !reaction.iv) {
    return [];
  }

  try {
    let rawAesBytes: Uint8Array | null = null;
    if (typeof reaction.epoch === 'number') {
      if (!groupEpochKeyRaw) return [];
      rawAesBytes = groupEpochKeyRaw;
    } else if (reaction.recipientEnvelopes?.[myUserId]) {
      rawAesBytes = await unwrapSymmetricKey(
        reaction.recipientEnvelopes[myUserId],
        myEcdhPrivateJwk,
        'nexora-e2ee-reaction-v1'
      );
    }

    if (!rawAesBytes) return [];

    const aesKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(rawAesBytes),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const plainBuf = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(b64ToBuf(reaction.iv)),
        additionalData: enc.encode(reaction.aad),
      },
      aesKey,
      toArrayBuffer(b64ToBuf(reaction.ciphertext))
    );
    const parsed = JSON.parse(dec.decode(plainBuf)) as {
      type?: string;
      conversationId?: string;
      messageId?: string;
      userId?: string;
      emojis?: unknown;
    };

    if (
      parsed.type !== 'reaction' ||
      parsed.conversationId !== conversationId ||
      parsed.messageId !== messageId ||
      parsed.userId !== reaction.userId ||
      !Array.isArray(parsed.emojis)
    ) {
      return [];
    }

    return Array.from(
      new Set(
        parsed.emojis
          .filter((e): e is string => typeof e === 'string')
          .map((e) => e.trim())
          .filter((e) => e.length > 0 && e.length <= 16)
      )
    );
  } catch {
    return [];
  }
}
