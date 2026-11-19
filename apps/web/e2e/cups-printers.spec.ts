import { expect, test } from '@playwright/test';
import { hasHorizontalPageScroll, installHarness } from './support.js';

const printer = {
  id: 'epson',
  name: 'epsonL6580',
  code: 'CUPS_epsonL6580',
  protocol: 'cups',
  isActive: true,
};

for (const locale of ['en', 'th'] as const) {
  for (const width of [1440, 1024, 390]) {
    test(`register a CUPS queue from Printers (${locale}, ${width})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let registered = false;
      let server = 'old-cups:631';
      await installHarness(page, { locale, api: async (url, route, method) => {
        if (url.pathname === '/api/v1/print-flow/runtime-architecture') {
          await route.fulfill({ json: { runtimeMode: 'linux-server' } });
        } else if (url.pathname === '/api/printers') {
          await route.fulfill({ json: registered ? [printer] : [] });
        } else if (url.pathname === '/api/printers/cups-server') {
          if (method === 'PUT') server = route.request().postDataJSON().server;
          await route.fulfill({ json: { server } });
        } else if (url.pathname === '/api/printers/cups-admin') {
          await route.fulfill({ json: { configured: true, user: 'print', source: 'file' } });
        } else if (url.pathname === '/api/printers/cups-queues') {
          await route.fulfill({ json: server === 'cups:631' ? [{ name: printer.name, registered }] : [] });
        } else if (url.pathname === '/api/printers/cups-queues/epsonL6580' && method === 'POST') {
          registered = true;
          await route.fulfill({ status: 201, json: printer });
        } else return false;
        return true;
      } });

      await page.goto('/printers');
      const add = locale === 'th' ? 'เพิ่มเครื่องพิมพ์ CUPS' : 'Add CUPS printer';
      await page.getByRole('button', { name: add }).click();
      const dialog = page.getByRole('dialog', { name: add });
      const serverField = dialog.getByRole('textbox', { name: locale === 'th' ? 'เซิร์ฟเวอร์ CUPS' : 'CUPS server' });
      await expect(serverField).toHaveValue('old-cups:631');
      await serverField.fill('cups:631');
      const guideName = locale === 'th' ? 'วิธีตั้งค่า CUPS' : 'CUPS setup guide';
      await dialog.getByRole('button', { name: guideName }).click();
      const guide = page.getByRole('dialog', { name: guideName });
      await expect(guide.getByRole('listitem')).toHaveCount(4);
      await expect(guide.getByText(/IPP Everywhere/)).toBeVisible();
      expect(await hasHorizontalPageScroll(page)).toBe(false);
      await guide.getByRole('button', { name: locale === 'th' ? 'กลับไปตั้งค่า CUPS' : 'Back to CUPS setup' }).click();
      await expect(guide).toBeHidden();
      await expect(serverField).toHaveValue('cups:631');
      await dialog.getByRole('button', { name: locale === 'th' ? 'เชื่อมต่อและบันทึก' : 'Connect and save' }).click();
      await dialog.getByRole('combobox').selectOption('epsonL6580');
      expect(await hasHorizontalPageScroll(page)).toBe(false);
      await dialog.getByRole('button', { name: locale === 'th' ? 'ลงทะเบียนคิว' : 'Register queue' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('row').filter({ hasText: 'CUPS_epsonL6580' })).toBeVisible();
    });
  }
}

test('find a network printer and let PrintOps create the CUPS queue (en, 1440)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const createRequests: Array<Record<string, unknown>> = [];
  const adminRequests: Array<Record<string, unknown>> = [];
  let created = false;
  await installHarness(page, { locale: 'en', api: async (url, route, method) => {
    if (url.pathname === '/api/v1/print-flow/runtime-architecture') {
      await route.fulfill({ json: { runtimeMode: 'linux-server' } });
    } else if (url.pathname === '/api/printers') {
      await route.fulfill({ json: created ? [printer] : [] });
    } else if (url.pathname === '/api/printers/cups-server') {
      await route.fulfill({ json: { server: 'cups:631' } });
    } else if (url.pathname === '/api/printers/cups-admin') {
      if (method === 'PUT') adminRequests.push(route.request().postDataJSON());
      await route.fulfill({
        json: method === 'PUT'
          ? { configured: true, user: 'print', source: 'file' }
          : { configured: false, source: 'none' },
      });
    } else if (url.pathname === '/api/printers/cups-queues') {
      if (method === 'POST') {
        createRequests.push(route.request().postDataJSON());
        created = true;
        await route.fulfill({
          status: 201,
          json: {
            queue: 'PRINT_192_168_10_11',
            deviceUri: 'ipps://192.168.10.11:631/ipp/print',
            created: true,
            registered: true,
            printer,
            device: { host: '192.168.10.11', uri: 'ipps://192.168.10.11:631/ipp/print', secure: true, formats: [], driverless: true },
            readiness: { ready: false, reasons: ['cups-missing-filter-warning'], code: 'MISSING_FILTER' },
          },
        });
        return true;
      }
      await route.fulfill({ json: [] });
    } else if (url.pathname === '/api/printers/cups-scan') {
      await route.fulfill({
        json: {
          devices: [
            {
              host: '192.168.10.11',
              uri: 'ipps://192.168.10.11:631/ipp/print',
              secure: true,
              makeModel: 'EPSON L6580 Series',
              formats: ['image/urf', 'image/pwg-raster'],
              driverless: true,
            },
          ],
          failures: [{ host: '192.168.10.12', error: 'connection refused' }],
        },
      });
    } else return false;
    return true;
  } });

  await page.goto('/printers');
  await page.getByRole('button', { name: 'Add CUPS printer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add CUPS printer' });

  // Discovery: the printer is found before CUPS knows about it.
  await dialog.getByRole('textbox', { name: 'Printer address, range or CIDR' }).fill('192.168.10.11');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await expect(dialog.getByText('EPSON L6580 Series')).toBeVisible();
  await expect(dialog.getByText('IPP Everywhere', { exact: true })).toBeVisible();
  const queueField = dialog.getByRole('textbox', { name: 'Queue name' });
  await expect(queueField).toHaveValue('PRINT_192_168_10_11');

  // One click: PrintOps creates the CUPS queue and registers the printer.
  await dialog.getByRole('button', { name: 'Create queue' }).click();
  await expect.poll(() => createRequests.length).toBe(1);
  expect(createRequests[0]).toMatchObject({ host: '192.168.10.11', queue: 'PRINT_192_168_10_11' });
  await expect(dialog.getByText(/Created queue “PRINT_192_168_10_11”/)).toBeVisible();
  await expect(dialog.getByText(/missing the filter/)).toBeVisible();
  expect(await hasHorizontalPageScroll(page)).toBe(false);

  // CUPS administrator account is stored once, on the station.
  await dialog.getByRole('textbox', { name: 'User name' }).fill('print');
  await dialog.getByRole('textbox', { name: 'Password' }).fill('print');
  await dialog.getByRole('button', { name: 'Save account' }).click();
  await expect.poll(() => adminRequests.length).toBe(1);
  expect(adminRequests[0]).toMatchObject({ user: 'print', password: 'print' });
  await expect(dialog.getByText('CUPS administrator account saved.')).toBeVisible();
});
