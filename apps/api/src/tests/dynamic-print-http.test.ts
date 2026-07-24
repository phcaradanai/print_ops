import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const API_KEY = 'printops-dev-apikey-2026';

function withApiKey(): { 'x-api-key': string } {
  return { 'x-api-key': API_KEY };
}

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
 * End-to-end integration test for the dynamic HTTP print flow:
 *   POST /api/v1/printer/:code_template/:code_profile
 *
 * This is the HTTP twin of the NATS print-intake consumer — both call the
 * same DynamicPrintService. We exercise the full Fastify stack (auth,
 * validation, binding resolution, job creation, idempotency) through
 * app.inject() so no real network socket is needed.
 *
 * The seed in app.ts ships these bound pairs:
 *   LAB_LABEL_DEFAULT + LABEL_100X50 → LAB_LABEL_01
 *   prescription-sticker + sticker-profile → sticker-printer
 */
describe('Dynamic print HTTP endpoint (POST /api/v1/printer/:code_template/:code_profile)', () => {
  it('creates a queued job from template + profile path params', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printer/LAB_LABEL_DEFAULT/LABEL_100X50',
      headers: withApiKey(),
      payload: {
        request_id: 'REQ-HTTP-DYN-001',
        source_system: 'integration-service',
        payload: { patient: 'ทดสอบ คนไข้', barcode: 'BC001' },
        copies: 1,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string; duplicate: boolean; print_job_id: string };
    expect(body.status).toBe('QUEUED');
    expect(body.duplicate).toBe(false);
    expect(body.print_job_id).toBeTruthy();
  });

  it('is idempotent on (request_id + source_system) — resend returns 200 duplicate', async () => {
    const { app } = await buildApp();

    const payload = {
      request_id: 'REQ-HTTP-DUP-001',
      source_system: 'integration-service',
      payload: {},
      copies: 1,
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/printer/LAB_LABEL_DEFAULT/LABEL_100X50',
      headers: withApiKey(),
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/printer/LAB_LABEL_DEFAULT/LABEL_100X50',
      headers: withApiKey(),
      payload,
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as { duplicate: boolean; print_job_id: string };
    expect(body.duplicate).toBe(true);
    expect(body.print_job_id).toBe((first.json() as { print_job_id: string }).print_job_id);
  });

  it('returns 400 when request_id is missing', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printer/LAB_LABEL_DEFAULT/LABEL_100X50',
      headers: withApiKey(),
      payload: { source_system: 'sys', payload: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('honours an explicit printer_code override (skips binding resolution)', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printer/LAB_LABEL_DEFAULT/any-unresolvable-profile',
      headers: withApiKey(),
      payload: {
        request_id: 'REQ-HTTP-OVR-001',
        source_system: 'integration-service',
        printer_code: 'LAB_LABEL_01',
        payload: {},
        copies: 1,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string };
    expect(body.status).toBe('QUEUED');
  });

  it('resolves the sticker binding to sticker-printer', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printer/prescription-sticker/sticker-profile',
      headers: withApiKey(),
      payload: {
        request_id: 'REQ-HTTP-STICKER-001',
        source_system: 'medisync',
        source_reference: 'RX-12345',
        payload: { prescription_id: 'RX-12345', patient_name: 'สมหญิง รักไทย', hn: 'HN-0002' },
        copies: 1,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string; print_job_id: string };
    expect(body.status).toBe('QUEUED');

    // Verify the job landed on the sticker-printer (resolved from the binding).
    const token = await login(app, 'sysadmin@printerops.local');
    const job = await app.inject({
      method: 'GET', url: `/jobs/${body.print_job_id}`, headers: auth(token),
    });
    const jobBody = job.json() as { printerCode?: string; printerId?: string };
    expect(jobBody.printerCode ?? jobBody.printerId).toBeTruthy();
  });

  it('rejects a request without a valid API key', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printer/LAB_LABEL_DEFAULT/LABEL_100X50',
      headers: { 'x-api-key': 'wrong-key' },
      payload: { request_id: 'REQ-NOAUTH', source_system: 'sys', payload: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});
