/**
 * FE-02A Paper Profile runtime UX suite.
 *
 * Written first as a *reproduction* harness: every check below measures something
 * an operator can see (a scrollbar that should not exist, a menu clipped by its
 * panel, a control that moves when hovered) rather than asserting a snapshot. A
 * failure here is a defect row in `docs/frontend/paper-profile-ux-audit.md`.
 *
 * Runs against the production bundle, so it exercises the same asset the Desktop
 * shell serves. It is Chromium, NOT WebView2 — see the audit doc for what that
 * does and does not prove.
 */
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP_VIEWPORTS, hasHorizontalPageScroll, installHarness, overflowReport } from './support.js';

const LONG_EN = 'Extremely long English field label that a hospital operator might realistically paste in';
const LONG_TH = 'ป้ายกำกับภาษาไทยที่ยาวมากซึ่งผู้ปฏิบัติงานในโรงพยาบาลอาจวางลงไปในช่องนี้จริง ๆ โดยไม่ได้ตั้งใจ';

type MockField = {
  id: string;
  key: string;
  label: string;
  defaultValue: string;
  type: 'text' | 'barcode' | 'qrcode' | 'date' | 'number';
  barcodeSymbology?: string;
  barcodeHeightMm?: number;
  qrSizeMm?: number;
  xMm: number;
  yMm: number;
  fontSize: number;
  bold: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
};

function field(index: number, overrides: Partial<MockField> = {}): MockField {
  return {
    id: `f-${index}`,
    key: `field_${index}`,
    label: `Field ${index}`,
    defaultValue: `Value ${index}`,
    type: 'text',
    xMm: 2 + (index % 4) * 8,
    yMm: 2 + Math.floor(index / 4) * 6,
    fontSize: 10,
    bold: false,
    color: '#000000',
    align: 'left',
    ...overrides,
  };
}

/** 10 mixed fields, including the long labels the brief calls out. */
const MIXED_FIELDS: MockField[] = [
  field(1, { label: LONG_EN, defaultValue: 'A very long default sample value for truncation checks' }),
  field(2, { label: LONG_TH, defaultValue: 'ค่าตัวอย่างภาษาไทยที่ยาวมากสำหรับตรวจสอบการตัดข้อความ' }),
  field(3, { type: 'barcode', barcodeSymbology: 'code128', barcodeHeightMm: 12, defaultValue: '1234567890' }),
  field(4, { type: 'barcode', barcodeSymbology: 'ean13', barcodeHeightMm: 14, defaultValue: '4006381333931' }),
  field(5, { type: 'qrcode', qrSizeMm: 20, defaultValue: 'https://example.invalid/very/long/qr/payload' }),
  field(6, { type: 'date', defaultValue: '2026-07-30' }),
  field(7, { type: 'number', defaultValue: '123456.78' }),
  field(8, { align: 'center', bold: true, fontSize: 24 }),
  field(9, { align: 'right', color: '#d20f39' }),
  field(10, { label: 'ชื่อผู้ป่วย', defaultValue: 'นายทดสอบ ระบบพิมพ์' }),
];

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pp-mixed-0001',
    code: 'label_100x50_mixed_long_code_value',
    name: 'Mixed field label 100 × 50 with a deliberately long profile name',
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 2,
    marginBottomMm: 2,
    marginLeftMm: 2,
    dpi: 203,
    orientation: 'portrait',
    unit: 'mm',
    fields: MIXED_FIELDS,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const PROFILES = [
  profile(),
  profile({ id: 'pp-empty-0002', code: 'label_50x25_empty', name: 'Empty 50 × 25', widthMm: 50, heightMm: 25, fields: [] }),
  profile({ id: 'pp-a4-0003', code: 'a4_portrait', name: 'A4 portrait', widthMm: 210, heightMm: 297, dpi: 300, fields: [field(1)] }),
  profile({ id: 'pp-a4l-0004', code: 'a4_landscape', name: 'A4 landscape', widthMm: 210, heightMm: 297, dpi: 300, orientation: 'landscape', fields: [field(1)] }),
];

