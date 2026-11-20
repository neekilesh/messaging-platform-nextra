import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { db, isTransientSqlDisconnect } from './src/db/index.ts';
import { createApiApp, runRetentionCleanup } from './server/app.ts';
import { setupSocketServer } from './server/socket.ts';
import { setupLiveVoiceWebSocket } from './server/live-ws.ts';

function resolvePort(): number {
  const argIdx = process.argv.indexOf('--port');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    const cliPort = Number(process.argv[argIdx + 1]);
    if (Number.isFinite(cliPort) && cliPort > 0) {
      return cliPort;
    }
  }
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  if (Number.isFinite(envPort) && envPort > 0 && envPort !== nginxPort) {
    return envPort;
  }
  return Number(process.env.DEFAULT_APP_PORT || 3000);
}

async function startServer() {
  const app = createApiApp(db);
  const httpServer = http.createServer(app);
  setupSocketServer(httpServer, db);
  setupLiveVoiceWebSocket(httpServer, db);

  let cleanupInFlight = false;
  const cleanupTimer = setInterval(() => {
    if (cleanupInFlight) return;
    cleanupInFlight = true;
    runRetentionCleanup(db)
      .catch((err) => {
        if (!isTransientSqlDisconnect(err)) {
          console.error('Retention cleanup error:', err);
        }
      })
      .finally(() => {
        cleanupInFlight = false;
      });
  }, 10_000);
  cleanupTimer.unref();

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');

  if (!isProd || !fs.existsSync(distIndex)) {
    const viteReady = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          ws: false,
          allowedHosts: true,
        },
        appType: 'spa',
      })
    );

    app.use(async (req, res, next) => {
      try {
        const vite = await viteReady;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    app.use(express.static(distDir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(distIndex);
    });
  }

  const port = resolvePort();
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`NEXORA server running on http://localhost:${port}`);
      resolve();
    });
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
