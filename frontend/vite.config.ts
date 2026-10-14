import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

/**
 * Backend route prefixes (from openapi.json). In development, requests to these
 * are forwarded to FastAPI so the browser only ever talks to one origin.
 */
const API_PREFIXES = [
  '/auth',
  '/users',
  '/brokers',
  '/strategies',
  '/instruments',
  '/executions',
  '/backtests',
  '/orders',
  '/trades',
  '/positions',
  '/portfolio',
  '/notifications',
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000';

  const proxyRule: ProxyOptions = {
    target,
    changeOrigin: true,
    // A page refresh on e.g. /strategies asks for HTML — serve the React app, not the API.
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
  };
});
