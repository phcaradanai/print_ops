import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ControlSyncedJob } from '@printerops/domain';
import type { OtaUpdateServicePort } from '../services/ota-update.service.js';
import { buildApp } from '../app.js';
import { stationJobMirrorGuard } from '../routes/v1/control.routes.js';
import { DeviceIdentityStore } from '../services/device-identity.js';
import {
  HEARTBEAT_MAX_JOBS,
  PrintOpsControlAgent,
  selectHeartbeatJobs,
} from '../services/control-agent.service.js';
import {
  defaultDiscoveryTargets,
  sameStationIdentity,
  stationBaseUrl,
  WebControlRegistryService,
} from '../services/web-control-registry.service.js';
import {
  deriveJobMirrorCredential,
  deriveJobMirrorCredentialFromToken,
  hashDeviceToken,
} from '../services/control-message-auth.js';
import {
  InMemoryDeviceRegistryRepository,
  InMemoryEnrollmentTokenRepository,
} from '../infra/repos/in-memory-control.repo.js';

function syncedJob(id: string, createdAt: string, extra: Partial<ControlSyncedJob> = {}): ControlSyncedJob {
  return {
    id,
    deviceId: 'dev_station',
    printerId: 'printer-1',
    status: 'SUCCESS',
    copies: 1,
    payload: { hn: 'HN-1' },
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

function fakeOtaService(): OtaUpdateServicePort {
  return {
    getStatus: vi.fn().mockResolvedValue({
      enabled: true,
      configured: true,
      currentVersion: '0.1.47',
      currentSchemaVersion: 11,
      channel: 'stable',
      signatureVerification: 'required',
      installerConfigured: true,
      state: {
        state: 'IDLE',
        targetVersion: null,
        startedAt: null,
        updatedAt: new Date(),
        errorMessage: null,
        retryCount: 0,
      },
      stagedArtifact: null,
    }),
  } as unknown as OtaUpdateServicePort;
}

describe('station heartbeat job mirror', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'printops-job-sync-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('selectHeartbeatJobs', () => {
    it('sends only jobs updated after the watermark, newest first', () => {
      const jobs = [
        syncedJob('job-old', '2026-01-01T00:00:00.000Z'),
        syncedJob('job-new', '2026-01-01T00:05:00.000Z'),
        syncedJob('job-mid', '2026-01-01T00:02:00.000Z'),
      ];
      const since = Date.parse('2026-01-01T00:01:00.000Z');
      const selection = selectHeartbeatJobs(jobs, { since });
      expect(selection.jobs.map((job) => job.id)).toEqual(['job-new', 'job-mid']);
      expect(selection.nextSince).toBe(Date.parse('2026-01-01T00:05:00.000Z'));
    });

    it('sends an empty list when nothing changed, keeping the watermark', () => {
      const since = Date.parse('2026-01-01T00:10:00.000Z');
      const selection = selectHeartbeatJobs([syncedJob('job-old', '2026-01-01T00:00:00.000Z')], { since });
      expect(selection.jobs).toEqual([]);
      expect(selection.nextSince).toBe(since);
    });

    it('re-sends the newest jobs when a forced resync is requested', () => {
      const since = Date.parse('2026-01-01T00:10:00.000Z');
      const selection = selectHeartbeatJobs([syncedJob('job-old', '2026-01-01T00:00:00.000Z')], {
        since,
        force: true,
      });
      expect(selection.jobs.map((job) => job.id)).toEqual(['job-old']);
    });

    it('caps the number of jobs per heartbeat', () => {
      const jobs = Array.from({ length: HEARTBEAT_MAX_JOBS + 25 }, (_, index) =>
        syncedJob(`job-${index}`, new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * 1000).toISOString()));
      const selection = selectHeartbeatJobs(jobs, { since: 0 });
      expect(selection.jobs).toHaveLength(HEARTBEAT_MAX_JOBS);
    });

    it('respects the byte budget so a large job cannot overflow the heartbeat', () => {
      const huge = syncedJob('job-huge', '2026-01-01T00:02:00.000Z', {
        payload: { blob: 'x'.repeat(4_096) },
      });
      const small = syncedJob('job-small', '2026-01-01T00:01:00.000Z');
      // The oversized job is skipped, and the small one that fits is still sent.
      const selection = selectHeartbeatJobs([huge, small], { since: 0, maxBytes: 3_000 });
      expect(selection.jobs.map((job) => job.id)).toEqual(['job-small']);
      // A lone oversized job never overflows the heartbeat on its own.
      const onlyHuge = selectHeartbeatJobs([huge], { since: 0, maxBytes: 3_000 });
      expect(onlyHuge.jobs).toEqual([]);
    });

    it('tolerates a missing or invalid job list', () => {
      expect(selectHeartbeatJobs([], { since: 0 }).jobs).toEqual([]);
      expect(selectHeartbeatJobs(undefined as unknown as ControlSyncedJob[], { since: 0 }).jobs).toEqual([]);
    });
  });

  describe('buildHeartbeat', () => {
    function makeAgent(getRecentSyncedJobs?: () => Promise<ControlSyncedJob[]>) {
      const identityStore = new DeviceIdentityStore({
        storagePath: join(tempDir, `identity-${Math.random().toString(16).slice(2)}.json`),
      });
      identityStore.recordEnrollment('dev_heartbeat', 'devtok_heartbeat', 'site-1');
      return new PrintOpsControlAgent({
        identityStore,
        otaService: fakeOtaService(),
        ...(getRecentSyncedJobs ? { getRecentSyncedJobs } : {}),
      });
    }

    it('omits recentJobs entirely when the station does not report jobs', async () => {
      const heartbeat = await makeAgent().buildHeartbeat();
      expect('recentJobs' in heartbeat).toBe(false);
    });

    it('carries this station\'s jobs so Web Control can mirror them without an inbound pull', async () => {
      const agent = makeAgent(async () => [syncedJob('job-1', '2026-01-01T00:00:00.000Z')]);
      const heartbeat = await agent.buildHeartbeat();
      expect(heartbeat.recentJobs?.map((job) => job.id)).toEqual(['job-1']);
    });

    it('does not resend unchanged jobs on the next heartbeat', async () => {
      const jobs = [syncedJob('job-1', '2026-01-01T00:00:00.000Z')];
      const provider = vi.fn(async () => jobs);
      const agent = makeAgent(provider);
      const first = await agent.buildHeartbeat();
      expect(first.recentJobs).toHaveLength(1);
      const second = await agent.buildHeartbeat();
      expect(second.recentJobs).toEqual([]);

      jobs.push(syncedJob('job-2', '2026-01-01T00:01:00.000Z'));
      const third = await agent.buildHeartbeat();
      expect(third.recentJobs?.map((job) => job.id)).toEqual(['job-2']);
    });

    it('still sends the heartbeat when the job repository fails', async () => {
      const agent = makeAgent(async () => {
        throw new Error('database unavailable');
      });
      const heartbeat = await agent.buildHeartbeat();
      expect(heartbeat.deviceId).toBe('dev_heartbeat');
      expect('recentJobs' in heartbeat).toBe(false);
    });
  });

  describe('station address helpers', () => {
    it('keeps a discovered port instead of assuming 31415', () => {
      expect(stationBaseUrl('app:3001')).toBe('http://app:3001');
      expect(stationBaseUrl('http://app:3001/')).toBe('http://app:3001');
      expect(stationBaseUrl('10.0.0.5')).toBe('http://10.0.0.5:31415');
      expect(stationBaseUrl('localhost')).toBe('http://localhost:31415');
    });

    it('derives one pull credential per device, so a control plane needs no per-station secret', () => {
      const tokenA = 'devtok_station_a';
      const tokenB = 'devtok_station_b';
      const hashA = hashDeviceToken(tokenA);

      expect(deriveJobMirrorCredentialFromToken(tokenA, 'dev_a')).toBe(deriveJobMirrorCredential(hashA, 'dev_a'));
      // Different station, different token, or different device id all change the value.
      expect(deriveJobMirrorCredentialFromToken(tokenB, 'dev_a')).not.toBe(deriveJobMirrorCredential(hashA, 'dev_a'));
      expect(deriveJobMirrorCredentialFromToken(tokenA, 'dev_b')).not.toBe(deriveJobMirrorCredential(hashA, 'dev_a'));
      expect(() => deriveJobMirrorCredential('not-a-hash', 'dev_a')).toThrow();
    });

    it('rejects a job mirror that belongs to a different installation', () => {
      expect(sameStationIdentity('inst_a', 'inst_a')).toBe(true);
      expect(sameStationIdentity('inst_a', 'inst_b')).toBe(false);
      // Older stations do not report an identity; accept rather than block them.
      expect(sameStationIdentity('inst_a', undefined)).toBe(true);
      expect(sameStationIdentity(undefined, 'inst_b')).toBe(true);
    });
  });

  describe('heartbeat intake on the control plane', () => {
    it('stores the jobs a station reports in its heartbeat, which is the NAT-safe path', async () => {
      const deviceRegistry = new InMemoryDeviceRegistryRepository();
      const service = new WebControlRegistryService({
        deviceRegistry,
        enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
      });
      const device = await service.autoRegisterDevice({
        installationId: 'inst_enrolled_workstation',
        hostname: 'opd-pc-01',
        platform: 'windows-x64',
        architecture: 'x64',
        appVersion: '0.1.47',
      });

      await service.recordHeartbeat({
        deviceId: device.deviceId,
        installationId: 'inst_enrolled_workstation',
        siteId: 'default-site',
        hostname: 'opd-pc-01',
        platform: 'windows-x64',
        architecture: 'x64',
        appVersion: '0.1.47',
        schemaVersion: 11,
        runnerVersion: '0.1.47',
        runnerStatus: 'RUNNING',
        printReadinessSummary: 'READY',
        printState: 'IDLE',
        otaState: 'IDLE',
        lastOtaOperation: null,
        timestamp: new Date().toISOString(),
        recentJobs: [syncedJob('job-heartbeat-1', '2026-01-01T00:00:00.000Z')],
      } as Parameters<typeof service.recordHeartbeat>[0]);

      const jobs = await service.getDeviceJobs(device.deviceId);
      expect(jobs.map((job) => job.id)).toEqual(['job-heartbeat-1']);
    });
  });

  describe('job pull from a reachable station', () => {
    it('pulls from the discovered host and port and stores the jobs', async () => {
      const deviceRegistry = new InMemoryDeviceRegistryRepository();
      const service = new WebControlRegistryService({
        deviceRegistry,
        enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
      });
      const device = await service.autoRegisterDevice({
        installationId: 'inst_app_container',
        hostname: 'printops-app',
        platform: 'linux-x64',
        architecture: 'x64',
        appVersion: '0.1.47',
        ipAddresses: ['app:3001'],
      });

      const requested: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : String(input);
        requested.push(url);
        return Response.json({
          deviceId: 'unregistered_station',
          installationId: 'inst_app_container',
          jobs: [syncedJob('job-remote', '2026-01-01T00:00:00.000Z')],
        });
      });

      const jobs = await service.syncJobsFromReachableDevice(device);
      expect(requested).toEqual(['http://app:3001/api/v1/control/local-jobs']);
      expect(jobs.map((job) => job.id)).toEqual(['job-remote']);
    });

    it('does not file another station\'s jobs under this device', async () => {
      const deviceRegistry = new InMemoryDeviceRegistryRepository();
      const service = new WebControlRegistryService({
        deviceRegistry,
        enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
      });
      const device = await service.autoRegisterDevice({
        installationId: 'inst_this_station',
        hostname: 'printops-app',
        platform: 'linux-x64',
        architecture: 'x64',
        appVersion: '0.1.47',
        ipAddresses: ['app:3001'],
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        Response.json({
          installationId: 'inst_some_other_station',
          jobs: [syncedJob('job-wrong', '2026-01-01T00:00:00.000Z')],
        }));

      const jobs = await service.syncJobsFromReachableDevice(device);
      expect(jobs).toEqual([]);
    });

    it('presents a credential both sides derive, so an enrolled station needs no configuration', async () => {
      const previous = process.env['PRINTOPS_CONTROL_PULL_TOKEN'];
      delete process.env['PRINTOPS_CONTROL_PULL_TOKEN'];
      try {
        const deviceRegistry = new InMemoryDeviceRegistryRepository();
        const service = new WebControlRegistryService({
          deviceRegistry,
          enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
        });
        const token = 'devtok_enrolled_station';
        const device = await service.autoRegisterDevice({
          installationId: 'inst_enrolled_for_pull',
          hostname: 'opd-pc-01',
          platform: 'windows-x64',
          architecture: 'x64',
          appVersion: '0.1.47',
          ipAddresses: ['10.0.0.7:31415'],
        });
        await deviceRegistry.update(device.deviceId, { deviceTokenHash: hashDeviceToken(token) });

        const headers: Array<Record<string, string>> = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
          headers.push((init?.headers ?? {}) as Record<string, string>);
          return Response.json({
            installationId: 'inst_enrolled_for_pull',
            jobs: [syncedJob('job-derived', '2026-01-01T00:00:00.000Z')],
          });
        });

        const refreshed = await deviceRegistry.findById(device.deviceId);
        await service.syncJobsFromReachableDevice(refreshed!);

        // The station computes the same value from the token it already holds.
        const stationSide = deriveJobMirrorCredentialFromToken(token, device.deviceId);
        expect(headers[0]?.['x-control-pull-token']).toBe(stationSide);
        expect(await service.getDeviceJobs(device.deviceId)).toHaveLength(1);
      } finally {
        if (previous !== undefined) process.env['PRINTOPS_CONTROL_PULL_TOKEN'] = previous;
      }
    });

    it('prefers the shared token when configured, because every station accepts it', async () => {
      const previous = process.env['PRINTOPS_CONTROL_PULL_TOKEN'];
      process.env['PRINTOPS_CONTROL_PULL_TOKEN'] = 'pull-secret';
      try {
        const deviceRegistry = new InMemoryDeviceRegistryRepository();
        const service = new WebControlRegistryService({
          deviceRegistry,
          enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
        });
        const discovered = await service.autoRegisterDevice({
          installationId: 'discovered_app_3001',
          hostname: 'printops-app',
          platform: 'linux-x64',
          architecture: 'x64',
          appVersion: '0.1.47',
          ipAddresses: ['app:3001'],
        });

        const headers: Array<Record<string, string>> = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
          headers.push((init?.headers ?? {}) as Record<string, string>);
          return Response.json({
            installationId: 'discovered_app_3001',
            jobs: [syncedJob('job-shared', '2026-01-01T00:00:00.000Z')],
          });
        });

        await service.syncJobsFromReachableDevice(discovered);
        expect(headers[0]?.['x-control-pull-token']).toBe('pull-secret');
      } finally {
        if (previous === undefined) delete process.env['PRINTOPS_CONTROL_PULL_TOKEN'];
        else process.env['PRINTOPS_CONTROL_PULL_TOKEN'] = previous;
      }
    });
  });

  describe('sweeping every known station', () => {
    it('pulls from all known stations, not one configured target', async () => {
      const deviceRegistry = new InMemoryDeviceRegistryRepository();
      const service = new WebControlRegistryService({
        deviceRegistry,
        enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
      });
      const stations = [
        { installationId: 'inst_station_a', hostname: 'a', address: '10.0.0.11:31415', job: 'job-a' },
        { installationId: 'inst_station_b', hostname: 'b', address: '10.0.0.12:31415', job: 'job-b' },
        { installationId: 'inst_station_c', hostname: 'c', address: 'app:3001', job: 'job-c' },
      ];
      for (const station of stations) {
        await service.autoRegisterDevice({
          installationId: station.installationId,
          hostname: station.hostname,
          platform: 'linux-x64',
          architecture: 'x64',
          appVersion: '0.1.47',
          ipAddresses: [station.address],
        });
      }

      const requested: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : String(input);
        if (url.endsWith('/api/v1/control/local-jobs')) requested.push(url);
        const station = stations.find((entry) => url.includes(entry.address));
        return Response.json({
          installationId: station?.installationId,
          jobs: [syncedJob(station?.job ?? 'job-unknown', '2026-01-01T00:00:00.000Z')],
        });
      });

      const result = await service.syncAllDeviceJobs({ force: true });
      expect(result.attempted).toBe(3);
      expect(requested.sort()).toEqual([
        'http://10.0.0.11:31415/api/v1/control/local-jobs',
        'http://10.0.0.12:31415/api/v1/control/local-jobs',
        'http://app:3001/api/v1/control/local-jobs',
      ]);
    });

    it('skips stations without a reported address and honours the interval', async () => {
      const deviceRegistry = new InMemoryDeviceRegistryRepository();
      const service = new WebControlRegistryService({
        deviceRegistry,
        enrollmentTokens: new InMemoryEnrollmentTokenRepository(),
      });
      await service.autoRegisterDevice({
        installationId: 'inst_no_address',
        hostname: 'no-address',
        platform: 'linux-x64',
        architecture: 'x64',
        appVersion: '0.1.47',
      });
      const addressed = await service.autoRegisterDevice({
        installationId: 'inst_with_address',
        hostname: 'with-address',
        platform: 'linux-x64',
        architecture: 'x64',
        appVersion: '0.1.47',
        ipAddresses: ['10.0.0.20:31415'],
      });

      const requested: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : String(input);
        if (url.endsWith('/api/v1/control/local-jobs')) requested.push(url);
        return Response.json({ installationId: addressed.installationId, jobs: [] });
      });

      const first = await service.syncAllDeviceJobs({ force: true });
      expect(first.attempted).toBe(1);
      const second = await service.syncAllDeviceJobs({ intervalMs: 60_000 });
      expect(second.attempted).toBe(0);
      expect(requested).toHaveLength(1);
    });
  });

  describe('discovery targets', () => {
    it('accepts a list of stations, keeps the legacy single target and de-duplicates', () => {
      const targets = defaultDiscoveryTargets({
        PRINTOPS_CONTROL_DISCOVERY_TARGETS: ' http://app:3001 , http://lab-2:3001 ,, http://app:3001 ',
        PRINTOPS_CLIENT_URL: 'http://legacy:31415',
      } as NodeJS.ProcessEnv);
      expect(targets.slice(0, 3)).toEqual(['http://legacy:31415', 'http://app:3001', 'http://lab-2:3001']);
      expect(new Set(targets).size).toBe(targets.length);
    });

    it('still probes the local defaults when nothing is configured', () => {
      const targets = defaultDiscoveryTargets({} as NodeJS.ProcessEnv);
      expect(targets).toContain('http://127.0.0.1:31415');
      expect(targets).toContain('http://localhost:31415');
    });
  });

});

