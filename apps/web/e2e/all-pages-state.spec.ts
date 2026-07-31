import { expect, test } from '@playwright/test';
import { installHarness } from './support.js';

const ROUTES = [
  '/', '/printers', '/printers/p1', '/jobs', '/jobs/j1', '/runners',
  '/templates', '/paper-profiles', '/discovered-printers', '/diagnostics',
  '/template-sandbox', '/webhooks', '/route-policies', '/printer-bindings',
  '/print-flow', '/audit-logs', '/users', '/export', '/settings',
] as const;

const printer = {
  id: 'p1',
  code: 'AUDIT_PRINTER',
  name: 'Audit Printer',
  protocol: 'IPP',
  connectionUri: 'ipp://127.0.0.1/printer',
  status: { code: 'ONLINE', text: 'Ready' },
};

const job = {
  id: 'j1',
  requestId: 'audit-request',
  printerId: printer.id,
  printerCode: printer.code,
  status: 'SUCCESS',
  copies: 1,
  templateCode: 'AUDIT_TEMPLATE',
  mimeType: 'text/html',
  receivedAt: '2026-07-31T07:00:00.000Z',
  finishedAt: '2026-07-31T07:00:01.000Z',
};

test.describe('all-page interaction state', () => {
  for (const path of ROUTES) {
    test(path, async ({ page }) => {
      const runtimeErrors: string[] = [];
      page.on('pageerror', (error) => runtimeErrors.push(error.message));
      await page.setViewportSize({ width: 1024, height: 768 });
      await installHarness(page, {
        role: 'OWNER',
        api: async (url, route, method) => {
          if (method !== 'GET') return false;
          if (url.pathname === '/printers/p1') {
            await route.fulfill({ json: printer });
            return true;
          }
          if (url.pathname === '/jobs/j1') {
            await route.fulfill({ json: job });
            return true;
          }
          if (url.pathname === '/jobs/j1/trace') {
            await route.fulfill({ status: 404, json: { error: 'No trace' } });
            return true;
          }
          if (url.pathname === '/v1/print-flow/config') {
            await route.fulfill({
              json: {
                http: { path: '/api/v1/printer/:template/:profile', method: 'POST', authHeader: 'X-API-Key' },
                nats: { enabled: false, connected: false, authRequired: false },
              },
            });
            return true;
          }
          if (url.pathname.endsWith('/v1/system/readiness')) {
            await route.fulfill({
              json: {
                status: 'READY',
                checkedAt: '2026-07-31T07:00:00.000Z',
                components: {},
              },
            });
            return true;
          }
          if (url.pathname === '/printers') {
            await route.fulfill({ json: path === '/printers' ? [] : [printer] });
            return true;
          }
          if (url.pathname === '/jobs') {
            await route.fulfill({ json: path === '/jobs' ? [] : [job] });
            return true;
          }
          await route.fulfill({ json: [] });
          return true;
        },
      });
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(150);

      const shellOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(shellOverflow, `${path} scrolls horizontally`).toBeLessThanOrEqual(1);

      const unnamed = await page.locator('input:not([type=file]), select, textarea').evaluateAll((controls) =>
        controls.filter((control) => {
          const element = control as HTMLInputElement;
          if (element.hidden || element.offsetParent === null) return false;
          return !element.getAttribute('aria-label')
            && !element.getAttribute('aria-labelledby')
            && (!element.labels || element.labels.length === 0);
        }).map((control) => control.outerHTML.slice(0, 180)),
      );
      expect(unnamed, `${path} has unnamed form controls`).toEqual([]);

      const controls = page.locator('input:not([type=file]), select, textarea');
      for (let index = 0; index < await controls.count(); index += 1) {
        const control = controls.nth(index);
        if (!await control.isVisible() || !await control.isEnabled()) continue;
        const tag = await control.evaluate((element) => element.tagName.toLowerCase());
        const type = await control.getAttribute('type');
        if (type === 'hidden' || type === 'color' || type === 'radio') continue;
        if (type === 'checkbox') {
          const before = await control.isChecked();
          await control.click();
          expect(await control.isChecked(), `${path} checkbox ${index} did not change`).toBe(!before);
          await control.click();
          continue;
        }
        if (tag === 'select') {
          const before = await control.inputValue();
          const values = await control.locator('option').evaluateAll((options) =>
            options.map((option) => (option as HTMLOptionElement).value),
          );
          const next = values.find((value) => value !== before);
          if (next == null) continue;
          await control.selectOption(next);
          expect(await control.inputValue(), `${path} select ${index} did not change`).toBe(next);
          continue;
        }
        if (await control.getAttribute('readonly') != null) continue;
        const before = await control.inputValue();
        const next = type === 'number' ? '2' : `${before}x`;
        await control.fill(next);
        await control.blur();
        await page.waitForTimeout(10);
        const after = await control.inputValue();
        if (type === 'number') {
          expect(Number(after), `${path} input ${index} lost its changed state`).toBe(Number(next));
        } else {
          expect(after, `${path} input ${index} lost its changed state`).toBe(next);
        }
      }
      expect(runtimeErrors, `${path} raised runtime errors`).toEqual([]);
    });
  }
});
