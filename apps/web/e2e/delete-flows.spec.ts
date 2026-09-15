import { expect, test, type Page, type Route } from '@playwright/test';
import { installHarness } from './support.js';

interface MockTemplate {
  id: string;
  templateCode: string;
  name: string;
  engine: string;
  status: string;
  version: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface MockPaperProfile {
  id: string;
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  dpi: number;
  orientation: 'portrait' | 'landscape';
  unit: 'mm';
  fields: unknown[];
}

async function fulfillNoContent(route: Route): Promise<void> {
  await route.fulfill({ status: 204 });
}

async function openTemplates(page: Page, onDelete: () => void) {
  let templates: MockTemplate[] = [{
    id: 'tpl-delete-1',
    templateCode: 'DELETE_ME_TEMPLATE',
    name: 'Template scheduled for deletion',
    engine: 'RAW_TEXT',
    status: 'DRAFT',
    version: 1,
    content: 'TEST',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  }];

  await installHarness(page, {
    locale: 'en',
    api: async (url, route, method) => {
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/v1/templates' && method === 'GET') {
        await route.fulfill({ json: templates });
        return true;
      }
      if (path === '/v1/paper-profiles' && method === 'GET') {
        await route.fulfill({ json: [] });
        return true;
      }
      if (path === '/v1/templates/tpl-delete-1' && method === 'DELETE') {
        templates = [];
        onDelete();
        await fulfillNoContent(route);
        return true;
      }
      return false;
    },
  });

  await page.goto('/templates');
  await expect(page.getByText('DELETE_ME_TEMPLATE')).toBeVisible();
}

async function openPaperProfiles(page: Page, onDelete: () => void) {
  let profiles: MockPaperProfile[] = [{
    id: 'profile-delete-1',
    code: 'DELETE_ME_PROFILE',
    name: 'Paper profile scheduled for deletion',
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 2,
    marginBottomMm: 2,
    marginLeftMm: 2,
    dpi: 203,
    orientation: 'portrait',
    unit: 'mm',
    fields: [],
  }];

  await installHarness(page, {
    locale: 'en',
    api: async (url, route, method) => {
      const path = url.pathname.replace(/^\/api/, '');
      if (path === '/v1/paper-profiles' && method === 'GET') {
        await route.fulfill({ json: profiles });
        return true;
      }
      if (path === '/v1/paper-profiles/profile-delete-1' && method === 'DELETE') {
        profiles = [];
        onDelete();
        await fulfillNoContent(route);
        return true;
      }
      return false;
    },
  });

  await page.goto('/paper-profiles');
  await expect(page.getByText('DELETE_ME_PROFILE')).toBeVisible();
}

test.describe('successful deletion with an empty API response', () => {
  test('deletes a template and refreshes the list after HTTP 204', async ({ page }) => {
    let deleteCalls = 0;
    await openTemplates(page, () => { deleteCalls += 1; });

    const row = page.locator('.tpl-table tbody tr', { hasText: 'DELETE_ME_TEMPLATE' });
    await row.locator('.tpl-menu-wrap > button').click();
    await row.locator('.tpl-menu__danger').click();

    const dialog = page.locator('.ds-modal', { hasText: 'DELETE_ME_TEMPLATE' });
    await expect(dialog).toBeVisible();
    await dialog.locator('.ds-modal__actions .ds-btn--danger').click();

    await expect(page.getByText('DELETE_ME_TEMPLATE')).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    expect(deleteCalls).toBe(1);
    await expect(page.getByText(/malformed response|INVALID_JSON/i)).toHaveCount(0);
  });

  test('deletes a paper profile and refreshes the list after HTTP 204', async ({ page }) => {
    let deleteCalls = 0;
    await openPaperProfiles(page, () => { deleteCalls += 1; });

    const row = page.locator('table tbody tr', { hasText: 'DELETE_ME_PROFILE' });
    await row.locator('.ds-btn--danger').click();

    const dialog = page.locator('.ds-modal', { hasText: 'DELETE_ME_PROFILE' });
    await expect(dialog).toBeVisible();
    await dialog.locator('.ds-modal__actions .ds-btn--danger').click();

    await expect(page.getByText('DELETE_ME_PROFILE')).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    expect(deleteCalls).toBe(1);
    await expect(page.getByText(/malformed response|INVALID_JSON/i)).toHaveCount(0);
  });
});
