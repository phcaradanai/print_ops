import { expect, test } from '@playwright/test';
import { hasHorizontalPageScroll, installHarness } from './support.js';

const EMPTY_PROFILE_RESPONSE: unknown[] = [];

async function openPaperProfiles(page: import('@playwright/test').Page) {
  await installHarness(page, {
    locale: 'th',
    api: (url, route, method) => {
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/v1/paper-profiles' && method === 'GET') {
        route.fulfill({ json: EMPTY_PROFILE_RESPONSE });
        return true;
      }
      return false;
    },
  });

  await page.goto('/paper-profiles');
  await expect(page.locator('.paper-profiles-page')).toBeVisible();
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  tolerance = 1,
) {
  return !(
    a.x + a.width <= b.x + tolerance ||
    b.x + b.width <= a.x + tolerance ||
    a.y + a.height <= b.y + tolerance ||
    b.y + b.height <= a.y + tolerance
  );
}

test.describe('Paper Profile screenshot regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 600 });
  });

  test('panels and command controls never paint over each other', async ({ page }) => {
    await openPaperProfiles(page);

    const header = page.locator('.pp-page-header');
    const pageToolbar = page.locator('.pp-page-header .pp-toolbar');
    await expect(header).toBeVisible();
    await expect(pageToolbar).toBeVisible();

    const toolbarBox = await pageToolbar.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(0);
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(901);

    const preview = page.locator('.pp-preview-panel');
    const form = page.locator('.pp-form-panel');
    const previewBox = await preview.boundingBox();
    const formBox = await form.boundingBox();
    expect(previewBox).not.toBeNull();
    expect(formBox).not.toBeNull();
    expect(boxesOverlap(previewBox!, formBox!), 'preview and form panels overlap').toBe(false);
    expect(previewBox!.y, 'preview should appear before the editor when stacked').toBeLessThan(formBox!.y);

    const previewPosition = await preview.evaluate((element) => getComputedStyle(element).position);
    expect(previewPosition, 'legacy sticky preview regression').not.toBe('sticky');

    await form.scrollIntoViewIfNeeded();
    const sectionIndex = page.locator('.pp-command-bar .pp-index');
    const commandActions = page.locator('.pp-command-bar .pp-command-actions');
    await expect(sectionIndex).toBeVisible();
    await expect(commandActions).toBeVisible();

    const indexBox = await sectionIndex.boundingBox();
    const actionsBox = await commandActions.boundingBox();
    expect(indexBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(boxesOverlap(indexBox!, actionsBox!), 'section navigation overlaps status/actions').toBe(false);

    const status = page.locator('.pp-command-status');
    const statusBox = await status.boundingBox();
    expect(statusBox).not.toBeNull();
    expect(statusBox!.width, 'save status collapsed under the icons').toBeGreaterThan(80);

    expect(await hasHorizontalPageScroll(page)).toBe(false);
    await page.screenshot({
      path: 'artifacts/browser/paper-profile-layout-regression-900x600.png',
      fullPage: false,
    });
  });

  test('very short windows scroll instead of collapsing or overlapping panels', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 360 });
    await openPaperProfiles(page);

    const preview = page.locator('.pp-preview-panel');
    const form = page.locator('.pp-form-panel');
    const previewBox = await preview.boundingBox();
    const formBox = await form.boundingBox();
    expect(previewBox).not.toBeNull();
    expect(formBox).not.toBeNull();
    expect(boxesOverlap(previewBox!, formBox!), 'short viewport caused panel overlap').toBe(false);

    const documentCanScroll = await page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
    );
    expect(documentCanScroll, 'short viewport should scroll rather than crush the editor').toBe(true);
    expect(await hasHorizontalPageScroll(page)).toBe(false);
  });
});
