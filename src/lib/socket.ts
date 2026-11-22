import { io, type Socket } from 'socket.io-client';
import { getStoredToken } from './api';

const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '') || '/';

let socket: Socket | null = null;

function resolveClientTimezone(): string {
  try {
    if (typeof Intl !== 'undefined') {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
  } catch {
    // ignore Intl fallback error
  }
  return 'UTC';
}

export function connectSocket(): Socket | null {
  const token = getStoredToken();
  if (!token) return null;

  const timezone = resolveClientTimezone();

  if (socket) {
    if (socket.connected) return socket;
    socket.auth = { token, timezone };
    socket.connect();
    return socket;
  }

  socket = io(SOCKET_URL, {
    auth: { token, timezone },
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
