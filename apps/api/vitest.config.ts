import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    alias: {
      '@printerops/domain': new URL('../../packages/domain/src/index.ts', import.meta.url).pathname,
      '@printerops/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
      '@printerops/adapters': new URL('../../packages/adapters/src/index.ts', import.meta.url).pathname,
    },
  },
});
