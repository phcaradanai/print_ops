import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installHarness } from './support.js';

function detectsControlBuild(): boolean {
  try {
    const dist = join(process.cwd(), 'apps', 'web', 'dist');
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const entry = /<script[^>]+src="\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1];
    if (!entry) return true;
    const bundle = readFileSync(join(dist, 'assets', entry), 'utf8');
    const hasControlRoute = bundle.includes('path:"/control/content"') || bundle.includes('path:"/control/jobs"');
    const hasDashboardRoutes = bundle.includes('path:"/printers"');
    return hasControlRoute || !hasDashboardRoutes;
  } catch {
    return true;
  }
}

const CONTROL_BUILD = process.env['PRINTOPS_CONTROL_E2E'] === '1' || detectsControlBuild();

test.beforeEach(() => {
  test.skip(
    !CONTROL_BUILD,
    'the served apps/web/dist bundle is the dashboard build; /control/content only exists in the Web Control build (VITE_CONTROL_APP=true npm run build -w apps/web)',
  );
});

const PROFILES = [
  {
    id: 'pp-1',
    code: 'LABEL_100X50',
    name: 'Label 100 x 50 mm',
    widthMm: 100,
    heightMm: 50,
    dpi: 203,
    orientation: 'PORTRAIT',
  },
];

const DEVICES = [
  {
    deviceId: 'dev-1',
    hostname: 'station-01',
    displayName: 'Station 01',
    siteId: 'SITE-A',
    appVersion: '0.1.54',
    connectionState: 'ONLINE',
    capabilities: [],
    lastSeenAt: '2026-11-19T05:00:00.000Z',
  },
];

async function openControlContent(page: Page, width: number, height: number, locale: 'en' | 'th' = 'th') {
  await page.setViewportSize({ width, height });
  await installHarness(page, {
    locale,
    role: 'OWNER',
    api: async (url, route, method) => {
      if (method !== 'GET') return false;
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/v1/control/devices') {
        await route.fulfill({ json: DEVICES });
        return true;
      }
      if (path === '/v1/paper-profiles') {
        await route.fulfill({ json: PROFILES });
        return true;
      }
      if (path === '/v1/templates') {
        await route.fulfill({ json: [] });
        return true;
      }
      await route.fulfill({ json: [] });
      return true;
    },
  });
  await page.goto('/control/content');
  await expect(page.locator('main select').first()).toBeVisible();
  mkdirSync('artifacts/browser/web-control-content', { recursive: true });
  await page.screenshot({ path: `artifacts/browser/web-control-content/${width}-${locale}.png`, fullPage: true });
}

for (const viewport of [
  { width: 1440, height: 900, locale: 'th' as const },
  { width: 1024, height: 768, locale: 'th' as const },
  { width: 1024, height: 768, locale: 'en' as const },
  { width: 390, height: 844, locale: 'th' as const },
]) {
  test(`control content buttons align with sibling selects at ${viewport.width} (${viewport.locale})`, async ({ page }) => {
    await openControlContent(page, viewport.width, viewport.height, viewport.locale);

    // Every button sharing a horizontal row with a labelled select must share
    // its bottom edge rather than floating vertically centred against label + select.
    const misaligned = await page.evaluate(() => {
      const issues: Array<{ button: string; buttonBottom: number; selectBottom: number }> = [];
      const rows = Array.from(document.querySelectorAll<HTMLElement>('main .ui-inline'));
      for (const row of rows) {
        const selects = Array.from(row.querySelectorAll<HTMLSelectElement>('select'));
        const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('button'));
        if (selects.length === 0 || buttons.length === 0) continue;
        const selectRects = selects.map((el) => el.getBoundingClientRect());
        for (const button of buttons) {
          const btnRect = button.getBoundingClientRect();
          // Only compare controls that share the same visual band (not wrapped onto a new line).
          const sameLine = selectRects.filter(
            (sr) => Math.abs(sr.bottom - btnRect.bottom) < 28,
          );
          if (sameLine.length === 0) continue;
          const nearest = sameLine.reduce((best, curr) =>
            Math.abs(curr.bottom - btnRect.bottom) < Math.abs(best.bottom - btnRect.bottom) ? curr : best,
          );
          if (Math.abs(btnRect.bottom - nearest.bottom) > 2) {
            issues.push({
              button: (button.textContent ?? '').trim(),
              buttonBottom: Math.round(btnRect.bottom),
              selectBottom: Math.round(nearest.bottom),
            });
          }
        }
      }
      return issues;
    });

    expect(misaligned, 'buttons are floating out of alignment with sibling selects').toEqual([]);
  });
}
