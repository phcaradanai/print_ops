import { expect, test } from '@playwright/test';
import type { PaperProfile, PrintTemplate } from '@printerops/domain';
import { PRINT_FONT_FAMILY, PRINT_FONT_NAME } from '@printerops/shared';
import { SimpleTemplateRenderer } from '../../api/src/infra/template/simple-template-renderer.js';
import { installHarness } from './support.js';

const now = new Date(0);
const paper: PaperProfile = {
  id: 'preview-paper', code: 'PROOF', name: 'Proof', widthMm: 80, heightMm: 80,
  marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
  dpi: 203, orientation: 'portrait', unit: 'mm', fields: [], createdAt: now, updatedAt: now,
};
const template: PrintTemplate = {
  id: 'preview-template', templateCode: 'PROOF_auto', name: 'Proof (auto)', engine: 'HTML',
  paperProfileId: paper.id, version: 1, status: 'DRAFT', createdBy: 'test', updatedBy: 'test',
  createdAt: now, updatedAt: now,
  content: `<div style='position:relative;width:80mm;height:80mm;font-family:${PRINT_FONT_FAMILY};line-height:1.2'>`
    + '<span style="position:absolute;left:5mm;top:5mm;font-size:10pt">{{label}}</span>'
    + '<span style="position:absolute;left:55mm;top:35mm">{{qrcode:code}}</span></div>',
};

for (const locale of ['en', 'th'] as const) {
  for (const width of [1440, 1024, 390]) {
    test(`sandbox retains printed font and QR ${locale} ${width}`, async ({ page }) => {
      const preview = await new SimpleTemplateRenderer().renderPreview(template, { label: 'ทดสอบยา HAPYmed', code: 'PROOF-123' }, paper);
      await page.setViewportSize({ width, height: 1000 });
      await installHarness(page, { locale, api: (url, route) => {
        const path = url.pathname.replace(/^\/api/, '');
        const data = path === '/v1/sandbox/templates' ? [template]
          : path === '/v1/paper-profiles' ? [paper]
          : path === '/printers' ? []
          : path === '/v1/sandbox/render-preview' ? preview : undefined;
        if (data === undefined) return false;
        void route.fulfill({ json: data });
        return true;
      } });
      await page.goto('/template-sandbox');
      await page.getByRole('combobox', { name: locale === 'en' ? 'Paper Profile (primary)' : 'โปรไฟล์กระดาษ (มีลำดับความสำคัญ)', exact: true }).selectOption(paper.id);
      await page.getByRole('button', { name: locale === 'en' ? 'Render Preview' : 'แสดงตัวอย่าง', exact: true }).click();
      const proof = page.locator('.sandbox-paper-sheet');
      await expect(proof.getByText('ทดสอบยา HAPYmed', { exact: true })).toBeVisible();
      const geometry = await proof.evaluate((sheet) => {
        const box = sheet.getBoundingClientRect();
        const label = sheet.querySelector('span')!.getBoundingClientRect();
        return { width: box.width, height: box.height, x: label.left - box.left, y: label.top - box.top };
      });
      expect(geometry.width).toBeCloseTo(80 * 96 / 25.4, 1);
      expect(geometry.height).toBeCloseTo(80 * 96 / 25.4, 1);
      expect(geometry.x).toBeCloseTo(5 * 96 / 25.4, 1);
      expect(geometry.y).toBeCloseTo(5 * 96 / 25.4, 1);
      await expect.poll(() => proof.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate((font) => document.fonts.check(`10pt "${font}"`, 'กA'), PRINT_FONT_NAME)).toBe(true);
      const previewWidth = await proof.getByText('ทดสอบยา HAPYmed', { exact: true }).evaluate((el) => el.getBoundingClientRect().width);
      const printPage = await page.context().newPage();
      await printPage.setContent(preview.renderedPrintPayload);
      await printPage.evaluate(() => document.fonts.ready);
      const printWidth = await printPage.getByText('ทดสอบยา HAPYmed', { exact: true }).evaluate((el) => el.getBoundingClientRect().width);
      expect(previewWidth).toBeCloseTo(printWidth, 1);
      await printPage.close();
      await page.screenshot({ path: `artifacts/browser/sandbox-font-qr-${locale}-${width}.png`, fullPage: true });
    });
  }
}
