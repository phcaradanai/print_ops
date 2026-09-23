import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { hashPassword } from '../infra/auth/password.js';

describe('Web Control API Routes (Phase 1, 2, 3, 6, 8)', () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let viewerToken: string;

  beforeEach(async () => {
    process.env['DB_MODE'] = 'memory';
    process.env['PRINTOPS_DEV_SEED'] = 'true';
    const built = await buildApp();
    app = built.app;

    // Login as OWNER (sysadmin@printerops.local)
    const ownerRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'sysadmin@printerops.local',
        password: 'Dev-password1!',
      },
    });
    const ownerJson = ownerRes.json() as { token: string };
    ownerToken = ownerJson.token;

    // Login as VIEWER (viewer@printerops.local)
    const viewerRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'viewer@printerops.local',
        password: 'Dev-password1!',
      },
    });
    const viewerJson = viewerRes.json() as { token: string };
    viewerToken = viewerJson.token;
  });

  afterEach(async () => {
    await app.close();
  });

  it('generates enrollment token and enrolls a device', async () => {
    // 1. Create enrollment token as OWNER
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/enrollment-tokens',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        siteId: 'site-radiology',
        expiresInSeconds: 3600,
      },
    });
    expect(tokenRes.statusCode).toBe(201);
    const tokenJson = tokenRes.json() as { token: string; siteId: string };
    expect(tokenJson.token).toMatch(/^enroll_/);
    expect(tokenJson.siteId).toBe('site-radiology');

    // 2. Enroll device (unauthenticated bootstrap endpoint)
    const enrollRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/enroll',
      payload: {
        enrollmentToken: tokenJson.token,
        installationId: 'inst_radio_01',
        hostname: 'radio-print-pc',
        platform: 'windows-x64',
        architecture: 'x64',
        appVersion: '0.1.28',
        schemaVersion: 8,
        runnerVersion: '0.1.28',
        displayName: 'Radiology Thermal Printer',
      },
    });
    expect(enrollRes.statusCode).toBe(201);
    const enrollJson = enrollRes.json() as {
      deviceId: string;
      deviceToken: string;
      controlPlane: { commandSubject: string; eventSubject: string; heartbeatSubject: string };
    };
    expect(enrollJson.deviceId).toMatch(/^dev_/);
    expect(enrollJson.deviceToken).toMatch(/^devtok_/);
    expect(enrollJson.controlPlane.commandSubject).toBe(`printops.control.command.${enrollJson.deviceId}`);

    // 3. List devices as OWNER
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/devices',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const devices = listRes.json() as Array<{ deviceId: string; hostname: string }>;
    expect(devices.some((d) => d.deviceId === enrollJson.deviceId)).toBe(true);

    // 4. Get device detail
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/control/devices/${enrollJson.deviceId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json() as { deviceId: string; displayName: string };
    expect(detail.displayName).toBe('Radiology Thermal Printer');
  });

  it('enforces RBAC: VIEWER cannot generate token or issue command', async () => {
    // VIEWER tries to generate enrollment token -> 403 Forbidden
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/enrollment-tokens',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { siteId: 'test-site' },
    });
    expect(tokenRes.statusCode).toBe(403);

    // Unauthenticated request -> 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/devices',
    });
    expect(unauthRes.statusCode).toBe(401);
  });

  it('manages releases and issues device command', async () => {
    // 1. Create token and enroll device
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/enrollment-tokens',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { siteId: 'site-surgery' },
    });
    const { token } = tokenRes.json() as { token: string };

    const enrollRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/enroll',
      payload: {
        enrollmentToken: token,
        installationId: 'inst_surgery_01',
        hostname: 'surgery-pc',
        platform: 'windows-x64',
        architecture: 'x64',
        appVersion: '0.1.28',
        schemaVersion: 8,
        runnerVersion: '0.1.28',
      },
    });
    const { deviceId } = enrollRes.json() as { deviceId: string };

    // 2. Register signed release in catalog
    const releaseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/releases',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        version: '0.1.29',
        channel: 'stable',
        platform: 'windows-x64',
        architecture: 'x64',
        schemaVersion: 8,
        manifestRef: 'https://releases.local/manifest.json',
        artifactRef: 'https://releases.local/artifact.exe',
        sha256: 'hash123',
        signature: 'sig123',
        minSupportedVersion: '0.1.20',
      },
    });
    expect(releaseRes.statusCode).toBe(201);

    // 3. Issue OTA command
    const cmdRes = await app.inject({
      method: 'POST',
      url: `/api/v1/control/devices/${deviceId}/commands`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        type: 'OTA_INSTALL',
        targetVersion: '0.1.29',
        idempotencyKey: 'idem_api_test_1',
      },
    });
    expect(cmdRes.statusCode).toBe(202);
    const cmdJson = cmdRes.json() as { commandId: string; type: string };
    expect(cmdJson.commandId).toMatch(/^cmd_/);

    // 4. Query command history
    const historyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/control/devices/${deviceId}/commands`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(historyRes.statusCode).toBe(200);
    const history = historyRes.json() as Array<{ commandId: string }>;
    expect(history.length).toBeGreaterThan(0);

    // 5. Query audit logs
    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/v1/control/audit?deviceId=${deviceId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(auditRes.statusCode).toBe(200);
    const auditLogs = auditRes.json() as Array<{ action: string }>;
    expect(auditLogs.some((l) => l.action.includes('command'))).toBe(true);
  });
});
