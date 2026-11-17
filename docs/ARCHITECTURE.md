# NEXORA System Architecture

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Framer Motion (`motion/react`) + Web Crypto API + IndexedDB keystore + Web Audio `MediaRecorder`/`AnalyserNode`.
- **Backend**: Node.js 22 + Express + Socket.IO real-time WebSocket gateway + Nodemailer SMTP OTP delivery + background retention cleanup worker.
- **Database**: Relational normalized SQLite (`node:sqlite`, WAL mode, foreign keys enforced) for zero-config execution, alongside `database/schema.prisma` and `docker-compose.yml` for PostgreSQL 16 + Redis 7 production deployments.
- **API Modules**: `/api/v1/auth`, `/api/v1/users`, `/api/v1/friends`, `/api/v1/conversations`, `/api/v1/groups`, `/api/v1/media`, `/api/v1/stories`, `/api/v1/notifications`.
