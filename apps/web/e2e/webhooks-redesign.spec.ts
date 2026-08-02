import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const artifactRoot = 'artifacts/ui-unification/webhooks-second-pass';

type Endpoint = {
  id: string;
  endpointCode: string;
  name: string;
  sourceSystem: string;
  authMode: string;
  enabled: boolean;
  routePolicyId: string;
  callbackTransport: 'NONE' | 'HTTP' | 'NATS' | 'BOTH';
  callbackUrl?: string;
  callbackNatsSubject?: string;
  callbackPayloadTemplate?: Record<string, unknown>;
  callbackOnPrintResult: boolean;
  createdAt: string;
  updatedAt: string;
};

type MockState = {
  endpoints: Endpoint[];
  policies: Array<{
    id: string;
    policyCode: string;
    name: string;
    payloadMapping: Record<string, string>;
  }>;
  attempts: Array<Record<string, unknown>>;
  requests: Array<{ method: string; path: string; body?: unknown }>;
  failDeleteId?: string;
};

const baseEndpoints: Endpoint[] = [
  {
    id: 'endpoint-1',
    endpointCode: 'labels-v1',
    name: 'Integration labels',
    sourceSystem: 'integration-service',
    authMode: 'API_KEY',
    enabled: true,
    routePolicyId: 'policy-1',
    callbackTransport: 'BOTH',
    callbackUrl: 'https://integration.example/callbacks/printops/terminal-result/labels-v1',
    callbackNatsSubject: 'printops.integration.labels.result',
    callbackPayloadTemplate: { request_id: '$.request_id', document_ref: '$.document_ref' },
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

const attempts = [
  {
    id: 'attempt-failed',
    endpointId: 'endpoint-1',
    endpointCode: 'labels-v1',
    transport: 'NATS',
    target: 'printops.integration.labels.result',
    outcome: 'failed',
    errorMessage: 'No responders available for the configured subject after the publish timeout window.',
    durationMs: 1250,
    trigger: 'test',
    occurredAt: '2026-08-02T03:30:00.000Z',
  },
  {
    id: 'attempt-success',
    endpointId: 'endpoint-1',
    endpointCode: 'labels-v1',
    transport: 'HTTP',
    target: 'https://integration.example/callbacks/printops/terminal-result/labels-v1',
    outcome: 'success',
    httpStatus: 204,
    durationMs: 84,
    trigger: 'live',
    occurredAt: '2026-08-02T03:25:00.000Z',
  },
];

function freshState(overrides: Partial<MockState> = {}): MockState {
  return {
    endpoints: structuredClone(baseEndpoints),
    policies: structuredClone(policies),
    attempts: structuredClone(attempts),
    requests: [],
    ...overrides,
  };
}

async function jsonBody(route: Route): Promise<unknown> {
  const body = route.request().postData();
  if (!body) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

async function installApi(page: Page, state: MockState, locale: 'en' | 'th' = 'en') {
  await page.addInitScript((selectedLocale) => {
    localStorage.setItem('token', 'webhooks-e2e-token');
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
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/health') return route.fulfill({ json: { ok: true } });
    if (path === '/api/auth/bootstrap') {
      return route.fulfill({ json: { state: 'READY', ownerEmailHints: [] } });
    }
    if (path === '/api/me') {
      return route.fulfill({
        json: {
          id: 'owner-1',
          email: 'owner@example.test',
          name: 'PrintOps Owner',
          role: 'OWNER',
        },
      });
    }
    if (path === '/api/v1/webhook-route-policies') {
      return route.fulfill({ json: state.policies });
    }
    if (path === '/api/v1/webhook-endpoints/callback-log') {
      return route.fulfill({ json: state.attempts });
    }

    const callbackTestMatch = path.match(/^\/api\/v1\/webhook-endpoints\/([^/]+)\/callback-test$/);
    if (callbackTestMatch && method === 'POST') {
      state.requests.push({ method, path, body: await jsonBody(route) });
      state.attempts.unshift({
        id: 'attempt-test-latest',
        endpointId: callbackTestMatch[1] ?? '',
        endpointCode: 'labels-v1',
        transport: 'NATS',
        target: 'printops.integration.labels.result',
        outcome: 'failed',
        errorMessage: 'no responders',
        durationMs: 91,
        trigger: 'test',
        occurredAt: new Date().toISOString(),
      });
      return route.fulfill({
        json: {
          ok: false,
          id: 'attempt-test-latest',
          transport: 'BOTH',
          delivery: {
            http: {
              attempted: true,
              success: true,
              target: 'https://integration.example/callbacks/printops/terminal-result/labels-v1',
              httpStatus: 204,
              durationMs: 84,
            },
            nats: {
              attempted: true,
              success: false,
              target: 'printops.integration.labels.result',
              error: 'no responders',
              durationMs: 91,
            },
          },
        },
      });
    }

    if (path === '/api/v1/webhook-endpoints' && method === 'GET') {
      return route.fulfill({ json: state.endpoints });
    }
    if (path === '/api/v1/webhook-endpoints' && method === 'POST') {
      const body = await jsonBody(route) as Partial<Endpoint>;
      state.requests.push({ method, path, body });
      state.endpoints.push({
        ...baseEndpoints[0],
        ...body,
        id: `endpoint-created-${state.endpoints.length + 1}`,
        endpointCode: String(body.endpointCode ?? 'created-endpoint'),
        name: String(body.name ?? 'Created endpoint'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return route.fulfill({ status: 201, json: state.endpoints.at(-1) });
    }

    const endpointMatch = path.match(/^\/api\/v1\/webhook-endpoints\/([^/]+)$/);
    if (endpointMatch && method === 'PUT') {
      const id = endpointMatch[1] ?? '';
      const body = await jsonBody(route) as Partial<Endpoint>;
      state.requests.push({ method, path, body });
      state.endpoints = state.endpoints.map((endpoint) => endpoint.id === id
        ? { ...endpoint, ...body, updatedAt: new Date().toISOString() }
        : endpoint);
      return route.fulfill({ json: state.endpoints.find((endpoint) => endpoint.id === id) ?? {} });
    }
    if (endpointMatch && method === 'DELETE') {
      const id = endpointMatch[1] ?? '';
      state.requests.push({ method, path });
      if (state.failDeleteId === id) {
        return route.fulfill({
          status: 500,
          json: { message: 'Endpoint remains in use by an integration bridge.' },
        });
      }
      state.endpoints = state.endpoints.filter((endpoint) => endpoint.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill({ status: 200, json: [] });
  });
}

async function openWebhooks(
  page: Page,
  state: MockState,
  locale: 'en' | 'th' = 'en',
  viewport = { width: 1440, height: 900 },
) {
  await page.setViewportSize(viewport);
  await installApi(page, state, locale);
  await page.goto('/webhooks');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.webhook-list, .webhook-editor-stage, .webhook-delivery-history').first()).toBeVisible();
}

function desktopEndpointTable(page: Page) {
  return page.locator('.webhook-endpoint-table');
}

async function openCreateEditor(page: Page) {
  await page.locator('.ui-page-header__actions')
    .getByRole('button', { name: 'Create endpoint', exact: true })
    .click();
  await expect(page.locator('.webhook-editor-stage')).toBeVisible();
}

async function openRowMenu(page: Page, endpointCode: string) {
  await page.getByLabel(`Actions for ${endpointCode}`).click();
  await expect(page.getByRole('menu', { name: `Actions for ${endpointCode}` })).toBeVisible();
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.locator('.app-main').evaluate((element) => {
    const mainRect = element.getBoundingClientRect();
    const offenders = Array.from(element.querySelectorAll<HTMLElement>('*'))
      .map((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return {
          tag: candidate.tagName.toLowerCase(),
          className: candidate.className,
          text: candidate.textContent?.trim().slice(0, 80) ?? '',
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((candidate) => candidate.right > Math.ceil(mainRect.right) + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 8);
    return { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, offenders };
  });
  expect(
    overflow.scrollWidth,
    `Horizontal overflow: ${JSON.stringify(overflow.offenders, null, 2)}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('Webhooks second-pass visual evidence', () => {
  test('captures focused desktop workflow and diagnostic states', async ({ page }) => {
    const state = freshState();
    await openWebhooks(page, state);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/endpoint-list.png`, fullPage: true });

    await openCreateEditor(page);
    await expect(page.getByText('Create intake endpoint')).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/editor.png`, fullPage: true });

    const transport = page.getByLabel('Callback transport');
    await transport.selectOption('HTTP');
    await page.getByLabel('HTTP target URL').fill('https://integration.example/callbacks/printops');
    await page.screenshot({ path: `${artifactRoot}/http-callback-configuration.png`, fullPage: true });

    await transport.selectOption('NATS');
    await page.getByLabel('NATS subject').fill('printops.integration.labels.result');
    await page.screenshot({ path: `${artifactRoot}/nats-callback-configuration.png`, fullPage: true });

    await page.getByLabel('Acceptance payload template').fill('{bad json');
    await expect(page.getByLabel('Acceptance payload template')).toHaveAttribute('aria-invalid', 'true');
    await page.screenshot({ path: `${artifactRoot}/invalid-json.png`, fullPage: true });

    await page.getByRole('button', { name: 'Back to endpoints' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'webhook-endpoints.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        endpoints: [
          { endpointCode: 'new-bridge', name: 'New bridge', sourceSystem: 'integration-bridge' },
          { endpointCode: 'labels-v1', name: 'Existing labels' },
          { endpointCode: 'bad endpoint', name: '' },
        ],
      })),
    });
    await expect(page.getByRole('heading', { name: 'Review endpoint import' })).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/import-preview.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cancel' }).click();

    await openRowMenu(page, 'labels-v1');
    await page.getByRole('menuitem', { name: 'Delete endpoint labels-v1' }).click();
    await expect(page.getByText(/may stop working immediately/i)).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/delete-confirmation.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cancel' }).click();

    await desktopEndpointTable(page).locator('tbody input[type="checkbox"]').first().check();
    await expect(page.getByText('1 endpoint(s) selected')).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/batch-selection.png`, fullPage: true });
    await page.getByRole('button', { name: 'Clear selection' }).click();

    await openRowMenu(page, 'labels-v1');
    await page.getByRole('menuitem', { name: 'Test sending a callback labels-v1' }).click();
    await expect(page.getByText('Callback test result')).toBeVisible();
    await expect(page.getByText(/HTTP: delivered/)).toBeVisible();
    await expect(page.getByText(/NATS: Failed.*no responders/i)).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/callback-test-partial.png`, fullPage: true });

    await page.getByRole('button', { name: 'Open delivery history' }).click();
    await expect(page.locator('.webhook-delivery-history')).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/delivery-history.png`, fullPage: true });
    await page.locator('.webhook-delivery-table tbody')
      .getByRole('button', { name: 'View details' })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Callback delivery evidence' })).toBeVisible();
    await page.screenshot({ path: `${artifactRoot}/callback-failure-detail.png`, fullPage: true });
  });

  test('captures empty, tablet, mobile, 200% reflow, and Thai layouts without page overflow', async ({ page }) => {
    await openWebhooks(page, freshState({ endpoints: [] }), 'en', { width: 1440, height: 900 });
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/empty-state.png`, fullPage: true });

    await page.reload();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('main')).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/tablet-1024.png`, fullPage: true });

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator('.webhook-endpoint-cards')).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/tablet-768.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.webhook-endpoint-cards')).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/mobile-endpoint-list.png`, fullPage: true });
    await openCreateEditor(page);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/mobile-editor.png`, fullPage: true });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Back to endpoints' }).click();
    // Playwright does not expose browser zoom. A 720px CSS viewport models
    // the reflow produced by viewing the 1440px desktop surface at 200%.
    await page.setViewportSize({ width: 720, height: 900 });
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/desktop-200-percent-reflow.png`, fullPage: true });
  });

  test('captures Thai desktop and mobile surfaces', async ({ page }) => {
    await openWebhooks(page, freshState(), 'th', { width: 1440, height: 900 });
    await expect(page.getByRole('button', { name: 'สร้างจุดรับงาน' })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/thai-desktop.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.webhook-endpoint-cards')).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `${artifactRoot}/thai-mobile.png`, fullPage: true });
  });
});

