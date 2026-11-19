import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { installHarness } from './support.js';

/**
 * Station Job Queue guards.
 *
 * The queue was rebuilt on the Web Control "Incoming Jobs" layout, scoped to this
 * station's own jobs. That shared list brings its own risks, and these assertions
 * are the cheap structural ones:
 *
 *   - the page has exactly one action region, and no station selector: a station
 *     is one scope, so a selector there would be a lie about the data;
 *   - a bucket count equals the rows its click shows, with a search and an exact
 *     status active at the same time;
 *   - the column picker cannot offer the withdrawn Station column, and a resize
 *     still moves a real column width;
 *   - nothing overflows sideways at 1440, 1024 or 390, in either language.
 */

const JOBS = [
  {
    id: 'job-unverified-0001',
    requestId: 'REQ-0001',
    printerId: 'p1',
    printerCode: 'ZEBRA_OPD_01',
    runnerId: 'runner-1',
    status: 'UNVERIFIED',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    mimeType: 'text/html',
    payload: { hn: '123456', patient_name: 'Somchai Dee' },
    createdAt: '2026-11-18T09:00:00.000Z',
  },
  {
    id: 'job-success-0002',
    requestId: 'REQ-0002',
    printerId: 'p1',
    printerCode: 'ZEBRA_OPD_01',
    runnerId: 'runner-1',
    status: 'SUCCESS',
    copies: 1,
    templateCode: 'PATIENT_LABEL',
    mimeType: 'text/html',
    payload: { hn: '998877', patient_name: 'Suda Jaidee' },
    createdAt: '2026-11-18T08:30:00.000Z',
    completedAt: '2026-11-18T08:30:02.000Z',
  },
  {
    id: 'job-queued-0003',
    requestId: 'REQ-0003',
    printerId: 'p2',
    printerCode: 'RECEIPT_FRONT',
    status: 'QUEUED',
    copies: 2,
    mimeType: 'text/plain',
    createdAt: '2026-11-18T08:20:00.000Z',
  },
  {
    id: 'job-failed-0004',
    requestId: 'REQ-0004',
    printerId: 'p2',
    printerCode: 'RECEIPT_FRONT',
    status: 'FAILED',
    copies: 1,
    errorCode: 'PAPER_OUT',
    mimeType: 'text/plain',
    createdAt: '2026-11-18T08:10:00.000Z',
  },
];

