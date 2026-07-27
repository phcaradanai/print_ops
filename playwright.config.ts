import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  outputDir: './artifacts/browser/test-results',
  reporter: [['list'], ['html', { outputFolder: './artifacts/browser/report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'python -m http.server 4173 --bind 127.0.0.1 --directory apps/web/dist',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
