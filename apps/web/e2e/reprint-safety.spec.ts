import { expect, test } from '@playwright/test';

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

async function mockApi(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('token', 'synthetic-browser-token'));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/me') {
      return route.fulfill({ json: { id: 'synthetic-admin', email: 'test@example.invalid', name: 'Synthetic Admin', role: 'ADMIN' } });
    }
    if (url.pathname === '/jobs' && route.request().method() === 'GET') return route.fulfill({ json: [job] });
    if (url.pathname === `/jobs/${job.id}`) return route.fulfill({ json: job });
    if (url.pathname === `/jobs/${job.id}/reprint`) {
      return route.fulfill({ status: 201, json: { ...job, id: 'synthetic-reprint-0002', requestId: 'reprint-synthetic-0002' } });
    }
    return route.continue();
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
    await page.getByRole('button', { name: /re-print/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('synthetic-request-0001');
    await expect(dialog).toContainText('SAFE_FAKE_PRINTER');
    await expect(dialog).toContainText('synthetic-runner-0001');
    await expect(dialog).toContainText('not a callback retry');
    const confirm = dialog.getByRole('button', { name: 'Confirm reprint' });
    await expect(confirm).toBeDisabled();
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