test.describe('Webhooks second-pass operational behavior', () => {
  test('creates drafts and enabled endpoints while preserving the API payload contract', async ({ page }) => {
    const state = freshState();
    await openWebhooks(page, state);

    await openCreateEditor(page);
    await page.getByLabel('Endpoint code').fill('created-draft');
    await page.getByLabel('Display name').fill('Created draft');
    await page.getByLabel('Route policy').selectOption('policy-1');
    await page.locator('.webhook-editor-actions').getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft endpoint created')).toBeVisible();

    expect(state.requests.find((request) => request.method === 'POST')?.body).toMatchObject({
      endpointCode: 'created-draft',
      enabled: false,
      authMode: 'NONE',
      routePolicyId: 'policy-1',
      callbackTransport: 'NONE',
      callbackOnPrintResult: false,
    });

    await openCreateEditor(page);
    await page.getByLabel('Endpoint code').fill('created-enabled');
    await page.getByLabel('Display name').fill('Created enabled');
    await page.getByLabel('Route policy').selectOption('policy-1');
    await page.locator('.webhook-editor-actions')
      .getByRole('button', { name: 'Create endpoint', exact: true })
      .click();
    await expect(page.getByText('New endpoint created')).toBeVisible();
    expect(state.requests.filter((request) => request.method === 'POST').at(-1)?.body)
      .toMatchObject({ endpointCode: 'created-enabled', enabled: true });
  });

  test('edits, toggles, deletes, imports, and retains partial batch failures as evidence', async ({ page }) => {
    const state = freshState({ failDeleteId: 'endpoint-2' });
    await openWebhooks(page, state);

    await desktopEndpointTable(page).getByLabel('Edit labels-v1').click();
    await page.getByLabel('Display name').fill('Updated integration labels');
    await page.locator('.webhook-editor-actions').getByRole('button', { name: 'Save endpoint' }).click();
    await expect(page.getByText('Endpoint changes saved')).toBeVisible();
    expect(state.requests.find((request) => request.method === 'PUT')?.body)
      .toMatchObject({ name: 'Updated integration labels', enabled: true });

    await openRowMenu(page, 'labels-v1');
    await page.getByRole('menuitem', { name: 'Set to draft labels-v1' }).click();
    await expect.poll(() => state.requests.filter((request) => request.method === 'PUT').length)
      .toBeGreaterThan(1);
    expect(state.requests.filter((request) => request.method === 'PUT').at(-1)?.body)
      .toEqual({ enabled: false });

    await desktopEndpointTable(page).locator('tbody input[type="checkbox"]').first().check();
    await desktopEndpointTable(page).locator('tbody input[type="checkbox"]').nth(1).check();
    await page.getByRole('button', { name: 'Delete selected' }).click();
    await expect(page.getByText(/Deleting 2 endpoint/)).toBeVisible();
    await page.getByRole('button', { name: 'Delete 2 endpoints' }).click();
    await expect(page.getByText(/Deleted 1; 1 failed/)).toBeVisible();
    await expect(page.getByText(/documents-draft: Endpoint remains in use/)).toBeVisible();
    await expect(page.getByText('1 endpoint(s) selected')).toBeVisible();

    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'webhook-import.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        endpoints: [
          { endpointCode: 'imported-endpoint', name: 'Imported endpoint', routePolicyId: 'policy-1' },
          { endpointCode: 'bad endpoint', name: '' },
        ],
      })),
    });
    await page.getByRole('button', { name: 'Apply import' }).click();
    await expect(page.getByText(/1 succeeded.*1 failed/)).toBeVisible();
    await expect(page.getByText(/bad endpoint:/)).toBeVisible();
  });
});
