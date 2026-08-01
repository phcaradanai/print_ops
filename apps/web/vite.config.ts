import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:31415',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Legacy unversioned routes are same-origin in production (the API serves
      // the built SPA itself), so the client requests them without a prefix.
      // Under Vite they need an explicit proxy or they resolve against the dev
      // server and 404 — login being the first one an operator hits.
      '^/(auth|health|me|jobs|printers|runners|commands|audit-logs)(/|\\?|$)': {
        target: 'http://127.0.0.1:31415',
      },
    },
  },
  test: {
    passWithNoTests: true,
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
