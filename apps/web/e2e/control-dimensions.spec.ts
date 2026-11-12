import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installHarness } from './support.js';

/**
 * Control-dimension contract (DESIGN.md): equivalent controls share one height.
 * Inline controls (buttons, text inputs, selects) sitting in the same flex row
 * must render at the same outer height, otherwise a toolbar looks ragged.
 */
const ROUTES = [
  '/', '/printers', '/printers/p1', '/jobs', '/jobs/j1', '/runners',
  '/templates', '/paper-profiles', '/discovered-printers', '/diagnostics',
  '/template-sandbox', '/webhooks', '/route-policies', '/printer-bindings',
  '/print-flow', '/audit-logs', '/users', '/export', '/settings', '/account/security',
] as const;

const printer = {
  id: 'p1', code: 'AUDIT_PRINTER', name: 'Audit Printer', protocol: 'IPP',
  connectionUri: 'ipp://127.0.0.1/printer', status: { code: 'ONLINE', text: 'Ready' },
};
const job = {
  id: 'j1', requestId: 'audit-request', printerId: 'p1', printerCode: printer.code,
  status: 'SUCCESS', copies: 1, templateCode: 'AUDIT_TEMPLATE', mimeType: 'text/html',
  receivedAt: '2026-07-31T07:00:00.000Z', finishedAt: '2026-07-31T07:00:01.000Z',
};

const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

test.describe('control dimension consistency', () => {
  for (const viewport of SIZES) {
    for (const path of ROUTES) {
      test(`${viewport.width} ${path}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await installHarness(page, {
          role: 'OWNER',
          api: async (url, route, method) => {
            if (method !== 'GET') return false;
            const p = url.pathname.replace(/^\/api/, '');
            if (p === '/printers/p1') { await route.fulfill({ json: printer }); return true; }
            if (p === '/jobs/j1') { await route.fulfill({ json: job }); return true; }
            if (p === '/printers') { await route.fulfill({ json: [printer] }); return true; }
            if (p === '/jobs') { await route.fulfill({ json: [job] }); return true; }
            if (p.endsWith('/v1/system/readiness')) {
              await route.fulfill({ json: { status: 'READY', checkedAt: job.receivedAt, components: {} } });
              return true;
            }
            await route.fulfill({ json: [] });
            return true;
          },
        });
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        await page.waitForTimeout(300);

        const report = await page.evaluate(() => {
          const SELECTOR = 'button, a[class*="btn"], a[class*="button"], select, input, [role="combobox"]';
          const skipTypes = new Set(['checkbox', 'radio', 'file', 'hidden', 'color', 'range']);
          const inline = [...document.querySelectorAll<HTMLElement>(`main ${SELECTOR.split(', ').join(', main ')}`)]
            .filter((el) => {
              if (el instanceof HTMLInputElement && skipTypes.has(el.type)) return false;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return false;
              const s = getComputedStyle(el);
              if (s.visibility === 'hidden' || s.position === 'absolute') return false;
              // Text-like links, tabs and segmented items are not standard controls.
              if (el.closest('table, [role="tablist"], [role="menu"], nav, [role="radiogroup"], label')) {
                if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return false;
              }
              return true;
            });
          const describe = (el: HTMLElement) => {
            const s = getComputedStyle(el);
            return {
              tag: el.tagName.toLowerCase(),
              cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 80),
              text: (el.textContent || (el as HTMLInputElement).placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 30),
              h: Math.round(el.getBoundingClientRect().height * 10) / 10,
              radius: s.borderTopLeftRadius,
              border: s.borderTopWidth,
              font: s.fontSize,
              multi: el instanceof HTMLSelectElement && (el.multiple || el.size > 1),
            };
          };
          // Group by parent that lays children out in a row.
          const rows = new Map<Element, HTMLElement[]>();
          for (const el of inline) {
            const parent = el.parentElement;
            if (!parent) continue;
            const ps = getComputedStyle(parent);
            const isRow = ps.display.includes('flex') && !ps.flexDirection.startsWith('column');
            if (!isRow) continue;
            const list = rows.get(parent) ?? [];
            list.push(el);
            rows.set(parent, list);
          }
          const ragged: { parent: string; items: ReturnType<typeof describe>[] }[] = [];
          for (const [parent, items] of rows) {
            if (items.length < 2) continue;
            const tops = items.map((i) => Math.round(i.getBoundingClientRect().top));
            // Only compare items that actually share a line.
            const byLine = new Map<number, HTMLElement[]>();
            items.forEach((item, idx) => {
              const key = [...byLine.keys()].find((k) => Math.abs(k - tops[idx]!) < 12) ?? tops[idx]!;
              byLine.set(key, [...(byLine.get(key) ?? []), item]);
            });
            for (const line of byLine.values()) {
              const hs = line.map((i) => i.getBoundingClientRect().height);
              if (line.length > 1 && Math.max(...hs) - Math.min(...hs) > 1) {
                ragged.push({ parent: `${parent.tagName.toLowerCase()}.${String((parent as HTMLElement).className).slice(0, 60)}`, items: line.map(describe) });
              }
            }
          }
          return { all: inline.map(describe), ragged };
        });

        mkdirSync('artifacts/browser/dimensions', { recursive: true });
        const name = `${viewport.width}${path.replace(/\//g, '_') || '_root'}`;
        writeFileSync(`artifacts/browser/dimensions/${name}.json`, JSON.stringify(report, null, 2));
        await page.screenshot({ path: `artifacts/browser/dimensions/${name}.png`, fullPage: true });
        expect(report.ragged, `${path} has controls of mixed height in one row`).toEqual([]);
        const fields = report.all.filter((c) => c.tag === 'input' || c.tag === 'select');
        if (viewport.width < 768) {
          // iOS zooms the page when a focused field is under 16px.
          expect(fields.filter((c) => parseFloat(c.font) < 16), `${path} fields below 16px on mobile`).toEqual([]);
          expect(fields.filter((c) => !c.multi && (c.h < 44 || c.h > 48)), `${path} single-line fields off the 44px touch height`).toEqual([]);
        } else {
          // Single-line fields sit on the compact/standard tokens (multi-row listboxes excepted).
          expect(fields.filter((c) => !c.multi && ![34, 38].includes(Math.round(c.h)) && c.border !== '0px'),
            `${path} fields off the control-height tokens`).toEqual([]);
        }
      });
    }
  }
});

test('code editor text stays in register with its line-number gutter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installHarness(page, { role: 'OWNER', api: async (_url, route) => { await route.fulfill({ json: [] }); return true; } });
  await page.goto('/route-policies');
  await expect(page.locator('.ui-editor-canvas__field')).toBeVisible();
  const metrics = await page.evaluate(() => {
    const field = getComputedStyle(document.querySelector('.ui-editor-canvas__field')!);
    const gutter = getComputedStyle(document.querySelector('.ui-editor-canvas__gutter')!);
    return { field: [field.fontSize, field.lineHeight], gutter: [gutter.fontSize, gutter.lineHeight] };
  });
  // A page-wide textarea rule once out-ranked the editor and shifted every line against its number.
  expect(metrics.field).toEqual(metrics.gutter);
});
