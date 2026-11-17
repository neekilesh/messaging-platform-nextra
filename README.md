# NEXORA — Private End-to-End Encrypted Messaging

**Your Identity. Your World. Your Connections.**

NEXORA is a username-based, end-to-end encrypted messaging platform featuring 1-to-1 private conversations, 25-member encrypted groups with epoch key rotation, reactive-waveform voice messages, encrypted photo/video/document sharing, 24-hour stories, disappearing messages, and server-authoritative friend streaks.

## Features Implemented
- **Username & Email OTP Authentication**: 6-digit email OTP verification, `@username` availability checks, scrypt password hashing, password reset, and active device/session management.
- **End-to-End Encryption**: Client-side Web Crypto ECDH P-256 + HKDF-SHA256 + AES-256-GCM for messages, groups, stories, and media blobs, plus SHA-256 safety number verification.
- **Real-Time Private & Group Messaging**: Socket.IO instant delivery, read/delivery receipts, typing indicators, replies, reactions, editing, pinning, forwarding, search, mute/archive, block/report.
- **25-Member Group Cap**: Enforced transactionally on the backend with epoch key rotation when adding or removing members.
- **Voice, Media, Stories & Streaks**: Live Web Audio waveform recording, encrypted image/video/document uploads, 24-hour expiring stories with viewer tracking, disappearing message timers, and server-calculated 24h reciprocal streaks.

## Setup & Running Locally
```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`. Configure `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` in `.env` for live SMTP email OTP delivery; when omitted in development mode, the OTP code is logged to the server console and shown in the registration preview banner.

## Testing & Production Build
```bash
npm run lint
npm test
npm run build
npm start
```

## Docker / PostgreSQL Production Deployment
```bash
docker compose up --build -d
```
See `docs/SECURITY.md` and `docs/ARCHITECTURE.md` for full cryptographic and system details.
