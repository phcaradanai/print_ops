import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import type { PaperProfile, PrintTemplate } from '@printerops/domain';
import { fitFontSizePt, PRINT_FONT_NAME, printTextWidthMm } from '@printerops/shared';
import { buildApp } from '../app.js';
import { SimpleTemplateRenderer } from '../infra/template/simple-template-renderer.js';

/**
 * Renders the real print HTML (companion template + renderer, exactly what
 * reaches WebView2) in headless Chromium and measures every field in mm. The
 * editor canvas is checked against the same model and the same shared width
 * function in apps/web/e2e, so together they pin canvas == print.
 */

const PX_PER_MM = 96 / 25.4;
// The evaluate() callbacks run inside Chromium; the API tsconfig has no DOM types.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare const getComputedStyle: any;
type HTMLElement = any;
const browser: Browser | null = await chromium.launch().catch(() => null);
afterAll(async () => browser?.close());

const FIELDS = [
  { id: 'l', key: 'left_text', type: 'text', xMm: 3, yMm: 2, fontSize: 10, bold: false, align: 'left' },
  { id: 'c', key: 'center_text', type: 'text', xMm: 28, yMm: 8, fontSize: 12, bold: true, align: 'center' },
  { id: 'r', key: 'right_text', type: 'text', xMm: 50, yMm: 14, fontSize: 9, bold: false, align: 'right' },
  { id: 's', key: 'shrink_text', type: 'text', xMm: 3, yMm: 20, fontSize: 12, bold: false, align: 'left', displayWidthMm: 25, shrinkToFit: true },
].map((f) => ({ label: f.key, defaultValue: '', color: '#000000', ...f }));

const PAYLOAD = {
  left_text: 'HN 0012345',
  center_text: 'นายทดสอบ ระบบ',
  right_text: 'Ward 7A',
  shrink_text: 'นางสาวชื่อยาว นามสกุลยาวมาก',
};

describe.skipIf(!browser)('print HTML fidelity in Chromium', () => {
  it('prints every field at the modelled position and width, in the embedded font', async () => {
    const { app } = await buildApp();
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@printerops.local', password: 'Dev-password1!' } });
    const auth = { authorization: `Bearer ${(login.json() as { token: string }).token}` };
    const created = await app.inject({
      method: 'POST', url: '/api/v1/paper-profiles', headers: auth,
      payload: {
        code: 'FIDELITY_60X30', name: 'Fidelity 60x30', widthMm: 60, heightMm: 30,
        marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2,
        dpi: 203, orientation: 'landscape', unit: 'mm', fields: FIELDS,
      },
    });
    expect(created.statusCode).toBe(201);
    const profile = created.json() as PaperProfile;
    const templates = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: auth });
    const template = (templates.json() as PrintTemplate[]).find((t) => t.paperProfileId === profile.id)!;

    const { renderedPrintPayload: html } = await new SimpleTemplateRenderer().renderPrintPayload(template, PAYLOAD, profile);
    expect(html).toContain('@font-face');

    const page = await browser!.newPage();
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate((name) => document.fonts.check(`10pt "${name}"`, 'กA'), PRINT_FONT_NAME)).toBe(true);

    const boxes = await page.evaluate(() => {
      const spans: HTMLElement[] = Array.from(document.querySelectorAll('span[style*="position:absolute"]'));
      const origin = spans[0]!.offsetParent!.getBoundingClientRect();
      return spans.map((span: HTMLElement) => {
        const r = span.getBoundingClientRect();
        return { text: span.textContent ?? '', left: r.left - origin.left, top: r.top - origin.top, width: r.width, fontSize: getComputedStyle(span).fontSize };
      });
    });
    await page.close();

    for (const field of FIELDS) {
      const value = PAYLOAD[field.key as keyof typeof PAYLOAD];
      const box = boxes.find((b) => b.text === value)!;
      expect(box, field.key).toBeDefined();
      const sizePt = field.shrinkToFit ? fitFontSizePt(value, field.fontSize, field.bold, field.displayWidthMm!) : field.fontSize;
      const modelWidthMm = field.displayWidthMm ?? printTextWidthMm(value, sizePt, field.bold);
      const leftMm = box.left / PX_PER_MM;
      const widthMm = box.width / PX_PER_MM;
      const anchorMm = field.align === 'center' ? leftMm + widthMm / 2 : field.align === 'right' ? leftMm + widthMm : leftMm;
      // Anchor within 0.1 mm of margin + field position (landscape: no axis swap).
      expect(Math.abs(anchorMm - (2 + field.xMm)), `${field.key} anchor`).toBeLessThan(0.1);
      expect(Math.abs(box.top / PX_PER_MM - (2 + field.yMm)), `${field.key} top`).toBeLessThan(0.1);
      // The real glyphs match the shared width table the canvas uses: within 1.5%.
      if (!field.displayWidthMm) expect(Math.abs(widthMm - modelWidthMm) / modelWidthMm, `${field.key} width`).toBeLessThan(0.015);
      if (field.shrinkToFit) {
        expect(parseFloat(box.fontSize) * 0.75, 'shrunk size in pt').toBeCloseTo(sizePt, 1);
        expect(sizePt).toBeLessThan(field.fontSize);
        // The shrunk text itself fits the box.
        expect(printTextWidthMm(value, sizePt, field.bold)).toBeLessThanOrEqual(field.displayWidthMm!);
      }
    }
  }, 60_000);
});
