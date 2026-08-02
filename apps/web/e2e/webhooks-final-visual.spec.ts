import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const artifactRoot = 'artifacts/ui-unification/webhooks-second-pass';

const endpoints = [
  {
    id: 'endpoint-1',
    endpointCode: 'labels-v1',
    name: 'Integration labels',
    sourceSystem: 'integration-service',
    authMode: 'API_KEY',
    enabled: true,
    routePolicyId: 'policy-1',
    callbackTransport: 'BOTH',
    callbackUrl: 'https://integration.example/callbacks/printops/terminal-result/labels-v1/with/a/long/technical/path',
    callbackNatsSubject: 'printops.integration.labels.result.terminal',
    callbackPayloadTemplate: {
      request_id: '$.request_id',
      document_ref: '$.document_ref',
      job_id: '$$.jobId',
    },
    callbackOnPrintResult: true,
    createdAt: '2026-08-01T03:00:00.000Z',
    updatedAt: '2026-08-02T03:15:00.000Z',
  },
  {
    id: 'endpoint-2',
    endpointCode: 'documents-draft',
    name: 'Document bridge',
    sourceSystem: 'document-service',
    authMode: 'NONE',
    enabled: false,
    routePolicyId: 'policy-1',
    callbackTransport: 'NONE',
    callbackOnPrintResult: false,
    createdAt: '2026-08-01T04:00:00.000Z',
    updatedAt: '2026-08-01T04:00:00.000Z',
  },
];

const policies = [
  {
    id: 'policy-1',
    policyCode: 'GENERIC_LABEL',
    name: 'Generic label route',
    payloadMapping: {
      request_id: '$.request_id',
      document_ref: '$.document_ref',
      label_text: '$.label_text',
      barcode: '$.barcode',
    },
  },
];

const callbackLog = [
  {
    id: 'delivery-failed',
    endpointId: 'endpoint-1',
    endpointCode: 'labels-v1',
    transport: 'NATS',
    target: 'printops.integration.labels.result.terminal',
    outcome: 'failed',
    errorMessage: 'No responder acknowledged the subject before the delivery deadline. HTTP delivery succeeded independently.',
    durationMs: 3000,
    trigger: 'test',
    occurredAt: '2026-08-02T03:30:00.000Z',
  },
  {
    id: 'delivery-success',
    endpointId: 'endpoint-1',
    endpointCode: 'labels-v1',
    transport: 'HTTP',
    target: 'https://integration.example/callbacks/printops/terminal-result/labels-v1/with/a/long/technical/path',
    outcome: 'success',
    httpStatus: 204,
    durationMs: 84,
    trigger: 'test',
    occurredAt: '2026-08-02T03:30:00.000Z',
  },
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installApi(page: Page, locale: 'en' | 'th' = 'en', endpointRows = endpoints) {
  await page.addInitScript((selectedLocale) => {
    localStorage.setItem('token', 'webhooks-final-visual');
    localStorage.setItem('printops-locale', selectedLocale);
  }, locale);

  await page.route('**/webhooks', async (route) => {
    if (route.request().isNavigationRequest()) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: indexHtml });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === '/api/health') return json(route, { ok: true });
    if (path === '/api/auth/bootstrap') return json(route, { state: 'READY', ownerEmailHints: [] });
    if (path === '/api/me') {
      return json(route, {
        id: 'owner-1',
        email: 'owner@printops.local',
        name: 'PrintOps Owner',
        role: 'OWNER',
      });
    }
    if (path === '/api/v1/webhook-endpoints' && method === 'GET') return json(route, endpointRows);
    if (path === '/api/v1/webhook-route-policies') return json(route, policies);
    if (path === '/api/v1/webhook-endpoints/callback-log') return json(route, callbackLog);
    if (path.endsWith('/callback-test') && method === 'POST') {
      return json(route, {
        ok: false,
        id: 'delivery-failed',
        transport: 'BOTH',
        delivery: {
          http: {
            attempted: true,
            success: true,
            target: endpoints[0].callbackUrl,
            httpStatus: 204,
            durationMs: 84,
          },
          nats: {
            attempted: true,
            success: false,
            target: endpoints[0].callbackNatsSubject,
            error: 'no responder',
            durationMs: 3000,
          },
        },
      });
    }
    if (path.startsWith('/api/v1/webhook-endpoints/') && method === 'DELETE') {
      return route.fulfill({ status: 204, body: '' });
    }
    if (path.startsWith('/api/v1/webhook-endpoints') && (method === 'POST' || method === 'PUT')) {
      return json(route, { ok: true });
    }
    return json(route, {});
  });
}

function visibleEndpointSurface(page: Page) {
  return page.locator('.webhook-endpoint-table:visible, .webhook-endpoint-cards:visible').first();
}

async function openWebhooks(
  page: Page,
  locale: 'en' | 'th' = 'en',
  viewport = { width: 1440, height: 900 },
  endpointRows = endpoints,
) {
  await page.setViewportSize(viewport);
  await installApi(page, locale, endpointRows);
  await page.goto('/webhooks');
  await expect(page.locator('.webhook-list')).toBeVisible();
  const surface = visibleEndpointSurface(page);
  await expect(surface).toBeVisible();
  if (endpointRows.length > 0) {
    await expect(surface.getByText(endpointRows[0].endpointCode, { exact: true }).first()).toBeVisible();
  } else {
    await expect(surface.getByText('No matching endpoints found', { exact: true })).toBeVisible();
  }
}

