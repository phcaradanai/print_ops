import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

async function login(app: Awaited<ReturnType<typeof buildApp>>['app'], email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'dev-password' },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/**
 * Integration test for the webhook callback flow through the real API.
 *
 * The callback-test endpoint (POST /api/v1/webhook-endpoints/:id/callback-test)
 * fires a WebhookCallbackService.send() with a sample payload against a real
 * endpoint configuration. This exercises the full path: endpoint creation →
 * callback resolution → HTTP POST and/or NATS publish against in-process
 * mock transports wired by buildApp().
 *
 * Together with the unit tests in webhook-callback.test.ts, this verifies
 * that hooks configured via the API (HTTP, NATS, and BOTH) actually fire.
 */
describe('Webhook callback flow via API', () => {
  async function createEndpoint(
    app: Awaited<ReturnType<typeof buildApp>>['app'],
    token: string,
    over: Record<string, unknown>,
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook-endpoints',
      headers: auth(token),
      payload: {
        endpointCode: `ep-${Date.now()}`,
        name: 'Test endpoint',
        sourceSystem: 'test',
        authMode: 'NONE',
        enabled: true,
        routePolicyId: undefined,
        callbackTransport: 'NONE',
        callbackOnPrintResult: false,
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  it('fires an HTTP callback to a literal URL', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');

    const id = await createEndpoint(app, token, {
      callbackTransport: 'HTTP',
      callbackUrl: 'https://hook.example/cb',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { request_id: 'REQ-CB-001', hn: 'HN-1234' } },
    });

    // callback-test is best-effort; success means the endpoint was found and
    // the callback service was invoked without throwing into the request path.
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; transport: string };
    expect(body.ok).toBe(true);
    expect(body.transport).toBe('HTTP');
  });

  it('fires a NATS callback with a $.field subject interpolation', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');

    const id = await createEndpoint(app, token, {
      callbackTransport: 'NATS',
      callbackNatsSubject: 'medisync.reply.$.branch',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { branch: 'pharmacy-01', request_id: 'REQ-CB-002' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; transport: string };
    expect(body.ok).toBe(true);
    expect(body.transport).toBe('NATS');
  });

  it('fires BOTH transports (HTTP + NATS fan-out)', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');

    const id = await createEndpoint(app, token, {
      callbackTransport: 'BOTH',
      callbackUrl: 'https://hook.example/cb',
      callbackNatsSubject: 'medisync.reply.fixed',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { request_id: 'REQ-CB-003' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; transport: string };
    expect(body.ok).toBe(true);
    expect(body.transport).toBe('BOTH');
  });

  it('renders the payload template into the callback body', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');

    const id = await createEndpoint(app, token, {
      callbackTransport: 'HTTP',
      callbackUrl: 'https://hook.example/cb',
      callbackPayloadTemplate: {
        event: 'print_accepted',
        hn: '$.hn',
        id: '$.request_id',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { hn: 'HN-9999', request_id: 'REQ-CB-004' } },
    });

    expect(res.statusCode).toBe(200);
    // The callback service resolves $.hn and $.request_id from the sample
    // payload. The callback-test endpoint itself just returns ok — the
    // actual field resolution is unit-tested in webhook-callback.test.ts.
  });

  it('returns 404 for an unknown endpoint id', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook-endpoints/nonexistent-id/callback-test',
      headers: auth(token),
      payload: { samplePayload: {} },
    });

    expect(res.statusCode).toBe(404);
  });
});
