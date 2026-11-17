const TOKEN_KEY = 'nexora_token';

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore non-json error body
    }
    throw new Error(errMsg);
  }

  return (await res.json()) as T;
}

export async function uploadEncryptedMedia(
  encryptedBytes: Uint8Array,
  meta: {
    conversationId?: string;
    isStory?: boolean;
    mimeType: string;
    originalSize: number;
    durationMs?: number;
  }
): Promise<{ attachmentId: string; encryptedSize: number; sha256Ciphertext: string }> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'x-nexora-mime-type': meta.mimeType,
    'x-nexora-original-size': String(meta.originalSize),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (meta.conversationId) headers['x-nexora-conversation-id'] = meta.conversationId;
  if (meta.isStory) headers['x-nexora-story'] = '1';
  if (typeof meta.durationMs === 'number') headers['x-nexora-duration-ms'] = String(Math.round(meta.durationMs));

  const bodyBytes = encryptedBytes.buffer.slice(
    encryptedBytes.byteOffset,
    encryptedBytes.byteOffset + encryptedBytes.byteLength
  ) as ArrayBuffer;

  const res = await fetch('/api/v1/media/upload', {
    method: 'POST',
    headers,
    body: bodyBytes,
    credentials: 'include',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Encrypted media upload failed.');
  }

  return res.json();
}

export async function fetchEncryptedMediaBytes(attachmentId: string): Promise<ArrayBuffer> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api/v1/media/${attachmentId}`, {
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Unable to fetch encrypted media.');
  }
  return res.arrayBuffer();
}