async function settleResponsiveNav(page: Page) {
  const toggle = page.locator('.nav-toggle');
  if (await toggle.isVisible()) await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(250);
  await expect(page.locator('.app-nav')).not.toHaveClass(/app-nav--open/);
}

async function expectNoPageOverflow(page: Page) {
  const size = await page.locator('.app-main').evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth + 1);
}

async function screenshot(page: Page, name: string) {
  await expectNoPageOverflow(page);
  await page.screenshot({ path: `${artifactRoot}/${name}.png` });
}

async function openDesktopRowMenu(page: Page, endpointCode: string) {
  const trigger = visibleEndpointSurface(page).getByRole('button', {
    name: `Actions for ${endpointCode}`,
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole('menu', { name: `Actions for ${endpointCode}`, exact: true })).toBeVisible();
}

test('captures complete desktop operating evidence', async ({ page }) => {
  await openWebhooks(page);
  await screenshot(page, 'endpoint-list');

  await page.locator('.ui-page-header__actions')
    .getByRole('button', { name: 'Create endpoint', exact: true })
    .click();
  await expect(page.locator('.webhook-editor-stage')).toBeVisible();
  await screenshot(page, 'editor');

  await page.getByLabel('Callback transport').selectOption('HTTP');
  await page.getByLabel('HTTP target URL').fill('https://integration.example/callbacks/printops');
  await screenshot(page, 'http-callback-configuration');

  await page.getByLabel('Callback transport').selectOption('NATS');
  await page.getByLabel('NATS subject').fill('printops.integration.labels.result');
  await screenshot(page, 'nats-callback-configuration');

  const template = page.getByLabel('Acceptance payload template');
  await template.fill('{bad json');
  await template.scrollIntoViewIfNeeded();
  await expect(template).toHaveAttribute('aria-invalid', 'true');
  await screenshot(page, 'invalid-json');

  await page.getByRole('button', { name: 'Back to endpoints' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'webhook-endpoints.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      endpoints: [
        { endpointCode: 'new-bridge', name: 'New bridge' },
        { endpointCode: 'labels-v1', name: 'Existing labels' },
        { endpointCode: 'bad endpoint', name: '' },
      ],
    })),
  });
  await expect(page.getByRole('heading', { name: 'Review endpoint import' })).toBeVisible();
  await screenshot(page, 'import-preview');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await openDesktopRowMenu(page, 'labels-v1');
  await page.getByRole('menuitem', { name: 'Delete endpoint labels-v1', exact: true }).click();
  await expect(page.getByText(/may stop working immediately/i)).toBeVisible();
  await screenshot(page, 'delete-confirmation');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.locator('.webhook-endpoint-table tbody input[type="checkbox"]').first().check();
  await screenshot(page, 'batch-selection');
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delete selected endpoints' })).toBeVisible();
  await screenshot(page, 'batch-delete-confirmation');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();

  await openDesktopRowMenu(page, 'labels-v1');
  await page.getByRole('menuitem', { name: 'Test sending a callback labels-v1', exact: true }).click();
  await expect(page.getByText(/HTTP: delivered/)).toBeVisible();
  await expect(page.getByText(/NATS: Failed.*no responder/i)).toBeVisible();
  await screenshot(page, 'callback-test-partial');

  await page.getByRole('button', { name: 'Open delivery history', exact: true }).click();
  await expect(page.locator('.webhook-delivery-history')).toBeVisible();
  await screenshot(page, 'delivery-history');
  await page.locator('.webhook-delivery-table:visible')
    .getByRole('button', { name: 'View details', exact: true })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Callback delivery evidence' })).toBeVisible();
  await screenshot(page, 'callback-failure-detail');
});

test('captures empty, tablet, mobile, Thai, and 200 percent zoom without page overflow', async ({ browser }) => {
  const emptyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openWebhooks(emptyPage, 'en', { width: 1440, height: 900 }, []);
  await screenshot(emptyPage, 'empty-state');
  await emptyPage.close();

  for (const viewport of [
    { width: 1024, height: 768, name: 'tablet-1024' },
    { width: 768, height: 1024, name: 'tablet-768' },
    { width: 390, height: 844, name: 'mobile-endpoint-list' },
  ]) {
    const responsivePage = await browser.newPage({ viewport });
    await openWebhooks(responsivePage, 'en', viewport);
    await settleResponsiveNav(responsivePage);
    await expect(responsivePage.locator('.webhook-endpoint-cards')).toBeVisible();
    await screenshot(responsivePage, viewport.name);
    if (viewport.width === 390) {
      await responsivePage.locator('.ui-page-header__actions')
        .getByRole('button', { name: 'Create endpoint', exact: true })
        .click();
      await screenshot(responsivePage, 'mobile-editor');
    }
    await responsivePage.close();
  }

  const zoomPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openWebhooks(zoomPage);
  await zoomPage.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await settleResponsiveNav(zoomPage);
  await screenshot(zoomPage, 'desktop-200-percent-reflow');
  await zoomPage.close();

  const thaiDesktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openWebhooks(thaiDesktop, 'th');
  await screenshot(thaiDesktop, 'thai-desktop');
  await thaiDesktop.close();

  const thaiMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await openWebhooks(thaiMobile, 'th', { width: 390, height: 844 });
  await settleResponsiveNav(thaiMobile);
  await expect(thaiMobile.locator('.webhook-endpoint-cards')).toBeVisible();
  await screenshot(thaiMobile, 'thai-mobile');
  await thaiMobile.close();
});
