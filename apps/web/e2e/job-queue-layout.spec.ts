import { expect, test, type Page } from '@playwright/test';
import { installHarness } from './support.js';

/**
 * Job Queue layout guards.
 *
 * The queue page has two toolbars stacked inside one card (search + status, then
 * the incoming-key filter) and a header row with a page action beside the
 * freshness check. Each of those pairs used to drift: the key-filter row had no
 * inset so its inputs sat flush against the card edge, and its buttons dropped to
 * a line of their own once the four-column grid collapsed. These assertions are
 * cheap, measured, and independent of copy or class-name churn beyond the page's
 * own hooks.
 */

const JOBS = [
  {
    id: 'j1',
    requestId: 'REQ-0001',
    printerId: 'p1',
    printerCode: 'ZEBRA_OPD_01',
    status: 'UNVERIFIED',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    mimeType: 'text/html',
    payload: { hn: '123456', patient_name: 'Somchai Dee' },
    receivedAt: '2026-11-18T09:00:00.000Z',
  },
  {
    id: 'j2',
    requestId: 'REQ-0002',
    printerId: 'p1',
    printerCode: 'ZEBRA_OPD_01',
    status: 'SUCCESS',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    mimeType: 'text/html',
    payload: { hn: '998877', patient_name: 'Failed Patient' },
    receivedAt: '2026-11-18T08:30:00.000Z',
    finishedAt: '2026-11-18T08:30:02.000Z',
  },
];

async function openQueue(page: Page, width: number, height: number, locale: 'en' | 'th' = 'th') {
  await page.setViewportSize({ width, height });
  await installHarness(page, {
    locale,
    role: 'OWNER',
    api: async (url, route, method) => {
      if (method !== 'GET') return false;
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/jobs') {
        await route.fulfill({ json: JOBS });
        return true;
      }
      await route.fulfill({ json: [] });
      return true;
    },
  });
  await page.goto('/jobs');
  // The key-filter row only renders when the scope carries incoming keys.
  await expect(page.locator('.job-queue-keyfilters')).toBeVisible();
}

function box(locator: Parameters<Page['locator']>[0]) {
  return locator;
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const) {
  test(`queue rows and actions line up at ${viewport.width}`, async ({ page }) => {
    await openQueue(page, viewport.width, viewport.height);

    // 1. Both toolbars inset their content the same way: the search row and the
    //    key-filter row must not start at different x positions.
    const inset = await page.evaluate(() => {
      const card = document.querySelector('.ui-table-card');
      const rows = Array.from(document.querySelectorAll('.ui-table-card > .ui-resource-toolbar, .job-queue-keyfilters'));
      if (!card || rows.length < 2) return null;
      return rows.map((row) => {
        const firstChild = row.firstElementChild;
        const rowRect = row.getBoundingClientRect();
        const childRect = (firstChild ?? row).getBoundingClientRect();
        return { left: Math.round(childRect.left - rowRect.left), right: Math.round(rowRect.right - childRect.right) };
      });
    });
    expect(inset, 'queue card toolbars missing').not.toBeNull();
    expect(inset![0]).toEqual(inset![1]);
    expect(inset![0]!.left, 'a toolbar row has no inset').toBeGreaterThanOrEqual(12);
    expect(inset![0]!.left, 'toolbar insets are not symmetric').toBe(inset![0]!.right);

    // 2. In the key-filter row the action group sits on the same line as the
    //    inputs: their bottom edges agree, however the fields wrapped.
    const aligned = await page.evaluate(() => {
      const actions = document.querySelector('.job-queue-keyfilters__actions');
      const controls = Array.from(document.querySelectorAll('.job-queue-keyfilters select, .job-queue-keyfilters input'));
      if (!actions || controls.length === 0) return null;
      const actionsRect = actions.getBoundingClientRect();
      const bottoms = controls.map((control) => Math.round(control.getBoundingClientRect().bottom));
      const nearest = bottoms.reduce((best, value) =>
        Math.abs(value - actionsRect.bottom) < Math.abs(best - actionsRect.bottom) ? value : best,
      );
      return { actionsBottom: Math.round(actionsRect.bottom), nearestControlBottom: nearest };
    });
    expect(aligned, 'key-filter actions or controls missing').not.toBeNull();
    expect(
      Math.abs(aligned!.actionsBottom - aligned!.nearestControlBottom),
      'the key-filter buttons are not on the same line as the inputs',
    ).toBeLessThanOrEqual(2);

    // 3. The header's page action and the freshness check share one centred line -
    //    on a phone they stack by design, so this only applies from 1024 up.
    if (viewport.width >= 1024) {
      const headerCentres = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('main button')).filter((button) => {
          const text = (button.textContent ?? '').trim();
          return text === 'ส่งออก CSV' || text === 'รีเฟรช' || text === 'Export CSV' || text === 'Refresh';
        });
        return buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return Math.round(rect.top + rect.height / 2);
        });
      });
      expect(headerCentres.length, 'header actions missing').toBe(2);
      expect(
        Math.abs(headerCentres[0]! - headerCentres[1]!),
        'the export button and the refresh button are on different lines',
      ).toBeLessThanOrEqual(2);
    }

    // 4. Nothing in the card overflows sideways.
    const overflow = await page.evaluate(() => {
      const card = document.querySelector('.ui-table-card');
      if (!card) return null;
      return card.scrollWidth - card.clientWidth;
    });
    expect(overflow, 'the queue card scrolls sideways').not.toBeNull();
    expect(overflow!).toBeLessThanOrEqual(1);
  });
}

test('the queue page still fits an English 1024 layout', async ({ page }) => {
  await openQueue(page, 1024, 768, 'en');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
});