interface ApiOverrides {
  /** Fails the profile list with this status instead of returning data. */
  listStatus?: number;
  listBody?: unknown;
  /** Fails the save with this status. */
  saveStatus?: number;
  saveBody?: unknown;
  deleteStatus?: number;
  deleteBody?: unknown;
  /** Called on each list request; return a payload to override. */
  profiles?: unknown[];
}

async function openEditor(page: Page, overrides: ApiOverrides = {}, locale: 'en' | 'th' = 'en') {
  let listCalls = 0;
  await installHarness(page, {
    locale,
    api: (url, route, method) => {
      // Production build maps `/v1/...` to `/api/v1/...`.
      const path = url.pathname.replace(/^\/api/, '');

      if (path === '/v1/paper-profiles' && method === 'GET') {
        listCalls += 1;
        if (overrides.listStatus) {
          route.fulfill({ status: overrides.listStatus, json: overrides.listBody ?? { error: 'INTERNAL', message: 'profile store unavailable' } });
          return true;
        }
        route.fulfill({ json: overrides.profiles ?? PROFILES });
        return true;
      }
      if (path === '/v1/paper-profiles' && method === 'POST') {
        route.fulfill({ status: overrides.saveStatus ?? 201, json: overrides.saveBody ?? profile() });
        return true;
      }
      if (/^\/v1\/paper-profiles\/[^/]+$/.test(path) && method === 'PUT') {
        route.fulfill({ status: overrides.saveStatus ?? 200, json: overrides.saveBody ?? profile() });
        return true;
      }
      if (/^\/v1\/paper-profiles\/[^/]+$/.test(path) && method === 'DELETE') {
        route.fulfill({ status: overrides.deleteStatus ?? 204, json: overrides.deleteBody ?? {} });
        return true;
      }
      if (/artwork$/.test(path)) {
        route.fulfill({ status: 404, json: { error: 'NOT_FOUND', message: 'no artwork' } });
        return true;
      }
      return false;
    },
  });
  await page.goto('/paper-profiles');
  await expect(page.locator('.paper-profiles-page')).toBeVisible();
  return () => listCalls;
}

/** Loads the 10-mixed-field profile into the editor. */
async function editMixedProfile(page: Page) {
  const row = page.locator('table tbody tr', { hasText: 'Mixed field label' }).first();
  await row.locator('button').first().click();
  await expect(page.locator('.pp-field-row').first()).toBeVisible();
}

/** Bounding boxes, with a helper for "is a inside b". */
async function box(page: Page, selector: string) {
  return page.locator(selector).first().boundingBox();
}

