import { expect, test } from '@playwright/test';
import { hasHorizontalPageScroll, installHarness } from './support.js';

for (const locale of ['en', 'th'] as const) {
  for (const width of [1440, 1024, 390]) {
    test(`register a CUPS queue from Printers (${locale}, ${width})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let registered = false;
      let server = 'old-cups:631';
      await installHarness(page, { locale, api: async (url, route, method) => {
        const printer = { id: 'epson', name: 'epsonL6580', code: 'CUPS_epsonL6580', protocol: 'cups', isActive: true };
        if (url.pathname === '/api/v1/print-flow/runtime-architecture') {
          await route.fulfill({ json: { runtimeMode: 'linux-server' } });
        } else if (url.pathname === '/api/printers') {
          await route.fulfill({ json: registered ? [printer] : [] });
        } else if (url.pathname === '/api/printers/cups-server') {
          if (method === 'PUT') server = route.request().postDataJSON().server;
          await route.fulfill({ json: { server } });
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
      await expect(guide.getByText(/Share This Printer/)).toBeVisible();
      expect(await hasHorizontalPageScroll(page)).toBe(false);
      await guide.getByRole('button', { name: locale === 'th' ? 'กลับไปตั้งค่า CUPS' : 'Back to CUPS setup' }).click();
      await expect(guide).toBeHidden();
      await expect(serverField).toHaveValue('cups:631');
      await dialog.getByRole('button', { name: locale === 'th' ? 'เชื่อมต่อและบันทึก' : 'Connect and save' }).click();
      await dialog.getByRole('combobox').selectOption('epsonL6580');
      expect(await hasHorizontalPageScroll(page)).toBe(false);
      await dialog.getByRole('button', { name: locale === 'th' ? 'ลงทะเบียน' : 'Register' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('row').filter({ hasText: 'CUPS_epsonL6580' })).toBeVisible();
    });
  }
}
