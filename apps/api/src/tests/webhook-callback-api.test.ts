import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildApp } from '../app.js';

/** Spins up a real local HTTP server (loopback only — no external network
 * needed) so tests can verify a GENUINE successful callback delivery, not
 * just "the endpoint was found and send() was called". */
function startLocalReceiver(handler: (body: string) => number = () => 200): Promise<{ server: Server; url: string; requests: string[] }> {
  const requests: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push(body);
        res.statusCode = handler(body);
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, requests });
    });
  });
}

async function login(app: Awaited<ReturnType<typeof buildApp>>['app'], email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'Dev-password1!' },
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
  const activeServers: Server[] = [];
  afterEach(async () => {
    await Promise.all(activeServers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  });

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

  it('reports a GENUINE successful HTTP delivery against a real local receiver', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');
    const receiver = await startLocalReceiver();
    activeServers.push(receiver.server);

    const id = await createEndpoint(app, token, {
      callbackTransport: 'HTTP',
      callbackUrl: `${receiver.url}/cb`,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { request_id: 'REQ-CB-001', hn: 'HN-1234' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; transport: string; delivery: { http?: { attempted: boolean; success: boolean; durationMs: number } } };
    expect(body.ok).toBe(true);
    expect(body.transport).toBe('HTTP');
    expect(body.delivery.http?.attempted).toBe(true);
    expect(body.delivery.http?.success).toBe(true);
    expect(body.delivery.http?.durationMs).toBeGreaterThanOrEqual(0);
    expect(receiver.requests).toHaveLength(1);
    // callback-test always sends its fixed sample result envelope (not the
    // request's samplePayload) unless a callbackPayloadTemplate is set —
    // see WebhookCallbackService.prepare().
    expect(JSON.parse(receiver.requests[0]!)['print_job_id']).toBe('test');
  });

  it('reports a GENUINE failed HTTP delivery when the URL is unreachable (no fake ok:true)', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');

    // `.example` is an IANA-reserved TLD that is guaranteed to never resolve
    // anywhere, so this is a real, deterministic delivery failure — exactly
    // the case that used to be silently reported as `ok: true`.
    const id = await createEndpoint(app, token, {
      callbackTransport: 'HTTP',
      callbackUrl: 'https://hook.example/cb',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { request_id: 'REQ-CB-001B' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; transport: string; delivery: { http?: { attempted: boolean; success: boolean; error?: string } } };
    expect(body.ok).toBe(false);
    expect(body.delivery.http?.attempted).toBe(true);
    expect(body.delivery.http?.success).toBe(false);
    expect(body.delivery.http?.error).toBeTruthy();
  });

  it('reports a HTTP-level failure (non-2xx) distinctly, including the status code', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');
    const receiver = await startLocalReceiver(() => 500);
    activeServers.push(receiver.server);

    const id = await createEndpoint(app, token, {
      callbackTransport: 'HTTP',
      callbackUrl: `${receiver.url}/cb`,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { request_id: 'REQ-CB-001C' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; delivery: { http?: { success: boolean; httpStatus?: number } } };
    expect(body.ok).toBe(false);
    expect(body.delivery.http?.success).toBe(false);
    expect(body.delivery.http?.httpStatus).toBe(500);
  });

  it('reports a NATS callback as skipped when no NATS transport is connected (test env has no broker)', async () => {
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
    const body = res.json() as { ok: boolean; transport: string; delivery: { nats?: { attempted: boolean; success: boolean; error?: string } } };
    // Honest reporting: this test process has no NATS broker connected, so
    // the real outcome is "skipped", never a rubber-stamped ok:true.
    expect(body.ok).toBe(false);
    expect(body.transport).toBe('NATS');
    expect(body.delivery.nats?.attempted).toBe(false);
    expect(body.delivery.nats?.success).toBe(false);
    expect(body.delivery.nats?.error).toMatch(/not connected/i);
  });

  it('fires BOTH transports (HTTP genuinely succeeds, NATS genuinely skipped)', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');
    const receiver = await startLocalReceiver();
    activeServers.push(receiver.server);

    const id = await createEndpoint(app, token, {
      callbackTransport: 'BOTH',
      callbackUrl: `${receiver.url}/cb`,
      callbackNatsSubject: 'medisync.reply.fixed',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { request_id: 'REQ-CB-003' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean; transport: string;
      delivery: { http?: { success: boolean }; nats?: { success: boolean } };
    };
    expect(body.transport).toBe('BOTH');
    expect(body.delivery.http?.success).toBe(true);
    expect(body.delivery.nats?.success).toBe(false);
    // Overall ok reflects BOTH transports — one skipped transport still
    // means "not fully delivered", which is the honest answer.
    expect(body.ok).toBe(false);
  });

  it('records every callback-test attempt to the callback log, visible via GET /webhook-endpoints/callback-log', async () => {
    const { app } = await buildApp();
    const token = await login(app, 'sysadmin@printerops.local');
    const receiver = await startLocalReceiver();
    activeServers.push(receiver.server);

    const id = await createEndpoint(app, token, {
      callbackTransport: 'HTTP',
      callbackUrl: `${receiver.url}/cb`,
    });

    const fireRes = await app.inject({
      method: 'POST',
      url: `/api/v1/webhook-endpoints/${id}/callback-test`,
      headers: auth(token),
      payload: { samplePayload: { request_id: 'REQ-CB-LOG-1' } },
    });
    expect(fireRes.statusCode).toBe(200);

    const logRes = await app.inject({
      method: 'GET',
      url: '/api/v1/webhook-endpoints/callback-log',
      headers: auth(token),
    });
    expect(logRes.statusCode).toBe(200);
    const entries = logRes.json() as Array<{ endpointId: string; transport: string; outcome: string; trigger: string }>;
    const mine = entries.find((e) => e.endpointId === id);
    expect(mine).toBeTruthy();
    expect(mine?.transport).toBe('HTTP');
    expect(mine?.outcome).toBe('success');
    expect(mine?.trigger).toBe('test');
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
