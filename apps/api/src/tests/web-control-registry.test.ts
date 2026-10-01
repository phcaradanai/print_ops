import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { ControlTargetHttp } from '../services/control-target-http.js';
import {
  InMemoryDeviceRegistryRepository,
  InMemoryEnrollmentTokenRepository,
} from '../infra/repos/in-memory-control.repo.js';
import { WebControlRegistryService } from '../services/web-control-registry.service.js';

describe('WebControlRegistryService device freshness', () => {
  let previousClientUrl: string | undefined;

  beforeEach(() => {
    previousClientUrl = process.env['PRINTOPS_CLIENT_URL'];
    delete process.env['PRINTOPS_CLIENT_URL'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousClientUrl === undefined) {
      delete process.env['PRINTOPS_CLIENT_URL'];
    } else {
      process.env['PRINTOPS_CLIENT_URL'] = previousClientUrl;
    }
  });

  it('refreshes existing stations during device listing and hides superseded address-only records', async () => {
    const deviceRegistry = new InMemoryDeviceRegistryRepository();
    const service = new WebControlRegistryService({
      deviceRegistry,
      enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
    });
    const placeholder = await service.autoRegisterDevice({
      installationId: 'discovered_host.docker.internal_31415',
      hostname: 'host.docker.internal',
      platform: 'windows-x64',
      architecture: 'x64',
      appVersion: '0.1.31',
      displayName: 'host.docker.internal (Auto-Discovered)',
      ipAddresses: ['host.docker.internal'],
    });
    const staleAt = new Date(Date.now() - 15 * 60_000);
    await deviceRegistry.update(placeholder.deviceId, { lastSeenAt: staleAt });

    const fetchStation = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const requestUrl = typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
      if (requestUrl.hostname !== 'host.docker.internal') {
        return new Response('', { status: 503 });
      }
      if (requestUrl.pathname === '/health') {
        return Response.json({ status: 'ok', version: '0.1.31' });
      }
      if (requestUrl.pathname === '/api/v1/control/device-info') {
        return Response.json({
          installationId: 'inst_pc_nippon',
          hostname: 'pc_nippon',
          platform: 'windows-x64',
          architecture: 'x64',
          appVersion: '0.1.31',
          schemaVersion: 9,
          capabilities: ['ota', 'inventory-v1', 'content-sync-v1', 'content-pull-v1'],
        });
      }
      return new Response('', { status: 404 });
    });

    const firstList = await service.listDevices();
    expect(firstList).toHaveLength(1);
    expect(firstList[0]).toMatchObject({
      installationId: 'inst_pc_nippon',
      hostname: 'pc_nippon',
      connectionState: 'ONLINE',
      capabilities: ['ota', 'inventory-v1', 'content-sync-v1', 'content-pull-v1'],
    });
    expect(firstList[0]?.lastSeenAt?.getTime()).toBeGreaterThan(staleAt.getTime());

    const callsAfterRefresh = fetchStation.mock.calls.length;
    const secondList = await service.listDevices();
    expect(secondList).toHaveLength(1);
    expect(fetchStation).toHaveBeenCalledTimes(callsAfterRefresh);
  });

  it('does not reactivate a revoked record when the same station checks in again', async () => {
    const deviceRegistry = new InMemoryDeviceRegistryRepository();
    const service = new WebControlRegistryService({
      deviceRegistry,
      enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
    });
    const station = {
      installationId: 'inst_revoked_station',
      hostname: 'revoked-station',
      platform: 'windows-x64',
      architecture: 'x64',
      appVersion: '0.1.31',
    };
    const record = await service.autoRegisterDevice(station);
    await deviceRegistry.update(record.deviceId, { status: 'REVOKED' });

    const refreshed = await service.autoRegisterDevice(station);
    expect(refreshed.status).toBe('REVOKED');
  });

  it('hides a placeholder when the matching identified station is excluded by repository filters', async () => {
    const deviceRegistry = new InMemoryDeviceRegistryRepository();
    const service = new WebControlRegistryService({
      deviceRegistry,
      enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
    });
    await service.autoRegisterDevice({
      installationId: 'discovered_legacy_10.0.0.8',
      hostname: 'legacy-station',
      platform: 'windows-x64',
      architecture: 'x64',
      appVersion: '0.1.31',
      siteId: 'site-a',
      ipAddresses: ['10.0.0.8'],
    });
    await service.autoRegisterDevice({
      installationId: 'inst_identified_10.0.0.8',
      hostname: 'identified-station',
      platform: 'windows-x64',
      architecture: 'x64',
      appVersion: '0.1.31',
      siteId: 'site-b',
      ipAddresses: ['10.0.0.8'],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));

    const result = await service.listDevices({ siteId: 'site-a' });

    expect(result).toEqual([]);
  });

  it('keeps the health-probe abort timer active while reading the response body', async () => {
    const service = new WebControlRegistryService({
      deviceRegistry: new InMemoryDeviceRegistryRepository(),
      enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
    });
    const probeState: { signal?: AbortSignal; failResponseBody?: () => void } = {};
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Probe must use an abort signal');
        probeState.signal = signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const fail = () => controller.error(new Error('probe timed out'));
            probeState.failResponseBody = fail;
            signal.addEventListener('abort', fail, { once: true });
          },
        });
        return new Response(body);
      });

      const discovery = service.discoverDevices(['http://probe.test:31415']);
      await vi.advanceTimersByTimeAsync(2000);

      expect(probeState.signal?.aborted).toBe(true);
      await expect(discovery).resolves.toEqual([]);
    } finally {
      if (!probeState.signal?.aborted) probeState.failResponseBody?.();
      vi.useRealTimers();
    }
  });
});

