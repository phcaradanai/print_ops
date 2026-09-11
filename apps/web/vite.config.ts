import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import UnoCSS from 'unocss/vite';

const apiTarget = process.env['PRINTOPS_DEV_API_TARGET'] ?? 'http://127.0.0.1:31415';

export default defineConfig({
  plugins: [UnoCSS(), react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
      },
    },
  },
  test: {
    passWithNoTests: true,
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
