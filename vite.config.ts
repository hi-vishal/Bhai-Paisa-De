import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'

const API_PORT = Number(process.env.BPD_API_PORT ?? 8787)

export default defineConfig({
  root: resolve(import.meta.dirname, 'web'),
  publicDir: resolve(import.meta.dirname, 'web/public'),
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'shared') } },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: { '/api': `http://localhost:${API_PORT}` },
    fs: { allow: [resolve(import.meta.dirname)] },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'theme-boot.js', 'push-sw.js'],
      manifest: {
        id: '/',
        name: 'Bhai Paise De',
        short_name: 'Paise De',
        description: 'Split bills with friends and get paid back by UPI in a tap. Group chat, shared kitty, PDF statements. Free.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#EFE9FF',
        theme_color: '#EFE9FF',
        categories: ['finance', 'lifestyle', 'social'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'New group', short_name: 'New group', url: '/g/new', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Dues', short_name: 'Dues', url: '/dues', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Activity', short_name: 'Activity', url: '/activity', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        importScripts: ['/push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // animated emoji, cached so they work offline after the first view
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\//,
            handler: 'CacheFirst',
            options: { cacheName: 'emoji', expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // read-only screens still open on a train with no signal
            urlPattern: ({ url, request }) => request.method === 'GET' && /^\/api\/(groups|activity|me|dues|friends)(\/|$)/.test(url.pathname) && !/\/chat$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'api-reads', networkTimeoutSeconds: 4, expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