describe('Control client discovery and reachability', () => {
  it('advertises content-pull support without letting a public probe claim liveness', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'printops-control-status-'));
    const identityPath = join(dataDir, 'device-identity.json');
    const otaTokenPath = join(dataDir, 'ota-health-token.txt');
    writeFileSync(identityPath, JSON.stringify({
      installationId: 'inst_enrolled_offline',
      siteId: 'test-site',
      deviceId: 'dev_enrolled_offline',
      deviceToken: 'devtok_test_only',
      createdAt: new Date().toISOString(),
    }));
    writeFileSync(otaTokenPath, 'test-ota-health-token');

    const environmentKeys = [
      'DB_MODE',
      'PRINTOPS_DEV_SEED',
      'PRINTOPS_DATA_DIR',
      'PRINTOPS_DEVICE_IDENTITY_PATH',
      'PRINTOPS_CONTROL_NATS_URL',
      'PRINTOPS_CONTROL_PUBLIC_NATS_URL',
      'PRINTOPS_CONTROL_ROLE',
      'PRINTOPS_OTA_HEALTH_TOKEN',
    ];
    const previousEnvironment = new Map<string, string | undefined>(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    let closeApp: (() => Promise<void>) | undefined;
    try {
      process.env['DB_MODE'] = 'memory';
      process.env['PRINTOPS_DEV_SEED'] = 'false';
      process.env['PRINTOPS_DATA_DIR'] = dataDir;
      process.env['PRINTOPS_DEVICE_IDENTITY_PATH'] = identityPath;
      process.env['PRINTOPS_OTA_HEALTH_TOKEN'] = 'test-ota-health-token';
      for (const key of ['PRINTOPS_CONTROL_NATS_URL', 'PRINTOPS_CONTROL_PUBLIC_NATS_URL', 'PRINTOPS_CONTROL_ROLE']) {
        delete process.env[key];
      }

      const built = await buildApp();
      closeApp = () => built.app.close();

      const offlineResponse = await built.app.inject({
        method: 'GET',
        url: '/api/v1/control/client-status',
      });
      expect(offlineResponse.json()).toMatchObject({
        isEnrolled: true,
        visibleToControlPlane: false,
        otaReady: false,
        connectionState: 'DISCONNECTED',
      });

      const deviceInfoResponse = await built.app.inject({ method: 'GET', url: '/api/v1/control/device-info' });
      expect(deviceInfoResponse.json()).toMatchObject({
        capabilities: expect.arrayContaining(['content-sync-v1', 'content-pull-v1']),
      });
      const probeOnlyResponse = await built.app.inject({
        method: 'GET',
        url: '/api/v1/control/client-status',
      });
      expect(probeOnlyResponse.json()).toMatchObject({
        isEnrolled: true,
        visibleToControlPlane: false,
        otaReady: false,
        connectionState: 'DISCONNECTED',
      });

      const rejectedHeartbeat = await built.app.inject({
        method: 'POST',
        url: '/api/v1/ota/control-agent-heartbeat',
        headers: { 'x-printops-ota-token': 'invalid-token' },
        remoteAddress: '127.0.0.1',
      });
      expect(rejectedHeartbeat.statusCode).toBe(401);

      const baseUrl = await built.app.listen({ port: 0, host: '127.0.0.1' });
      const controlTarget = new ControlTargetHttp(baseUrl, otaTokenPath);
      await controlTarget.recordControlAgentHeartbeat();

      const contactedResponse = await built.app.inject({
        method: 'GET',
        url: '/api/v1/control/client-status',
      });
      expect(contactedResponse.json()).toMatchObject({
        isEnrolled: true,
        visibleToControlPlane: true,
        otaReady: true,
        connectionState: 'ONLINE',
      });
    } finally {
      await closeApp?.();
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
