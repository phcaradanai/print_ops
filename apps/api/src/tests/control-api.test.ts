import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { hashPassword } from '../infra/auth/password.js';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { canonicalJson, OtaUpdateService, otaConfigFromEnv } from '../services/ota-update.service.js';
import { InMemoryOtaUpdateStateRepository } from '../infra/repos/in-memory-ota-state.repo.js';

function signedManifest(artifact: Buffer) {
  const keys = generateKeyPairSync('ed25519');
  const sha256 = createHash('sha256').update(artifact).digest('hex');
  const manifest = {
    schema_version: 1,
    release: { version: '0.1.38', channel: 'stable', release_date: '2026-11-11T00:00:00Z', notes: '' },
    artifacts: { desktop: { 'windows-x64': {
      url: 'PrintOps_0.1.38.exe', sha256, size: artifact.length, format: 'nsis-installer',
      signature: sign(null, Buffer.from(sha256, 'hex'), keys.privateKey).toString('base64'),
    } } },
    compatibility: { min_supported_version: '0.1.20', schema_version: 8 },
    rollout: { staged: false, rollout_percentage: 100 },
  };
  return { keys, envelope: { envelope_version: 1, manifest,
    signature: sign(null, Buffer.from(canonicalJson(manifest)), keys.privateKey).toString('base64') } };
}
describe('Web Control API Routes (Phase 1, 2, 3, 6, 8)', () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let viewerToken: string;
  let releasesDirectory: string;

  beforeEach(async () => {
    releasesDirectory = mkdtempSync(join(tmpdir(), 'printops-control-releases-'));
    process.env['PRINTOPS_RELEASES_DIR'] = releasesDirectory;
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
    delete process.env['PRINTOPS_RELEASES_DIR'];
    rmSync(releasesDirectory, { recursive: true, force: true });
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

  it.each(['OTA_CHECK', 'OTA_DOWNLOAD', 'OTA_INSTALL'] as const)(
    'resolves an imported release manifest to the public host for %s',
    async (type) => {
      const headers = { authorization: `Bearer ${ownerToken}`, host: 'printops.node1.ch3.local:8080' };
      const announced = await app.inject({
        method: 'POST', url: '/api/v1/control/announce',
        payload: { installationId: 'self-hosted-station', hostname: 'station', appVersion: '0.1.37', schemaVersion: 8 },
      });
      expect(announced.statusCode).toBe(200);
      const imported = await app.inject({
        method: 'POST', url: '/api/v1/control/releases/import', headers,
        payload: { version: '0.1.38', artifactUrl: 'https://releases.local/PrintOps.exe',
          signedManifest: signedManifest(Buffer.from('installer')).envelope },
      });
      expect(imported.statusCode).toBe(201);
      const command = await app.inject({
        method: 'POST', url: `/api/v1/control/devices/${announced.json().deviceId}/commands`, headers,
        payload: { type, targetVersion: '0.1.38', idempotencyKey: `self-hosted-${type}` },
      });
      expect(command.statusCode, command.body).toBe(202);
      expect(command.json().manifestUrl).toBe('http://printops.node1.ch3.local:8080/api/v1/control/releases/0.1.38/manifest.json');
    },
  );

  it('attaches a signed manifest to an existing installer and serves verifiable OTA files without an operator session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'printops-hosted-ota-'));
    vi.stubEnv('PRINTOPS_RELEASES_DIR', directory);
    const artifact = Buffer.from('signed-installer-content');
    const { envelope, keys } = signedManifest(artifact);
    const headers = { authorization: `Bearer ${ownerToken}` };
    try {
      const imported = await app.inject({
        method: 'POST', url: '/api/v1/control/releases/import', headers,
        payload: { version: '0.1.38', filename: 'uploaded-installer.exe', artifactBase64: artifact.toString('base64') },
      });
      expect(imported.statusCode).toBe(201);
      const id = imported.json().id;
      const station = await app.inject({ method: 'POST', url: '/api/v1/control/announce',
        payload: { installationId: 'unsigned-station', hostname: 'station', appVersion: '0.1.37', schemaVersion: 8 } });
      const blocked = await app.inject({
        method: 'POST', url: `/api/v1/control/devices/${station.json().deviceId}/commands`, headers,
        payload: { type: 'OTA_INSTALL', targetVersion: '0.1.38', idempotencyKey: 'missing-manifest' },
      });
      expect(blocked.statusCode).toBe(202);
      const attach = (signed: unknown, token = ownerToken) => app.inject({
        method: 'PUT', url: `/api/v1/control/releases/${id}/manifest`,
        headers: { authorization: `Bearer ${token}` }, payload: { signedManifest: signed },
      });
      expect((await attach(envelope, viewerToken)).statusCode).toBe(403);
      const bad = structuredClone(envelope);
      bad.manifest.artifacts.desktop['windows-x64'].sha256 = 'a'.repeat(64);
      expect((await attach(bad)).statusCode).toBe(400);
      expect((await attach(envelope)).statusCode).toBe(200);
      const manifestRes = await app.inject('/api/v1/control/releases/0.1.38/manifest.json');
      expect(manifestRes.statusCode).toBe(200);
      expect(manifestRes.json()).toEqual(envelope);
      expect(verify(null, Buffer.from(canonicalJson(manifestRes.json().manifest)), keys.publicKey,
        Buffer.from(manifestRes.json().signature, 'base64'))).toBe(true);
      const download = await app.inject('/api/v1/control/releases/0.1.38/PrintOps_0.1.38.exe');
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload).toEqual(artifact);
      const client = new OtaUpdateService({
        state: new InMemoryOtaUpdateStateRepository(),
        config: {
          enabled: true, channel: 'stable', currentVersion: '0.1.37', currentSchemaVersion: 8,
          cacheDir: join(directory, 'client-cache'), manifestTimeoutMs: 1_000, downloadTimeoutMs: 1_000,
          maxArtifactBytes: 1_000_000, requireSignature: true,
          publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        },
        fetchImpl: async (input) => {
          const url = new URL(input);
          const response = await app.inject(`${url.pathname}${url.search}`);
          return new Response(new Uint8Array(response.rawPayload), { status: response.statusCode });
        },
      });
      const checked = await client.checkForUpdate('http://printops.node1.ch3.local/api/v1/control/releases/0.1.38/manifest.json');
      expect(checked.available).toBe(true);
      const staged = await client.downloadUpdate({
        version: '0.1.38', component: 'desktop', platform: 'windows-x64',
        manifestUrl: 'http://printops.node1.ch3.local/api/v1/control/releases/0.1.38/manifest.json',
      });
      expect(staged.signatureVerification).toBe('verified');
      expect((await app.inject('/api/v1/control/releases/0.1.38/secret.db')).statusCode).toBe(404);
      expect((await app.inject(`/api/v1/control/releases/${id}/download`)).statusCode).toBe(401);
      await app.inject({ method: 'PATCH', url: `/api/v1/control/releases/${id}`, headers, payload: { status: 'REVOKED' } });
      expect((await app.inject('/api/v1/control/releases/0.1.38/manifest.json')).statusCode).toBe(403);
      expect((await app.inject('/api/v1/control/releases/0.1.38/PrintOps_0.1.38.exe')).statusCode).toBe(403);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('updates from only an uploaded installer with no manifest or publisher key', async () => {
    const artifact = Buffer.from('unsigned-self-hosted-installer');
    const headers = { authorization: `Bearer ${ownerToken}`, host: 'printops.local:8080' };
    const imported = await app.inject({ method: 'POST', url: '/api/v1/control/releases/import', headers,
      payload: { version: '0.1.38', filename: 'PrintOps_0.1.38.exe', artifactBase64: artifact.toString('base64') } });
    expect(imported.statusCode).toBe(201);
    const station = await app.inject({ method: 'POST', url: '/api/v1/control/announce',
      payload: { installationId: 'exe-only-station', hostname: 'station', appVersion: '0.1.37', schemaVersion: 8 } });
    const command = await app.inject({ method: 'POST', url: `/api/v1/control/devices/${station.json().deviceId}/commands`, headers,
      payload: { type: 'OTA_INSTALL', targetVersion: '0.1.38', idempotencyKey: 'exe-only-install' } });
    expect(command.statusCode, command.body).toBe(202);
    const config = otaConfigFromEnv({ PRINTOPS_OTA_ENABLED: 'true', PRINTOPS_APP_VERSION: '0.1.37',
      PRINTOPS_DB_SCHEMA_VERSION: '8', PRINTOPS_OTA_DATA_DIR: releasesDirectory });
    const client = new OtaUpdateService({
      state: new InMemoryOtaUpdateStateRepository(), config,
      fetchImpl: async (input) => {
        const response = await app.inject(new URL(input).pathname);
        return new Response(new Uint8Array(response.rawPayload), { status: response.statusCode });
      },
      installer: { install: async () => undefined, healthCheck: async () => true, rollback: async () => undefined },
    });
    const staged = await client.downloadUpdate({ version: '0.1.38', manifestUrl: command.json().manifestUrl });
    expect(staged.downloaded).toBe(true);
    expect(staged.sha256).toBe(createHash('sha256').update(artifact).digest('hex'));
    const installed = await client.installUpdate({ version: '0.1.38', manifestUrl: command.json().manifestUrl });
    expect(installed.installed).toBe(true);
  });

  it.each([
    ['/v1/control/releases/0.1.38/manifest.json', 'https://printops.node1.ch3.local:8443/api/v1/control/releases/0.1.38/manifest.json'],
    ['https://cdn.local/manifest.json', 'https://cdn.local/manifest.json'],
    ['https://user:secret@cdn.local/manifest.json', undefined],
    ['file:///data/releases/manifest.json', undefined],
  ])('uses a configured public origin without weakening URL validation: %s', async (manifestRef, expected) => {
    vi.stubEnv('PRINTOPS_CONTROL_PUBLIC_HTTP_URL', 'https://printops.node1.ch3.local:8443');
    try {
      const headers = { authorization: `Bearer ${ownerToken}`, host: 'api:3001' };
      const announced = await app.inject({
        method: 'POST', url: '/api/v1/control/announce',
        payload: { installationId: 'proxy-station', hostname: 'station', appVersion: '0.1.37', schemaVersion: 8 },
      });
      const release = await app.inject({
        method: 'POST', url: '/api/v1/control/releases', headers,
        payload: {
          version: '0.1.38', channel: 'stable', platform: 'windows-x64', architecture: 'x64', schemaVersion: 8,
          manifestRef, artifactRef: 'https://cdn.local/setup.exe', sha256: createHash('sha256').update('installer').digest('hex'), signature: 'sig',
        },
      });
      expect(release.statusCode).toBe(201);
      if (manifestRef.startsWith('/')) {
        const attached = await app.inject({
          method: 'PUT', url: `/api/v1/control/releases/${release.json().id}/manifest`, headers,
          payload: { signedManifest: signedManifest(Buffer.from('installer')).envelope },
        });
        expect(attached.statusCode, attached.body).toBe(200);
      }
      const command = await app.inject({
        method: 'POST', url: `/api/v1/control/devices/${announced.json().deviceId}/commands`, headers,
        payload: { type: 'OTA_CHECK', idempotencyKey: 'proxy-check' },
      });
      expect(command.statusCode, command.body).toBe(expected ? 202 : 400);
      if (expected) expect(command.json().manifestUrl).toBe(expected);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('routes a legacy node-bundle manifest to its own platform after attachment', async () => {
    const { envelope, keys } = signedManifest(Buffer.from('installer'));
    const manifest = { ...envelope.manifest, artifacts: {
      api: { 'node-bundle': { ...envelope.manifest.artifacts.desktop['windows-x64'], format: 'archive' } },
    } };
    const signed = { envelope_version: 1, manifest,
      signature: sign(null, Buffer.from(canonicalJson(manifest)), keys.privateKey).toString('base64') };
    const headers = { authorization: `Bearer ${ownerToken}`, host: 'printops.local:8080' };
    const registered = await app.inject({ method: 'POST', url: '/api/v1/control/releases', headers,
      payload: { version: '0.1.38', channel: 'stable', platform: 'node-bundle', architecture: 'x64', schemaVersion: 8,
        manifestRef: '/v1/control/releases/0.1.38/manifest.json', artifactRef: '/data/node.tar.gz',
        sha256: manifest.artifacts.api['node-bundle'].sha256, signature: manifest.artifacts.api['node-bundle'].signature } });
    expect(registered.statusCode).toBe(201);
    const attached = await app.inject({ method: 'PUT', url: `/api/v1/control/releases/${registered.json().id}/manifest`,
      headers, payload: { signedManifest: signed } });
    expect(attached.statusCode).toBe(200);
    const station = await app.inject({ method: 'POST', url: '/api/v1/control/announce',
      payload: { installationId: 'node-station', hostname: 'station', platform: 'node-bundle', appVersion: '0.1.37', schemaVersion: 8 } });
    const command = await app.inject({ method: 'POST', url: `/api/v1/control/devices/${station.json().deviceId}/commands`,
      headers, payload: { type: 'OTA_CHECK', idempotencyKey: 'node-check' } });
    expect(command.statusCode).toBe(202);
    expect(command.json().manifestUrl).toBe('http://printops.local:8080/api/v1/control/releases/0.1.38/node-bundle/manifest.json');
    const response = await app.inject(new URL(command.json().manifestUrl).pathname);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(signed);
  });

  it.each([true, false])('repairs only a legacy URL hash when attaching a manifest (placeholder: %s)', async (placeholder) => {
    const { envelope } = signedManifest(Buffer.from('installer'));
    const headers = { authorization: `Bearer ${ownerToken}` };
    const imported = await app.inject({ method: 'POST', url: '/api/v1/control/releases/import', headers,
      payload: { version: '0.1.38', artifactUrl: 'https://cdn.local/setup.exe',
        ...(placeholder ? {} : { sha256: 'b'.repeat(64) }) } });
    expect(imported.statusCode).toBe(201);
    const attached = await app.inject({ method: 'PUT', url: `/api/v1/control/releases/${imported.json().id}/manifest`,
      headers, payload: { signedManifest: envelope } });
    expect(attached.statusCode, attached.body).toBe(placeholder ? 200 : 400);
    const catalog = await app.inject({ method: 'GET', url: '/api/v1/control/releases', headers });
    expect(catalog.json()[0].sha256).toBe(placeholder ? envelope.manifest.artifacts.desktop['windows-x64'].sha256 : 'b'.repeat(64));
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
    const releaseId = (releaseRes.json() as { id: string }).id;

    const newerReleaseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/releases',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        version: '0.1.30',
        channel: 'stable',
        platform: 'windows-x64',
        architecture: 'x64',
        schemaVersion: 8,
        manifestRef: 'https://releases.local/manifest-0.1.30.json',
        artifactRef: 'https://releases.local/artifact-0.1.30.exe',
        sha256: 'hash130',
        signature: 'sig130',
        minSupportedVersion: '0.1.20',
      },
    });
    expect(newerReleaseRes.statusCode).toBe(201);
    const newerPayload = newerReleaseRes.json();
    const release30Id = typeof newerPayload === 'object' && newerPayload && 'id' in newerPayload ? String(newerPayload.id) : '';
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/control/devices/${deviceId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(detailRes.statusCode).toBe(200);
    expect((detailRes.json() as { compatibleReleases: Array<{ version: string }> }).compatibleReleases.map((item) => item.version))
      .toEqual(['0.1.30', '0.1.29']);

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
    const cmdJson = cmdRes.json() as { commandId: string; type: string; targetVersion: string };
    expect(cmdJson.commandId).toMatch(/^cmd_/);
    expect(cmdJson.targetVersion).toBe('0.1.29');
    expect(cmdRes.json().manifestUrl).toBe('https://releases.local/manifest.json');

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

    const revokeRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/control/releases/${releaseId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { status: 'REVOKED' },
    });
    expect(revokeRes.statusCode).toBe(200);
    // 6. Test download releases
    const latestRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/releases/latest',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(latestRes.statusCode).toBe(200);
    const latestPayload = latestRes.json();
    expect(typeof latestPayload === 'object' && latestPayload && 'version' in latestPayload ? latestPayload.version : '').toBe('0.1.30');

    const latestDownloadRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/releases/latest/download',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(latestDownloadRes.statusCode).toBe(302);
    expect(latestDownloadRes.headers['location']).toBe('https://releases.local/artifact-0.1.30.exe');

    // Download with token query param
    const tokenDownloadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/control/releases/${release30Id}/download?token=${ownerToken}`,
    });
    expect(tokenDownloadRes.statusCode).toBe(302);
    expect(tokenDownloadRes.headers['location']).toBe('https://releases.local/artifact-0.1.30.exe');

    // Revoked release cannot be downloaded
    const revokedDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/control/releases/${releaseId}/download`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(revokedDownload.statusCode).toBe(403);

    // Local file artifact download
    const tmpDir = mkdtempSync(join(tmpdir(), 'printops-artifact-test-'));
    const tmpArtifact = join(tmpDir, 'PrintOps_0.1.31_x64-setup.exe');
    writeFileSync(tmpArtifact, 'fake-printops-executable-data');
    try {
      const localReleaseRes = await app.inject({
        method: 'POST',
        url: '/api/v1/control/releases',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          version: '0.1.31',
          channel: 'stable',
          platform: 'windows-x64',
          architecture: 'x64',
          schemaVersion: 8,
          manifestRef: 'https://releases.local/manifest-0.1.31.json',
          artifactRef: tmpArtifact,
          sha256: 'hash131',
          signature: 'sig131',
          minSupportedVersion: '0.1.20',
        },
      });
      expect(localReleaseRes.statusCode).toBe(201);
      const localReleasePayload = localReleaseRes.json();
      const localReleaseId = typeof localReleasePayload === 'object' && localReleasePayload && 'id' in localReleasePayload ? String(localReleasePayload.id) : '';

      const localDownloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/control/releases/${localReleaseId}/download`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(localDownloadRes.statusCode).toBe(200);
      expect(localDownloadRes.headers['content-disposition']).toContain('attachment; filename="PrintOps_0.1.31_x64-setup.exe"');
      expect(localDownloadRes.headers['content-type']).toBe('application/octet-stream');
      expect(localDownloadRes.body).toBe('fake-printops-executable-data');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    const revokedInstall = await app.inject({
      method: 'POST',
      url: `/api/v1/control/devices/${deviceId}/commands`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { type: 'OTA_INSTALL', targetVersion: '0.1.29', idempotencyKey: 'idem_revoked_release' },
    });
    expect(revokedInstall.statusCode).toBe(409);

    // Test download by version query
    const versionDownloadRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/releases/latest/download?version=0.1.30',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(versionDownloadRes.statusCode).toBe(302);
    expect(versionDownloadRes.headers['location']).toBe('https://releases.local/artifact-0.1.30.exe');

    const aliasDownloadRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/releases/download?version=0.1.30',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(aliasDownloadRes.statusCode).toBe(302);
    expect(aliasDownloadRes.headers['location']).toBe('https://releases.local/artifact-0.1.30.exe');

    // Test importing a release via POST /control/releases/import
    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/releases/import',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        filename: 'PrintOps_Setup_v0.1.32_windows-x64.exe',
        artifactBase64: Buffer.from('mock-installer-binary-data').toString('base64'),
        version: '0.1.32',
        platform: 'windows-x64',
        isLts: true,
        isLatest: true,
        releaseNotes: 'Imported 0.1.32 with LTS',
      },
    });
    expect(importRes.statusCode).toBe(201);
    const importedRelease = importRes.json();
    expect(importedRelease && typeof importedRelease === 'object' && 'version' in importedRelease ? importedRelease.version : '').toBe('0.1.32');
    expect(importedRelease && typeof importedRelease === 'object' && 'isLts' in importedRelease ? importedRelease.isLts : false).toBe(true);
    expect(importedRelease && typeof importedRelease === 'object' && 'isLatest' in importedRelease ? importedRelease.isLatest : false).toBe(true);

    // Verify GET /control/releases/lts returns the imported LTS release
    const ltsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/releases/lts',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ltsRes.statusCode).toBe(200);
    const ltsJson = ltsRes.json();
    expect(ltsJson && typeof ltsJson === 'object' && 'version' in ltsJson ? ltsJson.version : '').toBe('0.1.32');

    // Verify setting another release as latest
    const setLatestRes = await app.inject({
      method: 'POST',
      url: `/api/v1/control/releases/${release30Id}/set-latest`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(setLatestRes.statusCode).toBe(200);
    const setLatestJson = setLatestRes.json();
    expect(setLatestJson && typeof setLatestJson === 'object' && 'isLatest' in setLatestJson ? setLatestJson.isLatest : false).toBe(true);

    // GET /control/releases/latest now returns 0.1.30
    const latestAfterRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/releases/latest',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const latestAfterJson = latestAfterRes.json();
    expect(latestAfterJson && typeof latestAfterJson === 'object' && 'version' in latestAfterJson ? latestAfterJson.version : '').toBe('0.1.30');
  });

  it('imports an installer exceeding the shared body limit without raising other route limits', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'printops-large-import-'));
    const headers = { authorization: `Bearer ${ownerToken}` };
    const artifact = Buffer.alloc(10 * 1024 * 1024, 0x5a);
    const payload = {
      filename: 'PrintOps_Setup_v0.1.99_windows-x64.exe',
      artifactBase64: artifact.toString('base64'),
      version: '0.1.99',
      platform: 'windows-x64',
    };
    try {
      const settings = await app.inject({
        method: 'PATCH',
        url: '/api/v1/control/storage-settings',
        headers,
        payload: { provider: 'local', localPath: tmpDir },
      });
      expect(settings.statusCode).toBe(200);

      const imported = await app.inject({
        method: 'POST',
        url: '/api/v1/control/releases/import',
        headers,
        payload,
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json().version).toBe('0.1.99');
      expect(readFileSync(join(tmpDir, payload.filename))).toEqual(artifact);

      const otherRoute = await app.inject({
        method: 'POST',
        url: '/api/v1/control/releases',
        headers,
        payload,
      });
      expect(otherRoute.statusCode).toBe(413);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('allows zero-token device announcement and network discovery', async () => {
    // 1. Announce a station directly without an enrollment token
    const announceRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/announce',
      payload: {
        installationId: 'inst_auto_counter_01',
        hostname: 'pharmacy-counter-1',
        platform: 'windows-x64',
        architecture: 'x64',
        appVersion: '0.1.31',
        schemaVersion: 8,
      },
    });
    expect(announceRes.statusCode).toBe(200);
    const announceJson = announceRes.json() as { deviceId: string; status: string };
    expect(announceJson.deviceId).toBeDefined();
    expect(announceJson.status).toBe('ONLINE');

    // 2. Verify device is present in device list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/devices',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const devices = listRes.json() as Array<{ deviceId: string; hostname: string }>;
    expect(devices.some((d) => d.deviceId === announceJson.deviceId && d.hostname === 'pharmacy-counter-1')).toBe(true);

    // 3. Discovery endpoint
    const discoverRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/devices/discover',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { targets: ['http://invalid-probe-host:31415'] },
    });
    expect(discoverRes.statusCode).toBe(200);
    expect((discoverRes.json() as { discoveredCount: number }).discoveredCount).toBe(0);

    // 4. Client status endpoint
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/client-status',
    });
    expect(statusRes.statusCode).toBe(200);
    const clientStatus = statusRes.json();
    expect(clientStatus && typeof clientStatus === 'object' && 'visibleToControlPlane' in clientStatus).toBe(true);
    expect(clientStatus && typeof clientStatus === 'object' && 'otaReady' in clientStatus).toBe(true);

    // 5. Storage settings endpoints
    const getStorageRes = await app.inject({
      method: 'GET',
      url: '/api/v1/control/storage-settings',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(getStorageRes.statusCode).toBe(200);
    const storageJson = getStorageRes.json();
    expect(storageJson && typeof storageJson === 'object' && 'provider' in storageJson).toBe(true);

    // Dynamically patch storage settings (e.g. localPath)
    const patchStorageRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/control/storage-settings',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        localPath: '/data/dynamic-releases',
      },
    });
    expect(patchStorageRes.statusCode).toBe(200);
    const patchedStorage = patchStorageRes.json();
    expect(patchedStorage && typeof patchedStorage === 'object' && 'localPath' in patchedStorage ? patchedStorage.localPath : '').toBe('/data/dynamic-releases');

    // Test storage connection endpoint
    const testStorageRes = await app.inject({
      method: 'POST',
      url: '/api/v1/control/storage-settings/test',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        provider: 'local',
        localPath: './data/test-storage',
      },
    });
    expect(testStorageRes.statusCode).toBe(200);
    const testResult = testStorageRes.json();
    expect(testResult && typeof testResult === 'object' && 'ok' in testResult ? testResult.ok : false).toBe(true);
  });
});

describe('Web Control import size configuration', () => {
  let app: FastifyInstance | undefined;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'printops-import-limit-'));
    vi.stubEnv('DB_MODE', 'memory');
    vi.stubEnv('PRINTOPS_DEV_SEED', 'true');
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('PRINTOPS_RELEASES_DIR', tmpDir);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each([
    { limit: '8', expectedStatus: 413 },
    { limit: '16', expectedStatus: 201 },
  ])('applies a $limit MiB request limit to installer import', async ({ limit, expectedStatus }) => {
    vi.stubEnv('PRINTOPS_RELEASE_IMPORT_MAX_MIB', limit);
    app = (await buildApp()).app;
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'sysadmin@printerops.local', password: 'Dev-password1!' },
    });
    expect(loginRes.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${loginRes.json().token}` };
    const artifact = Buffer.alloc(10 * 1024 * 1024, 0x5a);
    const filename = 'PrintOps_Setup_v0.1.99_windows-x64.exe';
    const payload = {
      filename,
      artifactBase64: artifact.toString('base64'),
      version: '0.1.99',
      platform: 'windows-x64',
    };
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/control/releases/import',
      headers,
      payload,
    });
    expect(imported.statusCode).toBe(expectedStatus);
    if (expectedStatus === 201) {
      expect(readFileSync(join(tmpDir, filename))).toEqual(artifact);
    } else {
      expect(existsSync(join(tmpDir, filename))).toBe(false);
    }
    const otherRoute = await app.inject({
      method: 'POST',
      url: '/api/v1/control/releases',
      headers,
      payload,
    });
    expect(otherRoute.statusCode).toBe(413);
  });
});