function contains(outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }, tolerance = 1) {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

for (const viewport of DESKTOP_VIEWPORTS) {
  const tag = `${viewport.width}x${viewport.height}`;

  test.describe(`paper profile editor ${tag}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport);
    });

    test(`no unintended horizontal page scroll ${tag}`, async ({ page }) => {
      await openEditor(page);
      await editMixedProfile(page);
      await page.screenshot({ path: `artifacts/browser/paper-profile-editor-${tag}.png`, fullPage: false });
      expect(await hasHorizontalPageScroll(page)).toBe(false);
    });

    test(`scroll ownership is explicit ${tag}`, async ({ page }) => {
      await openEditor(page);
      await editMixedProfile(page);

      const formScroll = await overflowReport(page, '.pp-form-scroll');
      const stage = await overflowReport(page, '.pp-preview-stage');
      expect(formScroll, '.pp-form-scroll must exist').not.toBeNull();
      expect(stage, '.pp-preview-stage must exist').not.toBeNull();

      // The form body owns vertical form scrolling and must not scroll sideways.
      expect(formScroll!.scrollsHorizontally).toBe(false);
      // The page itself must not also scroll the same content vertically.
      const bodyScrolls = await page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight > 1,
      );
      expect(bodyScrolls, 'application shell must not double-scroll the editor').toBe(false);
    });

    test(`preset menu is not clipped by the form panel ${tag}`, async ({ page }) => {
      await openEditor(page);
      await editMixedProfile(page);

      await page.getByRole('button', { name: /preset/i }).first().click();
      const menu = page.locator('.pp-presets-menu');
      await expect(menu).toBeVisible();

      const menuBox = await menu.boundingBox();
      const viewportBox = { x: 0, y: 0, width: viewport.width, height: viewport.height };
      expect(menuBox).not.toBeNull();

      await page.screenshot({ path: `artifacts/browser/paper-profile-presets-${tag}.png` });

      expect(contains(viewportBox, menuBox!), 'preset menu leaves the viewport').toBe(true);

      // "Not clipped" is a question about what is actually painted, not about
      // which box the menu sits inside: the menu is deliberately wider than the
      // panel, and the fix was to stop the panel clipping rather than to shrink
      // the menu. So hit-test the menu's own corners — if an overflow ancestor
      // still cut it, the element at that point is not the menu.
      const cut = await page.evaluate(() => {
        const menuEl = document.querySelector('.pp-presets-menu');
        if (!menuEl) return ['menu missing'];
        const r = menuEl.getBoundingClientRect();
        const probes: [string, number, number][] = [
          ['top-left', r.left + 3, r.top + 3],
          ['top-right', r.right - 3, r.top + 3],
          ['bottom-left', r.left + 3, r.bottom - 3],
          ['bottom-right', r.right - 3, r.bottom - 3],
          ['centre', r.left + r.width / 2, r.top + r.height / 2],
        ];
        return probes
          .filter(([, x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return !(hit && (hit === menuEl || menuEl.contains(hit)));
          })
          .map(([name, x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return `${name} covered by ${hit ? `${hit.tagName}.${hit.className}` : 'nothing'}`;
          });
      });
      expect(cut, cut.join('\n')).toEqual([]);
    });

    test(`hovering a toolbar action does not move the layout ${tag}`, async ({ page }) => {
      await openEditor(page);
      await editMixedProfile(page);

      const buttons = page.locator('.pp-toolbar .pp-icon-btn');
      const target = buttons.first();
      const neighbour = buttons.nth(1);

      // Measured relative to the toolbar, not the viewport: `hover()` scrolls the
      // target into view first, and a scrolled page would otherwise register as a
      // layout shift that no user ever sees.
      const offset = async () =>
        page.evaluate(() => {
          const toolbar = document.querySelector('.pp-toolbar');
          const second = document.querySelectorAll('.pp-toolbar .pp-icon-btn')[1];
          if (!toolbar || !second) return null;
          const t = toolbar.getBoundingClientRect();
          const s = second.getBoundingClientRect();
          return { dx: s.left - t.left, dy: s.top - t.top, width: s.width, height: s.height };
        });

      const before = await offset();
      await target.hover();
      // Allow any transition to settle.
      await page.waitForTimeout(250);
      const after = await offset();

      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      expect(Math.abs(after!.dx - before!.dx), 'hover shifted the next control horizontally').toBeLessThanOrEqual(1);
      expect(Math.abs(after!.dy - before!.dy), 'hover shifted the next control vertically').toBeLessThanOrEqual(1);
      expect(Math.abs(after!.width - before!.width), 'hover resized the next control').toBeLessThanOrEqual(1);
      expect(Math.abs(after!.height - before!.height), 'hover resized the next control').toBeLessThanOrEqual(1);
    });

    test(`toolbar tooltip stays inside the viewport ${tag}`, async ({ page }) => {
      await openEditor(page);
      const trigger = page.locator('.pp-toolbar .pp-icon-btn').first();
      await trigger.hover();
      await page.waitForTimeout(300);
      const tooltip = page.locator('.pp-toolbar .pp-icon-btn-tooltip').first();
      const tipBox = await tooltip.boundingBox();
      expect(tipBox, 'tooltip has no box').not.toBeNull();
      expect(
        contains({ x: 0, y: 0, width: viewport.width, height: viewport.height }, tipBox!),
        `tooltip leaves the viewport: ${JSON.stringify(tipBox)}`,
      ).toBe(true);
    });

    test(`field row controls do not overlap ${tag}`, async ({ page }) => {
      await openEditor(page);
      await editMixedProfile(page);

      const overlaps = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.pp-field-row'));
        const found: string[] = [];
        for (const [rowIndex, row] of rows.entries()) {
          const controls = Array.from(
            row.querySelectorAll<HTMLElement>('input, select, button'),
          ).filter((el) => el.offsetParent !== null);
          for (let i = 0; i < controls.length; i += 1) {
            for (let j = i + 1; j < controls.length; j += 1) {
              const a = controls[i].getBoundingClientRect();
              const b = controls[j].getBoundingClientRect();
              const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (overlapX > 1 && overlapY > 1) {
                found.push(
                  `row ${rowIndex}: ${controls[i].tagName}.${controls[i].className || '-'} overlaps ${controls[j].tagName}.${controls[j].className || '-'}`,
                );
              }
            }
          }
        }
        return found;
      });
      expect(overlaps, overlaps.join('\n')).toEqual([]);
    });

    test(`numeric and text inputs are wide enough for their values ${tag}`, async ({ page }) => {
      await openEditor(page);
      await editMixedProfile(page);

      // Two different rules, because they are two different defects:
      //
      //  * a NUMBER input must show its whole value — the 50px boxes put the
      //    spinner on top of the digits, which is unreadable, not scrollable;
      //  * a TEXT input may hold more than it shows (that is what a text field
      //    does), but it must not be squeezed into a token width. 160px is the
      //    floor: below that even a short Thai label is unreadable.
      const problems = await page.evaluate(() => {
        const found: string[] = [];
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.pp-field-row input'));
        for (const el of inputs) {
          if (el.offsetParent === null || el.type === 'color' || el.type === 'checkbox') continue;
          const label = el.getAttribute('aria-label') ?? el.className;
          if (el.type === 'number' && el.scrollWidth - el.clientWidth > 2) {
            found.push(`${label}: numeric value "${el.value}" is clipped (${el.scrollWidth} > ${el.clientWidth})`);
          }
          if (el.type === 'number' && el.clientWidth < 70) {
            found.push(`${label}: numeric box is only ${el.clientWidth}px`);
          }
          if (el.type !== 'number' && el.clientWidth < 160) {
            found.push(`${label}: text box is only ${el.clientWidth}px`);
          }
        }
        return found;
      });
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
}

test.describe('paper profile controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('every select has a readable, opaque closed control', async ({ page }) => {
    await openEditor(page);
    await editMixedProfile(page);

    const problems = await page.evaluate(() => {
      const found: string[] = [];
      for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>('select'))) {
        if (select.offsetParent === null) continue;
        const style = getComputedStyle(select);
        const label = select.getAttribute('aria-label') ?? select.className ?? select.name ?? 'select';
        if (style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent') {
          found.push(`${label}: transparent background inherits whatever is behind it`);
        }
        if (style.boxSizing !== 'border-box') {
          found.push(`${label}: box-sizing is ${style.boxSizing}`);
        }
        if (select.scrollWidth - select.clientWidth > 2) {
          found.push(`${label}: selected value is clipped (${select.scrollWidth} > ${select.clientWidth})`);
        }
      }
      return found;
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('selects are keyboard operable and keep native behaviour', async ({ page }) => {
    await openEditor(page);
    await editMixedProfile(page);

    // Located by the option it owns: the orientation label is not wired with
    // htmlFor, and matching on rendered option text picks up the glyph suffix.
    const orientation = page
      .locator('select')
      .filter({ has: page.locator('option[value="landscape"]') })
      .first();
    await orientation.focus();
    await expect(orientation).toBeFocused();
    // By value: the visible option text carries an orientation glyph.
    await orientation.selectOption('landscape');
    await expect(orientation).toHaveValue('landscape');
  });

  test('focus-visible is not colour-only on toolbar actions', async ({ page }) => {
    await openEditor(page);
    const button = page.locator('.pp-toolbar .pp-icon-btn').first();
    await button.focus();
    const ring = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
      };
    });
    const hasRing =
      (ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0) || ring.boxShadow !== 'none';
    expect(hasRing, `no focus ring: ${JSON.stringify(ring)}`).toBe(true);
  });

  test('QR uses its millimetre size and disables text-only styling', async ({ page }) => {
    await openEditor(page);
    await editMixedProfile(page);

    const qrRow = page.locator('.pp-field-row', { has: page.locator('.pp-field-type-badge', { hasText: 'QR' }) });
    const qrSize = qrRow.getByLabel('Size (mm)');
    const fontSize = qrRow.getByLabel('Font size (pt)');
    const color = qrRow.getByLabel('Color');
    const bold = qrRow.getByLabel('Bold');
    const alignment = qrRow.getByLabel('Align');

    await expect(qrSize).toBeEnabled();
    await expect(fontSize).toBeDisabled();
    await expect(color).toBeDisabled();
    await expect(bold).toBeDisabled();
    await expect(alignment).toBeEnabled();

    const preview = qrRow.locator('[aria-label^="qrcode preview"]');
    const before = await preview.boundingBox();
    await qrSize.fill('30');
    const after = await preview.boundingBox();
    expect(before?.width).toBeCloseTo(20 * 96 / 25.4, 0);
    expect(after?.width).toBeCloseTo(30 * 96 / 25.4, 0);
    expect(after?.height).toBeCloseTo(30 * 96 / 25.4, 0);
  });
});

test.describe('paper profile popup layers', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
  });

  test('preset menu closes on Escape, outside click and selection', async ({ page }) => {
    await openEditor(page);
    const trigger = page.getByRole('button', { name: /preset/i }).first();
    const menu = page.locator('.pp-presets-menu');

    await trigger.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await trigger.click();
    await expect(menu).toBeVisible();
    await page.locator('.pp-page-heading h1').click();
    await expect(menu).toBeHidden();

    await trigger.click();
    await menu.getByRole('menuitem').first().click();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('drawers fit the viewport and scroll internally', async ({ page }) => {
    await openEditor(page);
    await editMixedProfile(page);

    for (const name of [/fields/i, /style|appearance/i, /import/i]) {
      await page.locator('.pp-toolbar').getByRole('button', { name }).first().click();
      const drawer = page.locator('.pp-drawer');
      await expect(drawer).toBeVisible();
      const drawerBox = await drawer.boundingBox();
      expect(drawerBox!.width).toBeLessThanOrEqual(1100);
      expect(await hasHorizontalPageScroll(page)).toBe(false);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    }
  });

  test('full preview keeps its controls reachable and locks the page behind it', async ({ page }) => {
    await openEditor(page);
    await editMixedProfile(page);

    await page.locator('.pp-toolbar').getByRole('button', { name: /full-screen preview/i }).click();
    const modal = page.locator('.paper-preview-modal').first();
    await expect(modal).toBeVisible();
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflow).toBe('hidden');
    await page.screenshot({ path: 'artifacts/browser/paper-profile-full-preview-1100x720.png' });
    await page.keyboard.press('Escape');
    const restored = await page.evaluate(() => document.body.style.overflow);
    expect(restored, 'body overflow must be restored when the modal closes').not.toBe('hidden');
  });
});

test.describe('paper profile data failures', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('a failed profile list is visible, not silent', async ({ page }) => {
    await openEditor(page, { listStatus: 500 });
    // Something on screen has to say the list could not be loaded.
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 5000 });
  });

  test('an empty list is distinguishable from a failed one', async ({ page }) => {
    await openEditor(page, { profiles: [] });
    await expect(page.getByText(/no paper profiles|nothing to show/i).first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a failed save shows the backend reason', async ({ page }) => {
    await openEditor(page, {
      saveStatus: 409,
      saveBody: { error: 'CONFLICT', message: 'paper profile code already exists' },
    });
    await editMixedProfile(page);
    await page.locator('.pp-command-actions').getByRole('button', { name: /save|update/i }).first().click();
    await expect(page.getByText(/paper profile code already exists/i)).toBeVisible({ timeout: 5000 });
  });

  test('a failed delete shows the backend reason', async ({ page }) => {
    await openEditor(page, {
      deleteStatus: 409,
      deleteBody: { error: 'CONFLICT', message: 'profile is referenced by a route policy' },
    });
    const row = page.locator('table tbody tr', { hasText: 'Mixed field label' }).first();
    await row.locator('button').nth(2).click();
    await page.getByRole('dialog').getByRole('button', { name: /delete/i }).click();
    await expect(page.getByText(/referenced by a route policy/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('paper profile Thai locale', () => {
  test('long Thai content does not push the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openEditor(page, {}, 'th');
    const row = page.locator('table tbody tr').first();
    await row.locator('button').first().click();
    await expect(page.locator('.pp-field-row').first()).toBeVisible();
    await page.screenshot({ path: 'artifacts/browser/paper-profile-thai-1024x768.png' });
    expect(await hasHorizontalPageScroll(page)).toBe(false);
  });
});
