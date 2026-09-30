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
        status: 'ACTIVE',
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

          const healthRes = await fetch(`${url}/health`, { signal: controller.signal });
          clearTimeout(timeout);
          if (!healthRes.ok) return;

          const healthData = await healthRes.json() as { status?: string; version?: string; station?: any };
          if (healthData.status !== 'ok') return;

          let infoData: any = {};
          try {
            const infoCtrl = new AbortController();
            const infoTimeout = setTimeout(() => infoCtrl.abort(), 1500);
            const infoRes = await fetch(`${url}/api/v1/control/device-info`, { signal: infoCtrl.signal });
            clearTimeout(infoTimeout);
            if (infoRes.ok) {
              infoData = await infoRes.json();
            }
          } catch {
            // ignore
          }

          const parsedUrl = new URL(url);
          const hostname = infoData.hostname || healthData.station?.hostname || parsedUrl.hostname;
          const installationId = infoData.installationId || healthData.station?.installationId || `discovered_${hostname}_31415`;
          const appVersion = infoData.appVersion || healthData.version || '0.1.31';
          const platform = infoData.platform || healthData.station?.platform || 'windows-x64';
          const architecture = infoData.architecture || 'x64';

          const record = await this.autoRegisterDevice({
            installationId,
            hostname,
            platform,
            architecture,
            appVersion,
            schemaVersion: infoData.schemaVersion ?? 8,
            capabilities: infoData.capabilities ?? ['content-sync-v1', 'ota-v1'],
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
    let devices = await this.deviceRegistry.findAll(repoFilter);
    if (devices.length === 0) {
      await this.discoverDevices();
      devices = await this.deviceRegistry.findAll(repoFilter);
    }
    const enriched = devices.map((d) => this.applyDynamicConnectionState(d));
    if (filter?.connectionState) {
      return enriched.filter((d) => d.connectionState === filter.connectionState);
    }
    return enriched;
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
