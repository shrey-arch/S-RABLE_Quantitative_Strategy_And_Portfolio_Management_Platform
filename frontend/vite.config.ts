/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import { API_PREFIXES } from './src/api/api-prefixes';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000';

  const proxyRule: ProxyOptions = {
    target,
    changeOrigin: true,
    // A page refresh on e.g. /strategies asks for HTML - serve the React app, not the API.
    bypass: (req) => (req.headers.accept?.includes('text/html') ? req.url : undefined),
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: Object.fromEntries(API_PREFIXES.map((prefix) => [prefix, proxyRule])),
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      // One jsdom per worker instead of one per test file (each file still runs in
      // its own context): about 2.5x faster.
      pool: 'vmThreads',
      // The heaviest page tests render a whole page and wait on many queries; the
      // slowest take about five seconds, which is Vitest's own default, so on a
      // busy machine they failed for being slow rather than for being wrong. This
      // leaves real headroom: a test that is actually broken still fails at once
      // with its assertion, and only a genuine hang waits this long.
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
