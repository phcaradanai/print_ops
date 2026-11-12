import { expect, test } from '@playwright/test';
import { installHarness } from './support.js';

for (const locale of ['en', 'th'] as const) {
  for (const width of [1440, 1024, 390]) {
    test(`Linux CUPS diagnostics ${locale} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await installHarness(page, { locale, role: 'OWNER', api: async (url, route) => {
        if (url.pathname.endsWith('/runtime-architecture')) {
          await route.fulfill({ json: {
            runtimeMode: 'linux-server',
            executor: { owner: 'api-local-worker', mode: 'typescript-cups', enabled: true },
            discovery: { owner: 'go-runner', mode: 'platform-configured', jobsEnabled: false },
            invariant: { ok: true, code: 'SINGLE_EXECUTOR' },
            supportedProductionProtocols: [], deferredProtocols: ['ipp', 'raw-tcp-9100'],
          } });
        } else if (url.pathname.endsWith('/readiness')) {
          await route.fulfill({ json: { status: 'READY', checkedAt: new Date().toISOString(), components: {} } });
        } else await route.fulfill({ json: [] });
        return true;
      } });
      await page.goto('/settings');
      await expect(page.getByText(locale === 'en' ? 'Linux CUPS adapter' : 'อะแดปเตอร์ CUPS บน Linux', { exact: true })).toBeVisible({ timeout: 3000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `artifacts/browser/settings-linux-${locale}-${width}.png`, fullPage: true });
    });
  }
}
