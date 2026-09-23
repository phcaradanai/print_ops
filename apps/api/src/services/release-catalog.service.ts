import type {
  CreateReleaseCatalogInput,
  DeviceRecord,
  ReleaseCatalogFilter,
  ReleaseCatalogRecord,
  ReleaseCatalogRepositoryPort,
  ReleaseRecordStatus,
} from '@printerops/domain';
import { compareVersions, isValidVersion } from '@printerops/domain';
import { ConflictError, NotFoundError, ValidationError } from '@printerops/shared';

export interface ReleaseCatalogServiceDeps {
  releases: ReleaseCatalogRepositoryPort;
}

export class ReleaseCatalogService {
  private readonly releases: ReleaseCatalogRepositoryPort;

  constructor(deps: ReleaseCatalogServiceDeps) {
    this.releases = deps.releases;
  }

  async registerRelease(input: CreateReleaseCatalogInput): Promise<ReleaseCatalogRecord> {
    if (!input.version || !isValidVersion(input.version)) {
      throw new ValidationError(`Invalid semver version: ${input.version}`);
    }
    if (!input.manifestRef || input.manifestRef.trim().length === 0) {
      throw new ValidationError('manifestRef is required');
    }
    if (!input.artifactRef || input.artifactRef.trim().length === 0) {
      throw new ValidationError('artifactRef is required');
    }
    if (!input.sha256 || input.sha256.trim().length === 0) {
      throw new ValidationError('sha256 checksum is required');
    }
    if (!input.signature || input.signature.trim().length === 0) {
      throw new ValidationError('Cryptographic signature/provenance is required');
    }
    if (typeof input.schemaVersion !== 'number' || input.schemaVersion < 1) {
      throw new ValidationError('schemaVersion must be a positive integer');
    }

    const platform = input.platform ?? 'windows-x64';
    const existing = await this.releases.findByVersion(input.version, platform);
    if (existing) {
      throw new ConflictError(`Release ${input.version} for platform ${platform} already exists`);
    }

    return this.releases.create({
      ...input,
      platform,
    });
  }

  async getRelease(id: string): Promise<ReleaseCatalogRecord | undefined> {
    return this.releases.findById(id);
  }

  async listReleases(filter?: ReleaseCatalogFilter): Promise<ReleaseCatalogRecord[]> {
    return this.releases.findAll(filter);
  }

  async updateReleaseStatus(id: string, status: ReleaseRecordStatus): Promise<ReleaseCatalogRecord> {
    const existing = await this.releases.findById(id);
    if (!existing) {
      throw new NotFoundError('Release', id);
    }
    return this.releases.update(id, { status });
  }

  isCompatible(
    release: ReleaseCatalogRecord,
    device: { appVersion: string; schemaVersion: number; platform?: string },
  ): { compatible: boolean; reason?: string } {
    if (release.status !== 'AVAILABLE') {
      return { compatible: false, reason: `Release is ${release.status}` };
    }

    // Platform match
    if (device.platform && release.platform !== device.platform) {
      return { compatible: false, reason: `Platform mismatch: release is ${release.platform}, device is ${device.platform}` };
    }

    // Semver comparisons
    const versionDiff = compareVersions(release.version, device.appVersion);
    if (versionDiff === null) {
      return { compatible: false, reason: 'Invalid semver comparison' };
    }
    if (versionDiff <= 0) {
      return { compatible: false, reason: `Target version ${release.version} is not newer than current ${device.appVersion}` };
    }

    // Minimum supported version requirement
    if (release.minSupportedVersion) {
      const minDiff = compareVersions(device.appVersion, release.minSupportedVersion);
      if (minDiff !== null && minDiff < 0) {
        return {
          compatible: false,
          reason: `Device version ${device.appVersion} is older than minSupportedVersion ${release.minSupportedVersion}`,
        };
      }
    }

    // Schema version forward jump limit (must not skip forward multiple breaking schema versions without migration path)
    if (release.schemaVersion > device.schemaVersion + 2) {
      return {
        compatible: false,
        reason: `Schema jump too large (device v${device.schemaVersion} -> target v${release.schemaVersion})`,
      };
    }

    return { compatible: true };
  }

  async findLatestCompatibleRelease(device: DeviceRecord): Promise<ReleaseCatalogRecord | null> {
    const platform = (device.platform === 'win32' || device.platform === 'windows') ? 'windows-x64' : (device.platform as 'windows-x64' | 'node-bundle');
    const available = await this.releases.findAll({
      status: 'AVAILABLE',
      platform,
    });

    // Sort releases by semver descending
    const sorted = available.slice().sort((a, b) => {
      const diff = compareVersions(b.version, a.version);
      return diff ?? 0;
    });

    for (const candidate of sorted) {
      const { compatible } = this.isCompatible(candidate, {
        appVersion: device.appVersion,
        schemaVersion: device.schemaVersion,
        platform,
      });
      if (compatible) {
        return candidate;
      }
    }

    return null;
  }
}
