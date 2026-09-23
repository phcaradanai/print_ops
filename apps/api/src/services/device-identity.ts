import type { DeviceIdentity } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import os from 'node:os';

export interface StoredDeviceIdentity {
  installationId: string;
  siteId: string;
  deviceId?: string;
  deviceToken?: string;
  enrolledAt?: string;
  hostname?: string;
  platform?: string;
  architecture?: string;
  createdAt: string;
}

export interface DeviceIdentityOptions {
  storagePath?: string;
  defaultSiteId?: string;
  appVersion?: string;
  schemaVersion?: number;
  runnerVersion?: string;
}

export class DeviceIdentityStore {
  private readonly filePath: string;
  private readonly defaultSiteId: string;
  private readonly appVersion: string;
  private readonly schemaVersion: number;
  private readonly runnerVersion: string;
  private identity: StoredDeviceIdentity;

  constructor(opts: DeviceIdentityOptions = {}) {
    this.filePath = resolve(
      opts.storagePath ||
      process.env['PRINTOPS_DEVICE_IDENTITY_PATH'] ||
      './data/device-identity.json'
    );
    this.defaultSiteId = opts.defaultSiteId || process.env['PRINTOPS_SITE_ID'] || 'default-site';
    this.appVersion = opts.appVersion || process.env['PRINTOPS_APP_VERSION'] || '0.1.28';
    this.schemaVersion = opts.schemaVersion ?? 7;
    this.runnerVersion = opts.runnerVersion || process.env['PRINTOPS_RUNNER_VERSION'] || '0.1.28';

    this.identity = this.loadOrInitialize();
  }

  private loadOrInitialize(): StoredDeviceIdentity {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<StoredDeviceIdentity>;
        if (parsed.installationId) {
          return {
            installationId: parsed.installationId,
            siteId: parsed.siteId || this.defaultSiteId,
            deviceId: parsed.deviceId,
            deviceToken: parsed.deviceToken,
            enrolledAt: parsed.enrolledAt,
            hostname: os.hostname(),
            platform: process.platform,
            architecture: process.arch,
            createdAt: parsed.createdAt || new Date().toISOString(),
          };
        }
      }
    } catch {
      // If reading/parsing fails, initialize new identity below
    }

    // Initialize fresh installation identity
    const fresh: StoredDeviceIdentity = {
      installationId: `inst_${generateId()}`,
      siteId: this.defaultSiteId,
      hostname: os.hostname(),
      platform: process.platform,
      architecture: process.arch,
      createdAt: new Date().toISOString(),
    };
    this.save(fresh);
    return fresh;
  }

  private save(data: StoredDeviceIdentity): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  getInstallationId(): string {
    return this.identity.installationId;
  }

  getDeviceId(): string | undefined {
    return this.identity.deviceId;
  }

  getDeviceToken(): string | undefined {
    return this.identity.deviceToken;
  }

  getSiteId(): string {
    return this.identity.siteId;
  }

  isEnrolled(): boolean {
    return Boolean(this.identity.deviceId && this.identity.deviceToken);
  }

  getIdentity(): DeviceIdentity {
    return {
      deviceId: this.identity.deviceId || `unregistered_${this.identity.installationId}`,
      installationId: this.identity.installationId,
      siteId: this.identity.siteId,
      hostname: os.hostname(),
      platform: process.platform,
      architecture: process.arch,
      appVersion: this.appVersion,
      schemaVersion: this.schemaVersion,
      runnerVersion: this.runnerVersion,
    };
  }

  recordEnrollment(deviceId: string, deviceToken: string, siteId?: string): void {
    this.identity = {
      ...this.identity,
      deviceId,
      deviceToken,
      siteId: siteId || this.identity.siteId,
      enrolledAt: new Date().toISOString(),
    };
    this.save(this.identity);
  }

  clearEnrollment(): void {
    this.identity = {
      installationId: this.identity.installationId,
      siteId: this.identity.siteId,
      hostname: os.hostname(),
      platform: process.platform,
      architecture: process.arch,
      createdAt: this.identity.createdAt,
    };
    this.save(this.identity);
  }
}