describe('station job mirror authentication', () => {
  let app: FastifyInstance;
  let releasesDirectory: string;
  const previousPullToken = process.env['PRINTOPS_CONTROL_PULL_TOKEN'];

  beforeEach(async () => {
    releasesDirectory = mkdtempSync(join(tmpdir(), 'printops-job-mirror-'));
    process.env['PRINTOPS_RELEASES_DIR'] = releasesDirectory;
    process.env['DB_MODE'] = 'memory';
    process.env['PRINTOPS_DEV_SEED'] = 'true';
    process.env['PRINTOPS_CONTROL_PULL_TOKEN'] = 'station-pull-secret';
    const built = await buildApp();
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
    delete process.env['PRINTOPS_RELEASES_DIR'];
    if (previousPullToken === undefined) delete process.env['PRINTOPS_CONTROL_PULL_TOKEN'];
    else process.env['PRINTOPS_CONTROL_PULL_TOKEN'] = previousPullToken;
    rmSync(releasesDirectory, { recursive: true, force: true });
  });

  it('refuses an unauthenticated job-mirror read once a pull token is configured', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/control/local-jobs' });
    expect(anonymous.statusCode).toBe(401);

    const authorised = await app.inject({
      method: 'GET',
      url: '/api/v1/control/local-jobs',
      headers: { 'x-control-pull-token': 'station-pull-secret' },
    });
    expect(authorised.statusCode).toBe(200);
    expect(authorised.json()).toMatchObject({ jobs: [] });

    const wrong = await app.inject({
      method: 'GET',
      url: '/api/v1/control/local-jobs',
      headers: { 'x-control-pull-token': 'not-the-secret' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('refuses an unauthenticated reprint trigger on the station', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/v1/control/local-jobs/job_missing/reprint',
      payload: { reason: 'test', confirmedDuplicateRisk: true },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('accepts the credential an enrolled station derives, and rejects anything else', async () => {
    const deviceId = 'dev_enrolled_mirror';
    const token = 'devtok_enrolled_mirror';
    const guard = stationJobMirrorGuard({ permission: 'control:read', deviceId: () => deviceId, deviceToken: () => token });

    const attempt = async (supplied?: string): Promise<boolean> => {
      let sent = false;
      const req = {
        headers: supplied ? { 'x-control-pull-token': supplied } : {},
        query: {},
        ip: '10.0.0.50',
        jwtVerify: async () => { throw new Error('no session'); },
      } as unknown as FastifyRequest;
      const reply = {
        get sent() { return sent; },
        status() { return this; },
        send() { sent = true; return this; },
      } as unknown as FastifyReply;
      await guard(req, reply);
      return !sent;
    };

    await expect(attempt(deriveJobMirrorCredentialFromToken(token, deviceId))).resolves.toBe(true);
    await expect(attempt(deriveJobMirrorCredentialFromToken('devtok_other', deviceId))).resolves.toBe(false);
    await expect(attempt()).resolves.toBe(false);
  });
});
