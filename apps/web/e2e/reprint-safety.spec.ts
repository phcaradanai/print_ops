import { expect, test } from '@playwright/test';
import { installHarness } from './support.js';

const job = {
  id: 'synthetic-job-0001',
  requestId: 'synthetic-request-0001',
  printerId: 'synthetic-printer-0001',
  printerCode: 'SAFE_FAKE_PRINTER',
  runnerId: 'synthetic-runner-0001',
  status: 'SUCCESS',
  copies: 1,
  templateCode: 'SYNTHETIC_TEST_PAGE',
  mimeType: 'text/plain',
  createdAt: '2026-07-27T07:00:00.000Z',
  completedAt: '2026-07-27T07:00:01.000Z',
};

// The API mocks live in the shared harness now. Answering by pathname alone used
// to swallow the page navigation as well, so `goto('/jobs')` rendered the job
// JSON as the document and no button ever existed to click.
async function mockApi(page: import('@playwright/test').Page) {
  await installHarness(page, {
    locale: 'en',
    api: (url, route, method) => {
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/jobs' && method === 'GET') {
        route.fulfill({ json: [job] });
        return true;
      }
      if (path === `/jobs/${job.id}`) {
        route.fulfill({ json: job });
        return true;
      }
      if (path === `/jobs/${job.id}/reprint`) {
        route.fulfill({ status: 201, json: { ...job, id: 'synthetic-reprint-0002', requestId: 'reprint-synthetic-0002' } });
        return true;
      }
      if (path === '/printers' && method === 'GET') {
        route.fulfill({ json: [{ id: job.printerId, code: job.printerCode, name: job.printerCode, status: 'ONLINE' }] });
        return true;
      }
      if (path === '/runners' && method === 'GET') {
        route.fulfill({ json: [{ id: job.runnerId, name: 'synthetic-runner', hostname: 'synthetic', status: 'ONLINE' }] });
        return true;
      }
      return false;
    },
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`safe reprint confirmation ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockApi(page);
    await page.goto('/jobs');
    await page.getByRole('button', { name: /reprint job/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('synthetic-request-0001');
    await expect(dialog).toContainText('SAFE_FAKE_PRINTER');
    await expect(dialog).toContainText('synthetic-runner-0001');
    await expect(dialog).toContainText('not a callback retry');
    const confirm = dialog.getByRole('button', { name: 'Confirm reprint' });
    await expect(confirm).toBeDisabled();
    if (viewport.width === 390) {
      const cancelBox = await dialog.getByRole('button', { name: 'Cancel' }).boundingBox();
      const confirmBox = await confirm.boundingBox();
      expect(cancelBox?.width).toBeGreaterThanOrEqual(44);
      expect(cancelBox?.height).toBeGreaterThanOrEqual(44);
      expect(confirmBox?.width).toBeGreaterThanOrEqual(44);
      expect(confirmBox?.height).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByLabel('Reason for reprint').fill('Synthetic safety verification');
    await dialog.getByLabel(/I understand this action/).check();
    await expect(confirm).toBeEnabled();
    await page.screenshot({
      path: `artifacts/browser/reprint-warning-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
    if (viewport.width === 1440) {
      await confirm.click();
      await expect(page.getByText(/Successfully submitted reprint/)).toBeVisible();
    }
  });
}
