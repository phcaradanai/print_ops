import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryOtaUpdateStateRepository } from '../infra/repos/in-memory-ota-state.repo.js';
import {
  OtaUpdateService,
  otaConfigFromEnv,
  parseReleaseManifest,
  type OtaInstallerPort,
  type OtaConfig,
} from '../services/ota-update.service.js';
import { PrintAdmissionGate } from '../services/print-admission-gate.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function manifest(version: string, artifactBytes: Uint8Array = bytes('artifact')) {
  return {
    schema_version: 1,
    release: {
      version,
      channel: 'stable',
      release_date: '2026-09-08T10:00:00Z',
      notes: `PrintOps ${version}`,
    },
    artifacts: {
      desktop: {
        'windows-x64': {
          url: 'desktop.artifact',
          sha256: digest(artifactBytes),
          signature: '',
          size: artifactBytes.byteLength,
        },
      },
    },
    compatibility: {
      min_supported_version: '0.1.20',
      schema_version: 7,
    },
    rollout: { staged: false, rollout_percentage: 100 },
  };
}

async function makeConfig(overrides: Partial<OtaConfig> = {}): Promise<OtaConfig> {
  const directory = await mkdtemp(join(tmpdir(), 'printops-ota-'));
  temporaryDirectories.push(directory);
  return {
    enabled: true,
    channel: 'stable',
    currentVersion: '0.1.28',
    currentSchemaVersion: 7,
    wanManifestUrl: 'https://wan.example/printops/manifest.json',
    cacheDir: directory,
    manifestTimeoutMs: 1_000,
    downloadTimeoutMs: 1_000,
    maxArtifactBytes: 1_000_000,
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('parseReleaseManifest', () => {
  it('normalizes the snake_case wire contract into domain fields', () => {
    const parsed = parseReleaseManifest(manifest('0.1.29'));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.release.releaseDate).toBe('2026-09-08T10:00:00Z');
    expect(parsed.compatibility.minSupportedVersion).toBe('0.1.20');
    expect(parsed.rollout.rolloutPercentage).toBe(100);
  });

  it('rejects malformed checksums and incompatible minimum versions', () => {
    expect(() => parseReleaseManifest({
      ...manifest('0.1.29'),
      artifacts: { desktop: { 'windows-x64': { ...manifest('0.1.29').artifacts.desktop['windows-x64'], sha256: 'bad' } } },
    })).toThrow('SHA-256');

    expect(() => parseReleaseManifest({
      ...manifest('0.1.29'),
      compatibility: { min_supported_version: '2.0.0', schema_version: 7 },
    })).toThrow('min_supported_version');
  });
});

describe('OtaUpdateService', () => {
  it('tries LAN first and falls back to WAN when LAN is unavailable', async () => {
    const calls: string[] = [];
    const config = await makeConfig({ lanRelayUrl: 'http://lan.example/ota' });
    const service = new OtaUpdateService({
      state: new InMemoryOtaUpdateStateRepository(),
      config,
      fetchImpl: async (url) => {
        calls.push(url);
        if (url.startsWith('http://lan.example')) return new Response('unavailable', { status: 503 });
        return jsonResponse(manifest('0.1.29'));
      },
    });

    const result = await service.checkForUpdate();

    expect(result).toMatchObject({ available: true, latestVersion: '0.1.29', source: 'wan' });
    expect(calls).toEqual([
      'http://lan.example/ota/manifest.json',
      'https://wan.example/printops/manifest.json',
    ]);
    await expect(service.getStatus()).resolves.toMatchObject({ state: { state: 'UPDATE_AVAILABLE' } });
  });

  it('returns a no-op when the manifest is already current', async () => {
    const config = await makeConfig({ currentVersion: '0.1.29' });
    const service = new OtaUpdateService({
      state: new InMemoryOtaUpdateStateRepository(),
      config,
      fetchImpl: async () => jsonResponse(manifest('0.1.29')),
    });

    await expect(service.checkForUpdate()).resolves.toMatchObject({
      available: false,
      reason: 'CURRENT',
      latestVersion: '0.1.29',
    });
    await expect(service.getStatus()).resolves.toMatchObject({ state: { state: 'IDLE' } });
  });

  it('downloads to the cache and verifies the artifact SHA-256 before marking VERIFIED', async () => {
    const artifact = bytes('verified ota artifact');
    const config = await makeConfig();
    const service = new OtaUpdateService({
      state: new InMemoryOtaUpdateStateRepository(),
      config,
      fetchImpl: async (url) => url.endsWith('manifest.json')
        ? jsonResponse(manifest('0.1.29', artifact))
        : new Response(artifact, { status: 200, headers: { 'content-length': String(artifact.byteLength) } }),
    });

    const result = await service.downloadUpdate({ version: '0.1.29' });
    const path = join(config.cacheDir, '0.1.29', 'desktop-windows-x64.artifact');

    expect(result).toMatchObject({
      downloaded: true,
      source: 'wan',
      bytes: artifact.byteLength,
      sha256: digest(artifact),
      signatureVerification: 'deferred',
    });
    await expect(readFile(path)).resolves.toEqual(Buffer.from(artifact));
    await expect(stat(path)).resolves.toMatchObject({ size: artifact.byteLength });
    await expect(service.getStatus()).resolves.toMatchObject({ state: { state: 'VERIFIED' } });
  });

  it('rejects a corrupted artifact and records VERIFY_FAILED', async () => {
    const expected = bytes('expected');
    const corrupted = bytes('corrupt!');
    const config = await makeConfig();
    const service = new OtaUpdateService({
      state: new InMemoryOtaUpdateStateRepository(),
      config,
      fetchImpl: async (url) => url.endsWith('manifest.json')
        ? jsonResponse(manifest('0.1.29', expected))
        : new Response(corrupted),
    });

    await expect(service.downloadUpdate({ version: '0.1.29' })).rejects.toMatchObject({
      code: 'OTA_VERIFY_FAILED',
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      state: { state: 'VERIFY_FAILED', retryCount: 1 },
    });
  });

  it('pauses print admission, waits for queue idle, and installs only after the drain settles', async () => {
    const artifact = bytes('queue-safe ota artifact');
    const config = await makeConfig({ queuePollMs: 1, queueIdleTimeoutMs: 100, healthCheckTimeoutMs: 100 });
    let queueReads = 0;
    const queue = {
      getMetrics: vi.fn(async () => {
        queueReads += 1;
        return queueReads < 2
          ? { size: 1, inflight: 0, oldestEnqueuedAt: null, oldestPriority: null, avgWaitMs: null }
          : { size: 0, inflight: 0, oldestEnqueuedAt: null, oldestPriority: null, avgWaitMs: null };
      }),
    } as never;
    const admission = new PrintAdmissionGate();
    const settled = vi.fn(async () => undefined);
    let installSawMaintenance = false;
    const installer: OtaInstallerPort = {
      install: vi.fn(async () => {
        installSawMaintenance = admission.isMaintenanceActive();
      }),
      healthCheck: vi.fn(async () => true),
      rollback: vi.fn(async () => undefined),
    };
    const service = new OtaUpdateService({
      state: new InMemoryOtaUpdateStateRepository(),
      config,
      queue,
      admission,
      schedulerSettled: settled,
      eventBusSettled: settled,
      installer,
      fetchImpl: async (url) => url.endsWith('manifest.json')
        ? jsonResponse(manifest('0.1.29', artifact))
        : new Response(artifact, { status: 200, headers: { 'content-length': String(artifact.byteLength) } }),
    });

    await service.downloadUpdate({ version: '0.1.29' });
    await expect(service.installUpdate({ version: '0.1.29' })).resolves.toMatchObject({
      installed: true,
      state: 'RESTART_PENDING',
    });

    expect(queueReads).toBeGreaterThanOrEqual(3);
    expect(settled).toHaveBeenCalledTimes(2);
    expect(installSawMaintenance).toBe(true);
    expect(admission.isMaintenanceActive()).toBe(false);
    await expect(service.getStatus()).resolves.toMatchObject({ state: { state: 'RESTART_PENDING' } });
  });

  it('rolls back automatically when the post-install health check fails', async () => {
    const artifact = bytes('health failure ota artifact');
    const config = await makeConfig({ healthCheckTimeoutMs: 1 });
    const installer: OtaInstallerPort = {
      install: vi.fn(async () => undefined),
      healthCheck: vi.fn(async () => false),
      rollback: vi.fn(async () => undefined),
    };
    const service = new OtaUpdateService({
      state: new InMemoryOtaUpdateStateRepository(),
      config,
      installer,
      fetchImpl: async (url) => url.endsWith('manifest.json')
        ? jsonResponse(manifest('0.1.29', artifact))
        : new Response(artifact, { status: 200, headers: { 'content-length': String(artifact.byteLength) } }),
    });

    await service.downloadUpdate({ version: '0.1.29' });
    await expect(service.installUpdate({ version: '0.1.29' })).rejects.toMatchObject({ code: 'OTA_ROLLED_BACK' });
    expect(installer.rollback).toHaveBeenCalledTimes(1);
    await expect(service.getStatus()).resolves.toMatchObject({
      state: { state: 'ROLLED_BACK', errorMessage: expect.stringContaining('previous version was restored') },
    });
  });

  it('does not install while a print is active and releases the admission gate on timeout', async () => {
    const artifact = bytes('busy queue ota artifact');
    const config = await makeConfig({ queuePollMs: 1, queueIdleTimeoutMs: 5 });
    const admission = new PrintAdmissionGate();
    const installer: OtaInstallerPort = {
      install: vi.fn(async () => undefined),
      healthCheck: vi.fn(async () => true),
      rollback: vi.fn(async () => undefined),
    };
    const service = new OtaUpdateService({
      state: new InMemoryOtaUpdateStateRepository(),
      config,
      queue: {
        getMetrics: async () => ({ size: 0, inflight: 1, oldestEnqueuedAt: null, oldestPriority: null, avgWaitMs: null }),
      } as never,
      admission,
      installer,
      fetchImpl: async (url) => url.endsWith('manifest.json')
        ? jsonResponse(manifest('0.1.29', artifact))
        : new Response(artifact, { status: 200, headers: { 'content-length': String(artifact.byteLength) } }),
    });

    await service.downloadUpdate({ version: '0.1.29' });
    await expect(service.installUpdate({ version: '0.1.29' })).rejects.toMatchObject({ code: 'OTA_QUEUE_NOT_IDLE' });
    expect(installer.install).not.toHaveBeenCalled();
    expect(admission.isMaintenanceActive()).toBe(false);
    await expect(service.getStatus()).resolves.toMatchObject({ state: { state: 'INSTALL_FAILED' } });
  });

  it('is disabled by default and validates OTA environment settings', async () => {
    const config = otaConfigFromEnv({ PRINTOPS_APP_VERSION: '0.1.28' });
    expect(config.enabled).toBe(false);
    expect(config.currentVersion).toBe('0.1.28');
    expect(() => otaConfigFromEnv({ PRINTOPS_OTA_ENABLED: 'true', PRINTOPS_OTA_CHANNEL: 'nightly' })).toThrow('CHANNEL');
  });
});
