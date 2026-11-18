import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import UnoCSS from 'unocss/vite';

const apiTarget = process.env['PRINTOPS_DEV_API_TARGET'] ?? 'http://127.0.0.1:31415';
const isControlApp = process.env['VITE_CONTROL_APP'] === 'true';

export default defineConfig({
  cacheDir: isControlApp ? 'node_modules/.vite-control' : 'node_modules/.vite',
  plugins: [UnoCSS(), react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 3000,
    // The editor/agent hosts write through atomic *.tmpdir scratch folders on
    // Windows. Watching them makes chokidar throw EBUSY and kills `vite dev`.
    watch: {
      ignored: ['**/*.tmpdir', '**/*.tmpdir/**', '**/*.tmp'],
    },
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
