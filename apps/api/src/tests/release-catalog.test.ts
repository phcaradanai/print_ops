import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryReleaseCatalogRepository } from '../infra/repos/in-memory-control.repo.js';
import { ReleaseCatalogService } from '../services/release-catalog.service.js';
import { ConflictError, ValidationError } from '@printerops/shared';
import type { DeviceRecord } from '@printerops/domain';

describe('ReleaseCatalogService (Phase 6)', () => {
  let repo: InMemoryReleaseCatalogRepository;
  let service: ReleaseCatalogService;

  beforeEach(() => {
    repo = new InMemoryReleaseCatalogRepository();
    service = new ReleaseCatalogService({ releases: repo });
  });

  it('registers a signed release and retrieves it by version', async () => {
    const release = await service.registerRelease({
      version: '0.1.29',
      channel: 'stable',
      platform: 'windows-x64',
      architecture: 'x64',
      schemaVersion: 8,
      manifestRef: 'https://releases.local/v0.1.29/manifest.json',
      artifactRef: 'https://releases.local/v0.1.29/PrintOps_0.1.29_x64-setup.exe',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      signature: 'ed25519_sig_xyz',
      minSupportedVersion: '0.1.20',
      status: 'AVAILABLE',
      releaseNotes: 'Performance improvements and bug fixes',
    });

    expect(release.id).toMatch(/^rel_/);
    expect(release.version).toBe('0.1.29');
    expect(release.signature).toBe('ed25519_sig_xyz');

    const found = await service.getRelease(release.id);
    expect(found?.version).toBe('0.1.29');
  });

  it('rejects registration with invalid semver or missing required fields', async () => {
    await expect(
      service.registerRelease({
        version: 'not-a-semver',
        schemaVersion: 8,
        manifestRef: 'https://releases.local/manifest.json',
        artifactRef: 'https://releases.local/artifact.exe',
        sha256: 'hash',
        signature: 'sig',
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      service.registerRelease({
        version: '0.1.29',
        schemaVersion: 8,
        manifestRef: '',
        artifactRef: 'https://releases.local/artifact.exe',
        sha256: 'hash',
        signature: 'sig',
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      service.registerRelease({
        version: '0.1.29',
        schemaVersion: 8,
        manifestRef: 'https://releases.local/manifest.json',
        artifactRef: 'https://releases.local/artifact.exe',
        sha256: '',
        signature: 'sig',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('prevents duplicate release registration for the same version and platform', async () => {
    await service.registerRelease({
      version: '0.1.29',
      platform: 'windows-x64',
      schemaVersion: 8,
      manifestRef: 'https://releases.local/manifest.json',
      artifactRef: 'https://releases.local/artifact.exe',
      sha256: 'hash1',
      signature: 'sig1',
    });

    await expect(
      service.registerRelease({
        version: '0.1.29',
        platform: 'windows-x64',
        schemaVersion: 8,
        manifestRef: 'https://releases.local/manifest.json',
        artifactRef: 'https://releases.local/artifact.exe',
        sha256: 'hash2',
        signature: 'sig2',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('correctly assesses compatibility against device specifications', async () => {
    const release = await service.registerRelease({
      version: '0.1.30',
      platform: 'windows-x64',
      schemaVersion: 8,
      manifestRef: 'https://releases.local/manifest.json',
      artifactRef: 'https://releases.local/artifact.exe',
      sha256: 'hash',
      signature: 'sig',
      minSupportedVersion: '0.1.25',
    });

    // 1. Device on 0.1.28 is compatible with 0.1.30
    const check1 = service.isCompatible(release, {
      appVersion: '0.1.28',
      schemaVersion: 8,
      platform: 'windows-x64',
    });
    expect(check1.compatible).toBe(true);

    // 2. Device on same version 0.1.30 is not compatible (cannot reinstall same as upgrade)
    const check2 = service.isCompatible(release, {
      appVersion: '0.1.30',
      schemaVersion: 8,
      platform: 'windows-x64',
    });
    expect(check2.compatible).toBe(false);
    expect(check2.reason).toContain('not newer');

    // 3. Device on older version than minSupportedVersion (0.1.20 < 0.1.25)
    const check3 = service.isCompatible(release, {
      appVersion: '0.1.20',
      schemaVersion: 8,
      platform: 'windows-x64',
    });
    expect(check3.compatible).toBe(false);
    expect(check3.reason).toContain('minSupportedVersion');

    // 4. Revoked release is not compatible
    const revoked = await service.updateReleaseStatus(release.id, 'REVOKED');
    const checkRevoked = service.isCompatible(revoked, {
      appVersion: '0.1.28',
      schemaVersion: 8,
      platform: 'windows-x64',
    });
    expect(checkRevoked.compatible).toBe(false);
  });

  it('finds latest compatible release for a device', async () => {
    await service.registerRelease({
      version: '0.1.29',
      platform: 'windows-x64',
      schemaVersion: 8,
      manifestRef: 'https://releases.local/v0.1.29/manifest.json',
      artifactRef: 'https://releases.local/v0.1.29/setup.exe',
      sha256: 'hash29',
      signature: 'sig29',
      minSupportedVersion: '0.1.20',
    });

    await service.registerRelease({
      version: '0.1.31',
      platform: 'windows-x64',
      schemaVersion: 8,
      manifestRef: 'https://releases.local/v0.1.31/manifest.json',
      artifactRef: 'https://releases.local/v0.1.31/setup.exe',
      sha256: 'hash31',
      signature: 'sig31',
      minSupportedVersion: '0.1.25',
    });

    await service.registerRelease({
      version: '0.1.32',
      platform: 'windows-x64',
      schemaVersion: 8,
      manifestRef: 'https://releases.local/v0.1.32/manifest.json',
      artifactRef: 'https://releases.local/v0.1.32/setup.exe',
      sha256: 'hash32',
      signature: 'sig32',
      minSupportedVersion: '0.1.30', // Device on 0.1.28 cannot jump directly to 0.1.32
    });

    const mockDevice: DeviceRecord = {
      deviceId: 'dev_01',
      installationId: 'inst_01',
      siteId: 'site-a',
      hostname: 'pc-01',
      platform: 'windows-x64',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 8,
      runnerVersion: '0.1.28',
      enrolledAt: new Date(),
      lastSeenAt: new Date(),
      connectionState: 'ONLINE',
      printState: 'IDLE',
      otaState: 'IDLE',
      lastOtaOperation: null,
      deviceTokenHash: 'hash',
      status: 'ACTIVE',
    };

    const latest = await service.findLatestCompatibleRelease(mockDevice);
    expect(latest).toBeDefined();
    // 0.1.31 should be chosen because 0.1.32 minSupportedVersion is 0.1.30
    expect(latest?.version).toBe('0.1.31');
  });
});
