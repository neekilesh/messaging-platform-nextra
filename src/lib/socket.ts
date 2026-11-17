import { io, type Socket } from 'socket.io-client';
import { getStoredToken } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket | null {
  const token = getStoredToken();
  if (!token) return null;

  if (socket) {
    if (socket.connected) return socket;
    socket.auth = { token };
    socket.connect();
    return socket;
  }

  socket = io('/', {
    auth: { token },
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
