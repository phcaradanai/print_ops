import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';

const ENV_KEYS = [
  'DB_MODE',
  'PRINTOPS_DEV_SEED',
  'PRINTOPS_RUNTIME_MODE',
  'PRINTOPS_LOCAL_WORKER',
  'PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED',
  'PRINTOPS_LOG_DIR',
  'PRINTOPS_APP_VERSION',
  'PRINTOPS_GIT_COMMIT',
  'PRINTOPS_NATS_URL',
  'NATS_URL',
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const tempDirs: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('production readiness and support bundle', () => {
  it('separates optional transports and exports a payload-free, redacted bundle', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'printops-support-'));
    tempDirs.push(logDir);
    writeFileSync(
      join(logDir, 'desktop-server.log'),
      [
        'connecting nats://operator:super-secret@nats.example:4222 Authorization: Bearer abc.def.ghi po_live_visible password=also-visible',
        'patient_name=Do Not Export HN=99887766 renderedPrintPayload=private-label',
      ].join('\n'),
    );
    process.env['DB_MODE'] = 'memory';
    process.env['PRINTOPS_DEV_SEED'] = 'true';
    process.env['PRINTOPS_RUNTIME_MODE'] = 'packaged-windows-desktop';
    process.env['PRINTOPS_LOCAL_WORKER'] = 'true';
    process.env['PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED'] = 'false';
    process.env['PRINTOPS_LOG_DIR'] = logDir;
    process.env['PRINTOPS_APP_VERSION'] = '9.8.7-test';
    process.env['PRINTOPS_GIT_COMMIT'] = '0123456789abcdef';
    delete process.env['PRINTOPS_NATS_URL'];
    delete process.env['NATS_URL'];

    const built = await buildApp({ jwtSecret: 'readiness-support-test-secret' });
    await built.callbackDeliveryRepo.createIfAbsent({
      eventId: 'event-secret',
      printJobId: 'job-secret',
      transport: 'HTTP',
      target: 'https://api-user:api-pass@receiver.example/results?token=visible',
      trigger: 'PRINT_RESULT',
      deliveryStatus: 'PENDING',
      maxAttempts: 5,
      printStatus: 'SUCCESS',
      payload: {
        patient_name: 'A Sensitive Patient',
        documentBase64: 'private-print-bytes',
        apiKey: 'po_live_payload_secret',
      },
    });
    const login = await built.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'sysadmin@printerops.local', password: 'Dev-password1!' },
    });
    const token = (login.json() as { token: string }).token;

    const readinessResponse = await built.app.inject({
      method: 'GET',
      url: '/api/v1/system/readiness',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(readinessResponse.statusCode).toBe(200);
    expect(readinessResponse.headers['cache-control']).toBe('no-store');
    const readiness = readinessResponse.json();
    expect(readiness.components.localApi.state).toBe('READY');
    expect(readiness.components.localPrintWorker.state).toBe('READY');
    expect(readiness.components.natsCore.state).toBe('NOT_CONFIGURED');
    expect(readiness.components.durableConsumer.state).toBe('NOT_CONFIGURED');
    expect(readiness.components.callbackRetryQueue).toMatchObject({
      state: 'DEGRADED',
      details: { pendingCount: 1 },
    });

    const bundleResponse = await built.app.inject({
      method: 'GET',
      url: '/api/v1/system/support-bundle',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bundleResponse.statusCode).toBe(200);
    expect(bundleResponse.headers['cache-control']).toBe('no-store');
    expect(bundleResponse.headers['content-disposition']).toContain('printops-support-');
    const bundleText = bundleResponse.body;
    expect(bundleText).toContain('9.8.7-test');
    expect(bundleText).toContain('0123456789abcdef');
    expect(bundleText).toContain('nats://[REDACTED]@nats.example:4222');
    expect(bundleText).toContain('Authorization: [REDACTED]');
    expect(bundleText).toContain('[REDACTED_API_KEY]');
    expect(bundleText).not.toContain('A Sensitive Patient');
    expect(bundleText).not.toContain('private-print-bytes');
    expect(bundleText).not.toContain('receiver.example');
    expect(bundleText).not.toContain('super-secret');
    expect(bundleText).not.toContain('also-visible');
    expect(bundleText).not.toContain('Do Not Export');
    expect(bundleText).not.toContain('99887766');
    expect(bundleText).not.toContain('po_live_visible');

    const auditResponse = await built.app.inject({
      method: 'GET',
      url: '/audit-logs?resourceType=system',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'support_bundle.exported',
        actorEmail: 'sysadmin@printerops.local',
      }),
    ]));

    const adminLogin = await built.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@printerops.local', password: 'Dev-password1!' },
    });
    const adminToken = (adminLogin.json() as { token: string }).token;
    const denied = await built.app.inject({
      method: 'GET',
      url: '/api/v1/system/support-bundle',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(denied.statusCode).toBe(403);
    await built.app.close();
  });
});
