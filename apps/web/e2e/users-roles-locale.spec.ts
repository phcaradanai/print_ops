import { expect, test } from '@playwright/test';
import { installHarness } from './support.js';

const pages = [
  ['/', 'Dashboard', 'แดชบอร์ด'],
  ['/printers', 'Printers', 'เครื่องพิมพ์'],
  ['/jobs', 'Job Queue', 'คิวงาน'],
  ['/runners', 'Runners', 'ตัวรับงาน'],
  ['/templates', 'Templates', 'เทมเพลต'],
  ['/paper-profiles', 'Paper Profiles', 'โปรไฟล์กระดาษ'],
  ['/discovered-printers', 'Discovery', 'ค้นหาเครื่องพิมพ์'],
  ['/diagnostics', 'Diagnostics', 'การวินิจฉัย'],
  ['/template-sandbox', 'Sandbox', 'แซนด์บ็อกซ์'],
  ['/webhooks', 'Webhooks', 'เว็บฮุก'],
  ['/route-policies', 'Route Policies', 'นโยบายเส้นทาง'],
  ['/printer-bindings', 'Bindings', 'การผูก'],
  ['/print-flow', 'Print Flow', 'โฟลว์การพิมพ์'],
  ['/audit-logs', 'Audit Logs', 'บันทึกการตรวจสอบ'],
  ['/users', 'Users & Roles', 'ผู้ใช้และบทบาท'],
  ['/export', 'Export', 'ส่งออก'],
  ['/settings', 'Settings', 'การตั้งค่า'],
] as const;

for (const [role, enRole, thRole, width] of [
  ['ADMIN', 'Admin', 'ผู้ดูแล', 1440],
  ['OPERATOR', 'User', 'ผู้ใช้งาน', 1440],
  ['VIEWER', 'Viewer', 'ผู้ชม', 1440],
  ['VIEWER', 'Viewer', 'ผู้ชม', 390],
] as const) {
  test(`page access for ${role} at ${width}px follows locale changes and saves route values`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let allowedPages = ['/', '/printers'];
    let failNextSave = role === 'ADMIN';
    await installHarness(page, {
      locale: 'en',
      role: 'OWNER',
      api: async (url, route, method) => {
        if (url.pathname === '/api/v1/users' && method === 'GET') {
          await route.fulfill({ json: [{
            id: 'target-user', email: 'target@example.invalid', name: 'Target User',
            role, isActive: true, createdAt: '2026-11-11T00:00:00Z',
            allowedPages,
          }] });
          return true;
        }
        if (url.pathname === '/api/v1/users/target-user/access' && method === 'PUT') {
          if (failNextSave) {
            failNextSave = false;
            await route.fulfill({ status: 500, json: { error: 'Access update failed' } });
            return true;
          }
          allowedPages = route.request().postDataJSON().allowedPages;
          await route.fulfill({ json: { ok: true } });
          return true;
        }
        return false;
      },
    });
    await page.goto('/users');
    const row = page.getByRole('row').filter({ hasText: 'target@example.invalid' });
    await row.getByRole('button', { name: 'Page access', exact: true }).click();
    const access = page.getByRole('dialog', { name: 'Page access', exact: true });
    await expect(access.getByText('target@example.invalid', { exact: true })).toBeVisible();
    for (const [, english] of pages) {
      await expect(access.getByRole('checkbox', { name: english, exact: true })).toBeVisible();
    }
    await expect(access.getByText(enRole, { exact: true })).toBeVisible();

    await access.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator(width < 1024 ? '.app-header' : '.app-topbar').getByRole('button', { name: 'TH', exact: true }).click();
    await row.getByRole('button', { name: 'การเข้าถึงหน้า', exact: true }).click();
    const thaiAccess = page.getByRole('dialog', { name: 'การเข้าถึงหน้า', exact: true });
    await expect(thaiAccess.getByText('เลือกแล้ว 2 จาก 17 หน้า', { exact: true })).toBeVisible();
    await expect(thaiAccess.getByRole('group')).toHaveCount(4);
    await page.screenshot({ path: `/tmp/printops-access-after-${role}-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await thaiAccess.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const [, , thai] of pages) {
      await expect(thaiAccess.getByRole('checkbox', { name: thai, exact: true })).toBeVisible();
    }
    await expect(thaiAccess.getByText(thRole, { exact: true })).toBeVisible();
    await expect(thaiAccess.getByRole('checkbox', { name: 'เครื่องพิมพ์', exact: true })).toBeChecked();
    await thaiAccess.getByRole('checkbox', { name: 'เครื่องพิมพ์', exact: true }).uncheck();
    await thaiAccess.getByRole('checkbox', { name: 'คิวงาน', exact: true }).check();

    if (role === 'ADMIN') {
      await thaiAccess.getByRole('button', { name: 'บันทึก', exact: true }).click();
      await expect(thaiAccess.getByRole('alert')).toContainText('Access update failed');
      await expect(thaiAccess.getByRole('checkbox', { name: 'คิวงาน', exact: true })).toBeChecked();
    }
    const saved = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/v1/users/target-user/access'));
    await thaiAccess.getByRole('button', { name: 'บันทึก', exact: true }).click();
    expect((await saved).postDataJSON()).toEqual({ allowedPages: ['/', '/jobs'] });
    await expect(thaiAccess).not.toBeVisible();

    await page.locator(width < 1024 ? '.app-header' : '.app-topbar').getByRole('button', { name: 'EN', exact: true }).click();
    await row.getByRole('button', { name: 'Page access', exact: true }).click();
    await expect(access.getByRole('checkbox', { name: 'Printers', exact: true })).not.toBeChecked();
    await expect(access.getByRole('checkbox', { name: 'Job Queue', exact: true })).toBeChecked();
    await access.getByRole('button', { name: 'Select all', exact: true }).click();
    await expect(access.getByRole('checkbox', { checked: true })).toHaveCount(17);
    await access.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await expect(access.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(access).not.toBeVisible();
    await row.getByRole('button', { name: 'Page access', exact: true }).click();
    await expect(access.getByRole('checkbox', { checked: true })).toHaveCount(2);
    await expect(access.getByRole('checkbox', { name: 'Job Queue', exact: true })).toBeChecked();
  });
}
