import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
// @ts-ignore -- plain JS module shared with the node:test suite
import {quotesProxyPlugin} from './scripts/quotes-proxy.mjs';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Live investment quotes exist only where this dev/preview middleware
      // runs; the hosted production build falls back to manual prices.
      quotesProxyPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: {
          name: 'Omnigalactic',
          short_name: 'Omnigalactic',
          description: 'Your own mission control — calendar, tasks, notes, budget, and more.',
          start_url: '/',
          display: 'standalone',
          background_color: '#020617',
          theme_color: '#020617',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: '/index.html',
          // Never serve the SPA shell for the authenticated API endpoints —
          // /api/quotes and /api/files must reach the network, not the cache.
          navigateFallbackDenylist: [/^\/api\//],
          // The firebase vendor chunk is just under 500 kB
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          runtimeCaching: [
            {
              // Store logos (Google favicon service) and Google profile
              // avatars, so the shopping list and header render fully offline.
              urlPattern: /^https:\/\/(www\.google\.com\/s2\/favicons|lh3\.googleusercontent\.com\/)/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'external-images',
                expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    define: {
      __APP_COMMIT__: JSON.stringify((process.env.GITHUB_SHA || 'dev').slice(0, 7)),
      __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-motion': ['motion'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
