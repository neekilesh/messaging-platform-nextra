import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { db } from './src/db/index.ts';
import { createApiApp, runRetentionCleanup } from './server/app.ts';
import { setupSocketServer } from './server/socket.ts';

async function startServer() {
  const app = createApiApp(db);
  const httpServer = http.createServer(app);
  setupSocketServer(httpServer, db);

  const cleanupTimer = setInterval(() => {
    runRetentionCleanup(db).catch((err) => {
      console.error('Retention cleanup error:', err);
    });
  }, 5_000);
  cleanupTimer.unref();

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');

  if (!isProd || !fs.existsSync(distIndex)) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(distIndex);
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
