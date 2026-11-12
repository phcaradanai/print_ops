import { test, expect } from '@playwright/test';
import { installHarness, hasHorizontalPageScroll } from './support';

const runner = { id: 'vpn-runner', name: 'VPN Station', hostname: 'vpn-pc', status: 'online',
  metadata: { network_printer_search: true }, supportedProtocols: [], registeredAt: '2026-11-12T00:00:00Z' };
const search = { id: 'search-1', runnerId: runner.id, targets: ['10.20.0.8'], state: 'QUEUED', addresses: [],
  createdAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-12T00:02:00Z' };

test('searches from the selected Runner and registers a reachable TCP candidate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let state = 'QUEUED';
  let started = false;
  let registered = false;
  await installHarness(page, { locale: 'en', api: async (url, route, method) => {
    if (url.pathname === '/api/runners') { await route.fulfill({ json: [runner] }); return true; }
    if (url.pathname.endsWith('/printer-searches/latest')) {
      await route.fulfill({ json: started ? { ...search, state, addresses: state === 'COMPLETED' ? ['10.20.0.8'] : [] } : null }); return true;
    }
    if (url.pathname.endsWith('/printer-searches') && method === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ targets: '10.20.0.8' });
      expect(url.pathname).toContain('/vpn-runner/');
      started = true;
      await route.fulfill({ status: 202, json: search }); return true;
    }
    if (url.pathname === '/api/v1/discovered-printers') {
      await route.fulfill({ json: state === 'COMPLETED' ? [{ id: 'dp-1', runnerId: runner.id, localPrinterName: 'TCP 10.20.0.8:9100',
        connectionType: 'tcp_ip', portName: '10.20.0.8:9100', isDefault: false, isShared: false,
        firstSeenAt: search.createdAt, lastSeenAt: search.createdAt, registeredPrinterId: registered ? 'p-1' : undefined }] : [] }); return true;
    }
    if (url.pathname.endsWith('/dp-1/register')) { registered = true; await route.fulfill({ status: 201, json: { id: 'p-1' } }); return true; }
    return false;
  } });
  await page.goto('/discovered-printers');
  await page.getByLabel('IP address or range').fill('10.20.0.8');
  await page.getByRole('button', { name: 'Search network', exact: true }).click();
  await expect(page.getByText('Waiting for the selected Runner')).toBeVisible();
  state = 'RUNNING';
  await expect(page.getByText('Searching TCP port 9100')).toBeVisible();
  state = 'COMPLETED';
  await expect(page.getByText('TCP 10.20.0.8:9100', { exact: true })).toBeVisible();
  await expect(page.getByText('An open port is a candidate, not verified printer identity or a print confirmation.')).toBeVisible();
  await page.screenshot({ path: 'artifacts/browser/network-printer-search-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Register', exact: true }).click();
  await expect.poll(() => registered).toBe(true);
});

test('shows an update explanation for old Runners and hides search from viewers', async ({ page }) => {
  await installHarness(page, { api: async (url, route) => {
    if (url.pathname === '/api/runners') { await route.fulfill({ json: [{ ...runner, metadata: {} }] }); return true; }
    if (url.pathname === '/api/v1/discovered-printers') { await route.fulfill({ json: [] }); return true; }
    return false;
  } });
  await page.goto('/discovered-printers');
  await expect(page.getByText('Update the Runner to enable network search.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search network', exact: true })).toBeDisabled();
});

test('accepts a newer search from another operator without retaining an old queued snapshot', async ({ page }) => {
  let state = 'QUEUED';
  let started = false;
  await installHarness(page, { locale: 'en', api: async (url, route, method) => {
    if (url.pathname === '/api/runners') { await route.fulfill({ json: [runner] }); return true; }
    if (url.pathname === '/api/v1/discovered-printers') { await route.fulfill({ json: [] }); return true; }
    if (url.pathname.endsWith('/printer-searches') && method === 'POST') {
      started = true;
      await route.fulfill({ status: 202, json: search }); return true;
    }
    if (url.pathname.endsWith('/printer-searches/latest')) {
      await route.fulfill({ json: started ? { ...search, id: 'other-operator-search', state, createdAt: '2026-11-12T00:00:01Z' } : null }); return true;
    }
    return false;
  } });
  await page.goto('/discovered-printers');
  await page.getByLabel('IP address or range').fill('10.20.0.8');
  await page.getByRole('button', { name: 'Search network', exact: true }).click();
  await expect(page.getByText('Waiting for the selected Runner')).toBeVisible();
  state = 'RUNNING';
  await expect(page.getByText('Searching TCP port 9100')).toBeVisible();
  state = 'COMPLETED';
  await expect(page.getByText('Search completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search network', exact: true })).toBeEnabled();
});