async function openQueue(
  page: Page,
  width: number,
  height: number,
  locale: 'en' | 'th' = 'th',
  query = '',
) {
  await page.setViewportSize({ width, height });
  await installHarness(page, {
    locale,
    role: 'OWNER',
    api: async (url, route, method) => {
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/jobs' && method === 'GET') {
        await route.fulfill({ json: JOBS });
        return true;
      }
      if (path === '/jobs/job-unverified-0001' && method === 'GET') {
        await route.fulfill({ json: JOBS[0] });
        return true;
      }
      await route.fulfill({ json: [] });
      return true;
    },
  });
  await page.goto(`/jobs${query}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The list is the page: wait for the table before measuring anything.
  await expect(page.locator('.ui-data-table-frame')).toBeVisible();
  mkdirSync('artifacts/browser/job-queue', { recursive: true });
  await page.screenshot({
    path: `artifacts/browser/job-queue/${width}-${locale}${query ? '-deep-link' : ''}.png`,
    fullPage: true,
  });
}

for (const locale of ['th', 'en'] as const) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ] as const) {
    test(`queue fits ${viewport.width} ${locale} without a station selector`, async ({ page }) => {
      await openQueue(page, viewport.width, viewport.height, locale);

      // One frame: a single h1 and a single named action region (the scope bar).
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.locator('main section[aria-label]')).toHaveCount(1);

      // A station has one scope, so the fleet selector must not be here at all.
      await expect(page.getByRole('option', { name: /all stations/i })).toHaveCount(0);

      // Nothing scrolls sideways: not the page, not the table frame.
      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(pageOverflow, 'the queue page scrolls sideways').toBeLessThanOrEqual(1);

      const tableOverflow = await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>('.ui-data-table-frame');
        if (!frame) return null;
        return frame.scrollWidth - frame.clientWidth;
      });
      expect(tableOverflow, 'the job table scrolls sideways inside its frame').not.toBeNull();
      expect(tableOverflow!).toBeLessThanOrEqual(1);
    });
  }
}

test('a bucket count equals the rows its click shows', async ({ page }) => {
  await openQueue(page, 1440, 900, 'en');
  const cards = page.getByRole('region', { name: 'Jobs on this station' });
  const rows = cards.locator('tbody tr');

  // Unfiltered: every job in scope.
  await expect(rows).toHaveCount(4);

  // Needs review: UNVERIFIED + FAILED, and the chip says so.
  await page.getByRole('button', { name: 'Needs review (2)' }).click();
  await expect(rows).toHaveCount(2);

  // Clicking the selected bucket returns to All.
  await page.getByRole('button', { name: 'Needs review (2)' }).click();
  await expect(rows).toHaveCount(4);

  // A search and an exact status stack on top without breaking the count promise.
  await page.getByRole('searchbox', { name: 'Search jobs' }).fill('REQ-0004');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Needs review (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Needs review (1)' }).click();
  await expect(rows).toHaveCount(1);
});

test('a ?status= deep link arrives filtered and stays removable', async ({ page }) => {
  await openQueue(page, 1440, 900, 'en', '?status=UNVERIFIED');
  const cards = page.getByRole('region', { name: 'Jobs on this station' });
  const rows = cards.locator('tbody tr');

  await expect(rows).toHaveCount(1);
  await expect(cards.getByText('REQ-0001').first()).toBeVisible();

  // The condition is visible and removable on its own.
  const chip = page.getByRole('button', { name: 'Remove Status is UNVERIFIED' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(rows).toHaveCount(4);
});

test('the column picker withdraws Station and resizing still moves a column', async ({ page }) => {
  await openQueue(page, 1440, 900, 'en');

  await page.getByRole('button', { name: 'Columns' }).click();
  const picker = page.getByRole('dialog', { name: 'List columns' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('checkbox', { name: 'Station' })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Close' }).last().click();

  const table = page.locator('table.wcj-jobs-table');
  await expect(table).not.toHaveClass(/wcj-jobs-table--fixed/);

  // The handle is a separator with an announced range; arrow keys resize it, which
  // is the deterministic path (a pointer drag is the same code).
  const handle = page.getByRole('separator', { name: /Resize Received column/ });
  await handle.focus();
  await handle.press('ArrowLeft');
  await expect(table).toHaveClass(/wcj-jobs-table--fixed/);

  await page.getByRole('button', { name: 'Reset widths' }).click();
  await expect(table).not.toHaveClass(/wcj-jobs-table--fixed/);
});

test('a row selection pins a batch bar that never covers the pagination', async ({ page }) => {
  await openQueue(page, 1440, 900, 'en');
  const cards = page.getByRole('region', { name: 'Jobs on this station' });

  await cards.getByRole('checkbox', { name: 'Select job REQ-0001' }).check();
  const bar = page.getByRole('region', { name: '1 jobs selected' });
  await expect(bar).toBeVisible();

  // The spacer reserves the bar's height, so the last row and the pagination stay
  // reachable instead of sitting under a floating bar.
  const spacer = page.locator('.wcj-selection-spacer');
  await expect(spacer).toHaveCount(1);
  const spacerBox = await spacer.boundingBox();
  expect(spacerBox?.height ?? 0).toBeGreaterThan(24);

  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(bar).toHaveCount(0);
});

test('the page still fits an English 1024 layout', async ({ page }) => {
  await openQueue(page, 1024, 768, 'en');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
});

test('background polling keeps the refresh button and adjacent actions steady', async ({ page }) => {
  let jobsRequests = 0;
  let releaseDelayedPoll!: () => void;
  const secondPollOpen = new Promise<void>((resolve) => {
    let resolved = false;
    releaseDelayedPoll = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
  });
  let secondPollGate!: () => void;
  const secondPollStarted = new Promise<void>((resolve) => {
    secondPollGate = resolve;
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await installHarness(page, {
    locale: 'th',
    role: 'OWNER',
    api: async (url, route, method) => {
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/jobs' && method === 'GET') {
        jobsRequests += 1;
        if (jobsRequests === 2) {
          secondPollGate();
          await secondPollOpen;
        }
        await route.fulfill({ json: JOBS });
        return true;
      }
      await route.fulfill({ json: [] });
      return true;
    },
  });

  await page.goto('/jobs');
  await expect(page.locator('.ui-data-table-frame')).toBeVisible();

  const exportButton = page.getByRole('button', { name: 'ส่งออก CSV' });
  const refreshButton = page.getByRole('button', { name: 'รีเฟรช' });
  const initialBox = await exportButton.boundingBox();
  expect(initialBox).not.toBeNull();

  // Wait for the scheduled 1.5s background poll to be actively in flight.
  await secondPollStarted;
  await expect(page.locator('.freshness-refreshing')).toHaveCount(0);
  await expect(refreshButton).not.toHaveAttribute('aria-busy', 'true');
  const duringPollBox = await exportButton.boundingBox();
  expect(duringPollBox?.x).toBe(initialBox?.x);

  releaseDelayedPoll();
});
