import { expect, test } from '@playwright/test';
import { hasHorizontalPageScroll, installHarness } from './support.js';

for (const locale of ['en', 'th'] as const) {
  for (const width of [1440, 1024, 390]) {
    test(`unverified print is a warning (${locale}, ${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let submissions = 0;
      await installHarness(page, { locale, api: async (url, route, method) => {
        const path = url.pathname.replace(/^\/api/, '');
        const printer = { id: 'p1', code: 'TEST_PRINTER', name: 'Test printer', protocol: 'cups',
          connectionUri: 'cups://test', isActive: true, status: { code: 'idle', detected: true } };
        const template = { id: 't1', templateCode: 'TEST', name: 'Test label', engine: 'HTML', status: 'ACTIVE', paperProfileId: 'paper1' };
        let json: unknown;
        if (path === '/printers') json = [printer];
        else if (path === '/v1/sandbox/templates') json = [template];
        else if (path === '/v1/paper-profiles') json = [{ id: 'paper1', code: 'TEST', name: 'Test paper', widthMm: 50, heightMm: 30, dpi: 203, orientation: 'portrait' }];
        else if (path === '/jobs/source') json = { id: 'source', printerId: 'p1', printerCode: printer.code,
          templateCode: 'TEST', paperProfileId: 'paper1', payloadSnapshot: '{}' };
        else if (path === '/v1/sandbox/test-print' && method === 'POST') {
          submissions++;
          json = { accepted: true, jobId: 'result-job', traceId: 'trace1', status: 'UNVERIFIED', warnings: [] };
        } else if (path === '/jobs/result-job') json = { id: 'result-job', status: 'UNVERIFIED',
          errorCode: 'PRINT_NOT_VERIFIABLE', errorMessage: 'CUPS internal diagnostic: socket:// cannot verify delivery' };
        else if (path === '/v1/sandbox/render') json = { renderedPreview: '<p>Test</p>', renderedPrintPayload: 'Test', warnings: [], renderTimeMs: 1 };
        else return false;
        await route.fulfill({ json });
        return true;
      } });
      await page.goto('/template-sandbox');
      await page.getByRole('combobox', { name: locale === 'en' ? 'Select printer *' : 'เลือกเครื่องพิมพ์ *', exact: true }).selectOption('p1');
      await page.getByRole('combobox', { name: locale === 'en' ? 'Template' : 'เทมเพลต', exact: true }).selectOption('t1');
      await page.getByRole('button', { name: locale === 'en' ? 'Test Print' : 'สั่งพิมพ์ทดสอบ', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Send physical test print' }).click();
      const warning = page.getByRole('alert').filter({ hasText: 'UNVERIFIED' });
      await expect(warning).toContainText(locale === 'en' ? 'Check the printer before printing again' : 'ตรวจสอบที่เครื่องพิมพ์ก่อนสั่งพิมพ์ซ้ำ');
      await expect(warning).not.toContainText(/Print failed|พิมพ์ล้มเหลว|CUPS internal diagnostic/);
      await expect(warning).toHaveClass(/ui-alert--warning/);
      expect(submissions).toBe(1);
      expect(await hasHorizontalPageScroll(page)).toBe(false);
      await warning.scrollIntoViewIfNeeded();
      await expect(warning).toBeVisible();
      await page.screenshot({ path: `artifacts/browser/sandbox-unverified-${locale}-${width}.png`, fullPage: true });
    });
  }
}
