import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const artifactRoot = join(process.cwd(), 'artifacts/ui-unification/webhooks-second-pass');

const endpoints = [
  {
    id: 'endpoint-1',
    endpointCode: 'shipping-labels',
    name: 'Shipping label bridge',
    sourceSystem: 'warehouse-integration',
    authMode: 'API_KEY',
    enabled: true,
    routePolicyId: 'policy-1',
    callbackTransport: 'BOTH',
    callbackUrl: 'https://integration.example.local/callbacks/printops/terminal-results/with/a/very/long/path',
    callbackNatsSubject: 'integration.printops.shipping-labels.result.terminal',
    callbackPayloadTemplate: {
      request_id: '$.request_id',
      accepted_job_id: '$$.jobId',
    },
    callbackOnPrintResult: true,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-02T10:42:00.000Z',
  },
  {
    id: 'endpoint-2',
    endpointCode: 'document-proof',
    name: 'Document proof intake',
    sourceSystem: 'document-service',
    authMode: 'NONE',
    enabled: false,
    routePolicyId: 'policy-2',
    callbackTransport: 'NONE',
    callbackOnPrintResult: false,
    createdAt: '2026-07-30T06:00:00.000Z',
    updatedAt: '2026-08-01T12:15:00.000Z',
  },
];

const policies = [
  {
    id: 'policy-1',
    policyCode: 'LABEL_ROUTE',
    name: 'Route label jobs by printer code',
    payloadMapping: {
      request_id: '$.request_id',
      document_ref: '$.document_ref',
      label_text: '$.label_text',
      barcode: '$.barcode',
    },
  },
  {
    id: 'policy-2',
    policyCode: 'PROOF_ROUTE',
    name: 'Route document proof jobs',
    payloadMapping: {
      request_id: '$.request_id',
      document_ref: '$.document_ref',
    },
  },
];

const callbackLog = [
  {
    id: 'delivery-1',
    endpointId: 'endpoint-1',
    endpointCode: 'shipping-labels',
    transport: 'HTTP',
    target: 'https://integration.example.local/callbacks/printops/terminal-results/with/a/very/long/path',
    outcome: 'success',
    httpStatus: 204,
    durationMs: 84,
    trigger: 'test',
    occurredAt: '2026-08-02T10:44:00.000Z',
  },
  {
    id: 'delivery-2',
    endpointId: 'endpoint-1',
    endpointCode: 'shipping-labels',
    transport: 'NATS',
    target: 'integration.printops.shipping-labels.result.terminal',
    outcome: 'failed',
    errorMessage: 'No responder acknowledged the subject before the delivery deadline. The endpoint remains enabled and HTTP delivery succeeded.',
    durationMs: 3000,
    trigger: 'test',
    occurredAt: '2026-08-02T10:44:00.000Z',
  },
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'webhooks-review-token');
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
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
    if (path === '/api/v1/webhook-endpoints' && method === 'GET') return json(route, endpoints);
    if (path === '/api/v1/webhook-route-policies') return json(route, policies);
    if (path === '/api/v1/webhook-endpoints/callback-log') return json(route, callbackLog);
    if (path.endsWith('/callback-test') && method === 'POST') {
      return json(route, {
        ok: false,
        id: 'delivery-2',
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

async function openWebhooks(page: Page, locale: 'en' | 'th') {
  await mockApi(page);
  await page.addInitScript((nextLocale) => {
    localStorage.setItem('printops-locale', nextLocale);
  }, locale);
  await page.goto('/webhooks');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('shipping-labels').first()).toBeVisible();
}

async function capture(page: Page, name: string) {
  mkdirSync(artifactRoot, { recursive: true });
  await page.screenshot({ path: join(artifactRoot, name), fullPage: true });
}

for (const viewport of [
  { width: 1440, height: 900, name: '1440x900' },
  { width: 1024, height: 768, name: '1024x768' },
  { width: 768, height: 1024, name: '768x1024' },
  { width: 390, height: 844, name: '390x844' },
]) {
  test(`capture current webhook workspace ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openWebhooks(page, 'en');
    await capture(page, `before-endpoints-en-${viewport.name}.png`);

    const create = page.getByRole('button', { name: 'Create endpoint' });
    await create.click();
    await expect(page.getByRole('heading', { name: 'Create intake endpoint' })).toBeVisible();
    await capture(page, `before-editor-en-${viewport.name}.png`);

    await page.getByRole('button', { name: 'Back to endpoints' }).click();
    await page.getByRole('button', { name: 'Delivery history' }).click();
    await expect(page.getByText('shipping-labels').first()).toBeVisible();
    await capture(page, `before-history-en-${viewport.name}.png`);
  });
}

test('capture Thai desktop and mobile modes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWebhooks(page, 'th');
  await capture(page, 'before-endpoints-th-1440x900.png');
  await page.getByRole('button', { name: 'สร้างจุดรับงาน' }).click();
  await capture(page, 'before-editor-th-1440x900.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'กลับไปจุดรับงาน' }).click();
  await capture(page, 'before-endpoints-th-390x844.png');
});

test('capture 200 percent zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWebhooks(page, 'en');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await capture(page, 'before-endpoints-en-200-percent-zoom.png');
});
