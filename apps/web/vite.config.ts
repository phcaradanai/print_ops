import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { LEGACY_API_PROXY_PATTERN } from './devProxy.js';

const apiTarget = process.env['PRINTOPS_DEV_API_TARGET'] ?? 'http://127.0.0.1:31415';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Legacy unversioned routes are same-origin in production (the API serves
      // the built SPA itself), so the client requests them without a prefix.
      // Under Vite they need an explicit proxy or they resolve against the dev
      // server and 404 — login being the first one an operator hits.
      // Vite matches against the complete request URL, including its query
      // string. Keep `?` as an explicit boundary: without it, `/jobs?limit=500`
      // misses this proxy and Vite's SPA fallback returns index.html with HTTP
      // 200, which the API client correctly reports as INVALID_JSON.
      [LEGACY_API_PROXY_PATTERN]: {
        target: apiTarget,
      },
    },
  },
  test: {
    passWithNoTests: true,
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
