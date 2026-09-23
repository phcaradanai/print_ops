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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
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
        metadata: { token: token.token, siteId: token.siteId, expiresAt: token.expiresAt.toISOString() },
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

  async listDevices(filter?: DeviceRegistryFilter): Promise<DeviceRecord[]> {
    const devices = await this.deviceRegistry.findAll(filter);
    return devices.map((d) => this.applyDynamicConnectionState(d));
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
