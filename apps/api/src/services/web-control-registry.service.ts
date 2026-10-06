import type {
  DeviceRecord,
  DeviceEnrollmentRequest,
  DeviceEnrollmentResponse,
  DeviceHeartbeatPayload,
  DeviceRegistryFilter,
  DeviceRegistryRepositoryPort,
  EnrollmentToken,
  CreateEnrollmentTokenInput,
  EnrollmentTokenRepositoryPort,
  ControlAuditRepositoryPort,
} from '@printerops/domain';
import { AppError, ConflictError, NotFoundError, ValidationError, generateId } from '@printerops/shared';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashDeviceToken, verifyControlMessage } from './control-message-auth.js';
export { hashDeviceToken } from './control-message-auth.js';
const AUTO_DISCOVERY_INTERVAL_MS = 30_000;

function objectField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !(key in value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function stringField(value: unknown, key: string): string | undefined {
  const field = objectField(value, key);
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const field = objectField(value, key);
  return typeof field === 'number' ? field : undefined;
}

function stringArrayField(value: unknown, key: string): string[] | undefined {
  const field = objectField(value, key);
  return Array.isArray(field) && field.every((item: unknown) => typeof item === 'string')
    ? field as string[]
    : undefined;
}


export interface WebControlRegistryConfig {
  natsUrl?: string;
  staleThresholdMs?: number; // default 30s
  offlineThresholdMs?: number; // default 90s
}

export interface WebControlRegistryDeps {
  deviceRegistry: DeviceRegistryRepositoryPort;
  enrollmentTokens: EnrollmentTokenRepositoryPort;
  audit?: ControlAuditRepositoryPort;
  config?: WebControlRegistryConfig;
}

export class WebControlRegistryService {
  private readonly deviceRegistry: DeviceRegistryRepositoryPort;
  private readonly enrollmentTokens: EnrollmentTokenRepositoryPort;
  private readonly audit?: ControlAuditRepositoryPort;
  private readonly config: Required<WebControlRegistryConfig>;
  private lastAutoDiscoveryAt = 0;
  private automaticDiscoveryInFlight?: Promise<void>;

  constructor(deps: WebControlRegistryDeps) {
    this.deviceRegistry = deps.deviceRegistry;
    this.enrollmentTokens = deps.enrollmentTokens;
    this.audit = deps.audit;
    this.config = {
      natsUrl: deps.config?.natsUrl || process.env['PRINTOPS_CONTROL_NATS_URL'] || 'nats://127.0.0.1:4222',
      staleThresholdMs: deps.config?.staleThresholdMs ?? 30_000,
      offlineThresholdMs: deps.config?.offlineThresholdMs ?? 90_000,
    };
  }

  async createEnrollmentToken(input: CreateEnrollmentTokenInput): Promise<EnrollmentToken> {
    if (!input.siteId || input.siteId.trim().length === 0) {
      throw new ValidationError('siteId is required');
    }
    const token = await this.enrollmentTokens.create(input);
    if (this.audit) {
      await this.audit.record({
        actor: input.createdBy,
        deviceId: 'pending',
        action: 'device.enrollment_token_created',
        requestedAt: new Date(),
        metadata: { tokenPreview: `${token.token.slice(0, 10)}...`, siteId: token.siteId, expiresAt: token.expiresAt.toISOString() },
      });
    }
    return token;
  }

  async enrollDevice(request: DeviceEnrollmentRequest): Promise<DeviceEnrollmentResponse> {
    if (!request.enrollmentToken || request.enrollmentToken.trim().length === 0) {
      throw new ValidationError('enrollmentToken is required');
    }
    if (!request.installationId || request.installationId.trim().length === 0) {
      throw new ValidationError('installationId is required');
    }

    const tokenRecord = await this.enrollmentTokens.findByToken(request.enrollmentToken.trim());
    if (!tokenRecord) {
      throw new NotFoundError('EnrollmentToken', request.enrollmentToken);
    }

    if (tokenRecord.consumedAt !== null) {
      throw new ConflictError('Enrollment token has already been consumed');
    }

    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Enrollment token has expired', 410);
    }

    // Check if device with this installationId already exists
    const existing = await this.deviceRegistry.findByInstallationId(request.installationId.trim());
    const deviceId = existing?.deviceId || `dev_${generateId()}`;
    const deviceToken = `devtok_${randomBytes(32).toString('hex')}`;
    const deviceTokenHash = hashDeviceToken(deviceToken);
    const siteId = request.siteId || tokenRecord.siteId;

    // Consume token atomically
    const consumed = await this.enrollmentTokens.consume(tokenRecord.token, deviceId);
    if (!consumed) {
      throw new ConflictError('Enrollment token could not be consumed');
    }

    if (existing) {
      await this.deviceRegistry.update(existing.deviceId, {
        hostname: request.hostname,
        platform: request.platform,
        architecture: request.architecture,
        appVersion: request.appVersion,
        schemaVersion: request.schemaVersion,
        runnerVersion: request.runnerVersion,
        deviceTokenHash,
        displayName: request.displayName ?? existing.displayName,
        status: 'ACTIVE',
        connectionState: 'ONLINE',
        lastSeenAt: new Date(),
      });
    } else {
      await this.deviceRegistry.create({
        deviceId,
        installationId: request.installationId.trim(),
        siteId,
        hostname: request.hostname,
        platform: request.platform,
        architecture: request.architecture,
        appVersion: request.appVersion,
        schemaVersion: request.schemaVersion,
        runnerVersion: request.runnerVersion,
        deviceTokenHash,
        displayName: request.displayName,
      });
    }

    if (this.audit) {
      await this.audit.record({
        actor: `device:${deviceId}`,
        deviceId,
        action: 'device.enrolled',
        requestedAt: new Date(),
        metadata: {
          installationId: request.installationId,
          siteId,
          hostname: request.hostname,
          platform: request.platform,
        },
      });
    }

    return {
      deviceId,
      installationId: request.installationId.trim(),
      siteId,
      deviceToken,
      controlPlane: {
        natsUrl: this.config.natsUrl,
        commandSubject: `printops.control.command.${deviceId}`,
        eventSubject: `printops.control.event.${deviceId}`,
        heartbeatSubject: `printops.control.heartbeat.${deviceId}`,
      },
    };
  }

  async authenticateDevice(deviceId: string, deviceToken: string): Promise<DeviceRecord | null> {
    const device = await this.deviceRegistry.findById(deviceId);
    if (!device || device.status !== 'ACTIVE') {
      return null;
    }

    const providedHash = Buffer.from(hashDeviceToken(deviceToken), 'hex');
    const storedHash = Buffer.from(device.deviceTokenHash, 'hex');

    if (providedHash.length !== storedHash.length || !timingSafeEqual(providedHash, storedHash)) {
      return null;
    }

    return device;
  }

  async authenticateDeviceMessage(deviceId: string, payload: unknown, signature: string): Promise<DeviceRecord | null> {
    if (
      !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
      || !('deviceId' in payload)
      || payload.deviceId !== deviceId
    ) return null;
    const device = await this.deviceRegistry.findById(deviceId);
    if (!device || device.status !== 'ACTIVE') return null;
    return verifyControlMessage(device.deviceTokenHash, payload, signature) ? device : null;
  }

  async recordHeartbeat(payload: DeviceHeartbeatPayload): Promise<DeviceRecord> {
    const device = await this.deviceRegistry.findById(payload.deviceId);
    if (!device) {
      throw new NotFoundError('Device', payload.deviceId);
    }
    return this.deviceRegistry.recordHeartbeat(payload.deviceId, payload);
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | undefined> {
    const device = await this.deviceRegistry.findById(deviceId);
    if (!device) return undefined;
    return this.applyDynamicConnectionState(device);
  }

  async autoRegisterDevice(input: {
    installationId: string;
    hostname: string;
    platform: string;
    architecture: string;
    appVersion: string;
    schemaVersion?: number;
    runnerVersion?: string;
    siteId?: string;
    displayName?: string;
    ipAddresses?: string[];
    capabilities?: string[];
  }): Promise<DeviceRecord> {
    const existing = await this.deviceRegistry.findByInstallationId(input.installationId.trim());
    const deviceId = existing?.deviceId || `dev_${input.installationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}`;
    const deviceToken = `devtok_${randomBytes(24).toString('hex')}`;
    const deviceTokenHash = hashDeviceToken(deviceToken);
    const siteId = input.siteId || existing?.siteId || 'default-site';

    if (existing) {
      return this.deviceRegistry.update(existing.deviceId, {
        hostname: input.hostname,
        platform: input.platform,
        architecture: input.architecture,
        appVersion: input.appVersion,
        schemaVersion: input.schemaVersion ?? existing.schemaVersion,
        runnerVersion: input.runnerVersion ?? existing.runnerVersion,
        displayName: input.displayName ?? existing.displayName,
        status: existing.status,
        connectionState: 'ONLINE',
        lastSeenAt: new Date(),
        capabilities: input.capabilities ?? existing.capabilities ?? ['content-sync-v1', 'ota-v1'],
        ipAddresses: input.ipAddresses ?? existing.ipAddresses,
      });
    }

    return this.deviceRegistry.create({
      deviceId,
      installationId: input.installationId.trim(),
      siteId,
      hostname: input.hostname,
      platform: input.platform,
      architecture: input.architecture,
      appVersion: input.appVersion,
      schemaVersion: input.schemaVersion ?? 8,
      runnerVersion: input.runnerVersion ?? '0.1.28',
      deviceTokenHash,
      displayName: input.displayName ?? input.hostname,
      capabilities: input.capabilities ?? ['content-sync-v1', 'ota-v1'],
      ipAddresses: input.ipAddresses,
    });
  }

  async discoverDevices(targets?: string[]): Promise<DeviceRecord[]> {
    const candidateTargets = (targets && targets.length > 0)
      ? targets
      : [
          process.env['PRINTOPS_CLIENT_URL'],
          'http://host.docker.internal:31415',
          'http://127.0.0.1:31415',
          'http://localhost:31415',
        ].filter(Boolean) as string[];

    const discovered: DeviceRecord[] = [];

    await Promise.all(
      candidateTargets.map(async (targetUrl) => {
        try {
          const normalized = targetUrl.replace(/\/+$/, '');
          const url = normalized.startsWith('http') ? normalized : `http://${normalized}:31415`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2000);
          let healthData: unknown;
          try {
            const healthRes = await fetch(`${url}/health`, { signal: controller.signal });
            if (!healthRes.ok) return;
            healthData = await healthRes.json();
          } finally {
            clearTimeout(timeout);
          }
          if (stringField(healthData, 'status') !== 'ok') return;

          let infoData: unknown = {};
          const infoCtrl = new AbortController();
          const infoTimeout = setTimeout(() => infoCtrl.abort(), 1500);
          try {
            const infoRes = await fetch(`${url}/api/v1/control/device-info`, { signal: infoCtrl.signal });
            if (infoRes.ok) {
              infoData = await infoRes.json();
            }
          } catch {
            // Discovery can still use host and version from /health.
          } finally {
            clearTimeout(infoTimeout);
          }

          const parsedUrl = new URL(url);
          const stationData = objectField(healthData, 'station');
          const hostname = stringField(infoData, 'hostname')
            || stringField(stationData, 'hostname')
            || parsedUrl.hostname;
          const installationId = stringField(infoData, 'installationId')
            || stringField(stationData, 'installationId')
            || `discovered_${hostname}_31415`;
          const appVersion = stringField(infoData, 'appVersion')
            || stringField(healthData, 'version')
            || '0.1.32';
          const platform = stringField(infoData, 'platform')
            || stringField(stationData, 'platform')
            || 'windows-x64';
          const architecture = stringField(infoData, 'architecture') || 'x64';

          const record = await this.autoRegisterDevice({
            installationId,
            hostname,
            platform,
            architecture,
            appVersion,
            schemaVersion: numberField(infoData, 'schemaVersion') ?? 8,
            capabilities: stringArrayField(infoData, 'capabilities') ?? ['content-sync-v1', 'ota-v1'],
            ipAddresses: [parsedUrl.hostname],
            displayName: `${hostname} (Auto-Discovered)`,
          });

          discovered.push(record);
        } catch {
          // unreachable target, ignore
        }
      }),
    );

    return discovered;
  }

  async listDevices(filter?: DeviceRegistryFilter): Promise<DeviceRecord[]> {
    const repoFilter = filter ? { ...filter, connectionState: undefined } : undefined;
    await this.refreshFromNetworkIfDue();
    const allDevices = await this.deviceRegistry.findAll();
    const devices = repoFilter
      ? await this.deviceRegistry.findAll(repoFilter)
      : allDevices;

    // Older discovery records without an installation identity can describe
    // the same station as a later identity-aware probe of the same endpoint.
    const identifiedAddresses = new Set(
      allDevices
        .filter((device) => !device.installationId.startsWith('discovered_'))
        .flatMap((device) => device.ipAddresses ?? [])
        .map((address) => address.toLowerCase()),
    );
    const visibleDevices = devices.filter((device) => {
      if (!device.installationId.startsWith('discovered_')) return true;
      return !(device.ipAddresses ?? []).some((address) => identifiedAddresses.has(address.toLowerCase()));
    });
    const enriched = visibleDevices.map((device) => this.applyDynamicConnectionState(device));
    if (filter?.connectionState) {
      return enriched.filter((device) => device.connectionState === filter.connectionState);
    }
    return enriched;
  }

  private async refreshFromNetworkIfDue(): Promise<void> {
    if (this.automaticDiscoveryInFlight) {
      await this.automaticDiscoveryInFlight;
      return;
    }
    if (Date.now() - this.lastAutoDiscoveryAt < AUTO_DISCOVERY_INTERVAL_MS) return;

    this.lastAutoDiscoveryAt = Date.now();
    const discovery = this.discoverDevices().then(() => undefined);
    this.automaticDiscoveryInFlight = discovery;
    try {
      await discovery;
    } finally {
      if (this.automaticDiscoveryInFlight === discovery) {
        this.automaticDiscoveryInFlight = undefined;
      }
    }
  }

  private applyDynamicConnectionState(device: DeviceRecord): DeviceRecord {
    if (!device.lastSeenAt) {
      return { ...device, connectionState: 'OFFLINE' };
    }
    const elapsed = Date.now() - new Date(device.lastSeenAt).getTime();
    let state: DeviceRecord['connectionState'] = 'ONLINE';
    if (elapsed > this.config.offlineThresholdMs) {
      state = 'OFFLINE';
    } else if (elapsed > this.config.staleThresholdMs) {
      state = 'STALE';
    }
    return { ...device, connectionState: state };
  }
}
