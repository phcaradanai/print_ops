import { expect, test, type Page } from '@playwright/test';
import { installHarness } from './support.js';

const MOBILE = { width: 390, height: 844 };

const jobs = [
  {
    id: 'mobile-failed-0001', requestId: 'mobile-request-1', printerId: 'mobile-printer-1',
    printerCode: 'MOBILE_A', runnerId: 'mobile-runner-1', status: 'FAILED', copies: 1,
    templateCode: 'MOBILE_LABEL', sourceSystem: 'mobile-suite', createdAt: '2026-08-01T07:00:00.000Z',
  },
  {
    id: 'mobile-success-0002', requestId: 'mobile-request-2', printerId: 'mobile-printer-1',
    printerCode: 'MOBILE_A', runnerId: 'mobile-runner-1', status: 'SUCCESS', copies: 1,
    templateCode: 'OTHER_LABEL', sourceSystem: 'mobile-suite', createdAt: '2026-08-01T07:01:00.000Z',
  },
];

async function installMobileHarness(page: Page) {
  await installHarness(page, {
    locale: 'en',
    role: 'OWNER',
    api: async (url, route, method) => {
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/jobs' && method === 'GET') {
        await route.fulfill({ json: jobs });
        return true;
      }
      if (path === '/printers' && method === 'GET') {
        await route.fulfill({ json: [{ id: 'mobile-printer-1', code: 'MOBILE_A', name: 'Mobile printer', isActive: true, protocol: 'IPP', capabilities: { duplexSupported: false, colorSupported: false, maxCopies: 2 } }] });
        return true;
      }
      if (path === '/v1/sandbox/templates' && method === 'GET') {
        await route.fulfill({ json: [{ id: 'mobile-template-1', templateCode: 'MOBILE_LABEL', name: 'Mobile label', engine: 'HTML', status: 'ACTIVE' }] });
        return true;
      }
      if (path === '/v1/paper-profiles' && method === 'GET') {
        await route.fulfill({ json: [] });
        return true;
      }
      return false;
    },
  });
}

test.describe('mobile interactions outside reprint confirmation', () => {
  test('opens navigation, filters queue cards, and clears a selection', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await installMobileHarness(page);
    await page.goto('/jobs');

    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toHaveClass(/app-nav--open/);
    await nav.getByRole('link', { name: 'Job Queue' }).click();
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute('aria-expanded', 'false');

    await expect(page.locator('.job-queue-cards')).toBeVisible();
    await expect(page.locator('.job-queue-table')).toBeHidden();
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('FAILED');
    const cards = page.locator('.job-queue-cards');
    await expect(cards.getByRole('link', { name: 'MOBILE_LABEL' })).toBeVisible();
    await expect(cards.getByRole('link', { name: 'OTHER_LABEL' })).toHaveCount(0);

    await page.getByLabel('Search jobs').fill('no matching job');
    await expect(page.getByText('No jobs match the selected status or search.')).toBeVisible();
    await page.getByLabel('Search jobs').fill('MOBILE_LABEL');
    await cards.getByRole('checkbox', { name: 'Select job mobile-f' }).check();
    await expect(page.getByRole('region', { name: 'Batch queue actions' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByRole('region', { name: 'Batch queue actions' })).toHaveCount(0);
  });

  test('keeps sandbox controls usable and explains unavailable printer capabilities', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await installMobileHarness(page);
    await page.goto('/template-sandbox');

    await page.getByLabel('Select printer *').selectOption('mobile-printer-1');
    await expect(page.getByRole('status').filter({ hasText: 'Double-sided printing is not available' })).toBeVisible();
    await expect(page.getByRole('button', { name: /double-sided/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /color/i })).toBeDisabled();

    const decrement = page.getByRole('button', { name: '−' });
    const increment = page.getByRole('button', { name: '+' });
    for (const control of [decrement, increment]) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await increment.click();
    await expect(page.getByLabel('Copies')).toHaveValue('2');
    await page.getByRole('button', { name: 'Urgent' }).click();
  });
});