test('viewer cannot initiate a network search', async ({ page }) => {
  await installHarness(page, { role: 'VIEWER', api: async (url, route) => {
    if (url.pathname === '/api/v1/discovered-printers') { await route.fulfill({ json: [] }); return true; }
    return false;
  } });
  await page.goto('/discovered-printers');
  await expect(page.getByRole('heading', { name: 'Discovered Printers', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search network', exact: true })).toHaveCount(0);
});

test('shows invalid target errors and recovers from a status fetch failure', async ({ page }) => {
  let failStatus = true;
  await installHarness(page, { locale: 'en', api: async (url, route, method) => {
    if (url.pathname === '/api/runners') { await route.fulfill({ json: [runner] }); return true; }
    if (url.pathname === '/api/v1/discovered-printers') { await route.fulfill({ json: [] }); return true; }
    if (url.pathname.endsWith('/printer-searches/latest')) {
      await route.fulfill(failStatus ? { status: 503, json: { error: 'Unavailable' } } : { json: null }); return true;
    }
    if (url.pathname.endsWith('/printer-searches') && method === 'POST') {
      await route.fulfill({ status: 400, json: { code: 'VALIDATION_ERROR', error: 'Search must contain at most 256 IPv4 addresses' } }); return true;
    }
    return false;
  } });
  await page.goto('/discovered-printers');
  await expect(page.getByText('Search status could not be refreshed. Retry to check whether the search is still running.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search network', exact: true })).toBeDisabled();
  failStatus = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Search network', exact: true })).toBeEnabled();
  await page.getByLabel('IP address or range').fill('0.0.0.0/0');
  await page.getByRole('button', { name: 'Search network', exact: true }).click();
  await expect(page.getByText('Search must contain at most 256 IPv4 addresses', { exact: true })).toBeVisible();
  await expect(page.getByLabel('IP address or range')).toHaveAttribute('aria-invalid', 'true');
});

test('renders the search form and results in Thai', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installHarness(page, { locale: 'th', api: async (url, route) => {
    if (url.pathname === '/api/runners') { await route.fulfill({ json: [runner] }); return true; }
    if (url.pathname === '/api/v1/discovered-printers') { await route.fulfill({ json: [] }); return true; }
    if (url.pathname.endsWith('/printer-searches/latest')) { await route.fulfill({ json: { ...search, state: 'COMPLETED' } }); return true; }
    return false;
  } });
  await page.goto('/discovered-printers');
  await expect(page.getByRole('heading', { name: 'ค้นหาเครื่องพิมพ์ในเครือข่าย' })).toBeVisible();
  await expect(page.getByLabel('IP หรือช่วง IP')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ค้นหาเครือข่าย', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/browser/network-printer-search-th-desktop.png', fullPage: true });
});

for (const state of ['COMPLETED', 'FAILED', 'EXPIRED']) {
  test(`restores ${state} search state and fits a mobile screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installHarness(page, { locale: 'en', api: async (url, route) => {
      if (url.pathname === '/api/runners') { await route.fulfill({ json: [runner] }); return true; }
      if (url.pathname.endsWith('/printer-searches/latest')) { await route.fulfill({ json: { ...search, state } }); return true; }
      if (url.pathname === '/api/v1/discovered-printers') { await route.fulfill({ json: [] }); return true; }
      return false;
    } });
    await page.goto('/discovered-printers');
    const message = state === 'COMPLETED' ? 'No reachable TCP port 9100 was found. Check the target range, VPN routes, and printer firewall.'
      : state === 'FAILED' ? 'Search stopped before all addresses were checked. Any candidates found are listed below.'
      : 'The Runner did not finish within the time limit. Check its connection and try again.';
    await expect(page.getByText(message)).toBeVisible();
    expect(await hasHorizontalPageScroll(page)).toBe(false);
    if (state === 'COMPLETED') await page.screenshot({ path: 'artifacts/browser/network-printer-search-mobile.png', fullPage: true });
  });
}
