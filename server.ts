import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { db } from './server/db.ts';
import { createApiApp, runRetentionCleanup } from './server/app.ts';
import { setupSocketServer } from './server/socket.ts';

async function startServer() {
  const app = createApiApp(db);
  const httpServer = http.createServer(app);
  setupSocketServer(httpServer, db);

  // Periodic background cleanup for disappearing messages and expired 24h stories
  const cleanupTimer = setInterval(() => {
    try {
      runRetentionCleanup(db);
    } catch (err) {
      console.error('Retention cleanup error:', err);
    }
  }, 5_000);
  cleanupTimer.unref();

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`NEXORA server running on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
