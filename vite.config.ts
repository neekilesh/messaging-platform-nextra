import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(() => {
  const hmrDisabled = process.env.DISABLE_HMR === 'true';

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'NEXORA — Private E2EE Messaging',
          short_name: 'NEXORA',
          description:
            'End-to-end encrypted messaging with private chats, 25-member groups, voice notes, 24-hour stories, and streaks.',
          theme_color: '#070913',
          background_color: '#070913',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/ws\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(rootDir, 'dist');
          const srcAssets = path.resolve(rootDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');

          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {
              recursive: true,
              force: true,
            });
          }
        },
      },
      (() => {
        let skipHmrWs = false;
        return {
          name: 'disable-vite-client-ws-when-hmr-off',
          apply: 'serve' as const,
          enforce: 'post' as const,
          configResolved(resolvedConfig: { server: { hmr?: unknown; ws?: unknown } }) {
            skipHmrWs = resolvedConfig.server.hmr === false || resolvedConfig.server.ws === false;
          },
          transform(code: string, id: string) {
            if (!skipHmrWs) return;
            const normId = id.replace(/\\/g, '/');
            if (normId.endsWith('/vite/dist/client/client.mjs') || normId.includes('@vite/client')) {
              if (code.includes('transport.connect(createHMRHandler(handleMessage));')) {
                return {
                  code: code
                    .replace(
                      'transport.connect(createHMRHandler(handleMessage));',
                      '/* HMR disabled: skipped Vite WebSocket connect */'
                    )
                    .replace(
                      'this.transport.send(payload).catch((err) => {',
                      'Promise.resolve().catch((err) => {'
                    ),
                  map: null,
                };
              }
            }
          },
        };
      })(),
    ],

    resolve: {
      alias: {
        '@': rootDir,
      },
    },

    server: {
      // Allow deployed hosting platforms (Render, Netlify, reverse proxies)
      allowedHosts: true as const,

      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: !hmrDisabled,
      ...(hmrDisabled ? { ws: false as const } : {}),

      // Disable file watching when DISABLE_HMR is true.
      watch: hmrDisabled ? null : {},
    },

    preview: {
      allowedHosts: true as const,
    },
  };
});
