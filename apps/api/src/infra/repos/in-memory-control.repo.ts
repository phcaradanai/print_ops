import type {
  DeviceRecord,
  CreateDeviceRecordInput,
  DeviceHeartbeatPayload,
  DeviceRegistryFilter,
  DeviceRegistryRepositoryPort,
  EnrollmentToken,
  CreateEnrollmentTokenInput,
  EnrollmentTokenRepositoryPort,
  ControlCommandRecord,
  CreateControlCommandInput,
  ControlCommandRepositoryPort,
  ReleaseCatalogRecord,
  CreateReleaseCatalogInput,
  ReleaseCatalogFilter,
  ReleaseCatalogRepositoryPort,
  ControlAuditRecord,
  ControlAuditRepositoryPort,
  ListOptions,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { randomBytes } from 'node:crypto';

export class InMemoryDeviceRegistryRepository implements DeviceRegistryRepositoryPort {
  private readonly devices = new Map<string, DeviceRecord>();

  async findById(deviceId: string): Promise<DeviceRecord | undefined> {
    const record = this.devices.get(deviceId);
    return record ? { ...record } : undefined;
  }

  async findByInstallationId(installationId: string): Promise<DeviceRecord | undefined> {
    for (const record of this.devices.values()) {
      if (record.installationId === installationId) {
        return { ...record };
      }
    }
    return undefined;
  }

  async findAll(filter?: DeviceRegistryFilter): Promise<DeviceRecord[]> {
    let result = Array.from(this.devices.values());
    if (filter?.siteId) {
      result = result.filter((d) => d.siteId === filter.siteId);
    }
    if (filter?.status) {
      result = result.filter((d) => d.status === filter.status);
    }
    if (filter?.connectionState) {
      result = result.filter((d) => d.connectionState === filter.connectionState);
    }
    if (filter?.otaState) {
      result = result.filter((d) => d.otaState === filter.otaState);
    }
    return result.map((d) => ({ ...d }));
  }

  async create(input: CreateDeviceRecordInput): Promise<DeviceRecord> {
    const record: DeviceRecord = {
      deviceId: input.deviceId,
      installationId: input.installationId,
      siteId: input.siteId,
      hostname: input.hostname,
      platform: input.platform,
      architecture: input.architecture,
      appVersion: input.appVersion,
      schemaVersion: input.schemaVersion,
      runnerVersion: input.runnerVersion,
      enrolledAt: new Date(),
      lastSeenAt: new Date(),
      connectionState: 'ONLINE',
      printState: 'IDLE',
      otaState: 'IDLE',
      lastOtaOperation: null,
      deviceTokenHash: input.deviceTokenHash,
      status: 'ACTIVE',
      displayName: input.displayName,
    };
    this.devices.set(record.deviceId, record);
    return { ...record };
  }

  async update(deviceId: string, patch: Partial<DeviceRecord>): Promise<DeviceRecord> {
    const existing = this.devices.get(deviceId);
    if (!existing) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    const updated: DeviceRecord = {
      ...existing,
      ...patch,
    };
    this.devices.set(deviceId, updated);
    return { ...updated };
  }

  async recordHeartbeat(deviceId: string, heartbeat: DeviceHeartbeatPayload): Promise<DeviceRecord> {
    const existing = this.devices.get(deviceId);
    if (!existing) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    const updated: DeviceRecord = {
      ...existing,
      hostname: heartbeat.hostname || existing.hostname,
      platform: heartbeat.platform || existing.platform,
      architecture: heartbeat.architecture || existing.architecture,
      appVersion: heartbeat.appVersion || existing.appVersion,
      schemaVersion: heartbeat.schemaVersion || existing.schemaVersion,
      runnerVersion: heartbeat.runnerVersion || existing.runnerVersion,
      runnerStatus: heartbeat.runnerStatus,
      printReadinessSummary: heartbeat.printReadinessSummary,
      printState: heartbeat.printState,
      otaState: heartbeat.otaState,
      lastOtaOperation: heartbeat.lastOtaOperation ?? existing.lastOtaOperation,
      lastSeenAt: new Date(heartbeat.timestamp),
      connectionState: 'ONLINE',
    };
    this.devices.set(deviceId, updated);
    return { ...updated };
  }

  async delete(deviceId: string): Promise<void> {
    this.devices.delete(deviceId);
  }
}

export class InMemoryEnrollmentTokenRepository implements EnrollmentTokenRepositoryPort {
  private readonly tokens = new Map<string, EnrollmentToken>();

  async create(input: CreateEnrollmentTokenInput): Promise<EnrollmentToken> {
    const tokenStr = input.token || `enroll_${randomBytes(24).toString('hex')}`;
    const ttlSeconds = input.expiresInSeconds ?? 3600; // default 1 hour
    const token: EnrollmentToken = {
      token: tokenStr,
      siteId: input.siteId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      consumedAt: null,
      consumedByDeviceId: null,
      createdBy: input.createdBy,
      createdAt: new Date(),
    };
    this.tokens.set(tokenStr, token);
    return { ...token };
  }

  async findByToken(token: string): Promise<EnrollmentToken | undefined> {
    const record = this.tokens.get(token);
    return record ? { ...record } : undefined;
  }

  async consume(token: string, deviceId: string): Promise<boolean> {
    const record = this.tokens.get(token);
    if (!record) return false;
    if (record.consumedAt !== null) return false;
    if (record.expiresAt.getTime() < Date.now()) return false;

    record.consumedAt = new Date();
    record.consumedByDeviceId = deviceId;
    this.tokens.set(token, record);
    return true;
  }

  async delete(token: string): Promise<void> {
    this.tokens.delete(token);
  }
}

export class InMemoryControlCommandRepository implements ControlCommandRepositoryPort {
  private readonly commands = new Map<string, ControlCommandRecord>();

  async create(input: CreateControlCommandInput): Promise<ControlCommandRecord> {
    const commandId = `cmd_${generateId()}`;
    const ttlSeconds = input.expiresInSeconds ?? 600; // default 10 minutes
    const record: ControlCommandRecord = {
      commandId,
      deviceId: input.deviceId,
      type: input.type,
      targetVersion: input.targetVersion,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      requestedBy: input.requestedBy,
      idempotencyKey: input.idempotencyKey,
      status: 'PENDING',
    };
    this.commands.set(commandId, record);
    return { ...record };
  }

  async findById(commandId: string): Promise<ControlCommandRecord | undefined> {
    const record = this.commands.get(commandId);
    return record ? { ...record } : undefined;
  }

  async findByIdempotencyKey(deviceId: string, idempotencyKey: string): Promise<ControlCommandRecord | undefined> {
    for (const record of this.commands.values()) {
      if (record.deviceId === deviceId && record.idempotencyKey === idempotencyKey) {
        return { ...record };
      }
    }
    return undefined;
  }

  async findByDeviceId(deviceId: string, opts?: ListOptions): Promise<ControlCommandRecord[]> {
    let result = Array.from(this.commands.values()).filter((c) => c.deviceId === deviceId);
    result.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    if (opts?.offset) {
      result = result.slice(opts.offset);
    }
    if (opts?.limit) {
      result = result.slice(0, opts.limit);
    }
    return result.map((c) => ({ ...c }));
  }

  async update(commandId: string, patch: Partial<ControlCommandRecord>): Promise<ControlCommandRecord> {
    const existing = this.commands.get(commandId);
    if (!existing) {
      throw new Error(`Command not found: ${commandId}`);
    }
    const updated: ControlCommandRecord = {
      ...existing,
      ...patch,
    };
    this.commands.set(commandId, updated);
    return { ...updated };
  }
}

export class InMemoryReleaseCatalogRepository implements ReleaseCatalogRepositoryPort {
  private readonly releases = new Map<string, ReleaseCatalogRecord>();

  async create(input: CreateReleaseCatalogInput): Promise<ReleaseCatalogRecord> {
    const id = `rel_${generateId()}`;
    const record: ReleaseCatalogRecord = {
      id,
      version: input.version,
      channel: input.channel ?? 'stable',
      platform: input.platform ?? 'windows-x64',
      architecture: input.architecture ?? 'x64',
      schemaVersion: input.schemaVersion,
      manifestRef: input.manifestRef,
      artifactRef: input.artifactRef,
      sha256: input.sha256,
      signature: input.signature,
      minSupportedVersion: input.minSupportedVersion ?? '0.1.0',
      status: input.status ?? 'AVAILABLE',
      createdAt: new Date(),
      releaseNotes: input.releaseNotes,
    };
    this.releases.set(id, record);
    return { ...record };
  }

  async findById(id: string): Promise<ReleaseCatalogRecord | undefined> {
    const record = this.releases.get(id);
    return record ? { ...record } : undefined;
  }

  async findByVersion(version: string, platform?: string): Promise<ReleaseCatalogRecord | undefined> {
    for (const record of this.releases.values()) {
      if (record.version === version && (!platform || record.platform === platform)) {
        return { ...record };
      }
    }
    return undefined;
  }

  async findAll(filter?: ReleaseCatalogFilter): Promise<ReleaseCatalogRecord[]> {
    let result = Array.from(this.releases.values());
    if (filter?.platform) {
      result = result.filter((r) => r.platform === filter.platform);
    }
    if (filter?.channel) {
      result = result.filter((r) => r.channel === filter.channel);
    }
    if (filter?.status) {
      result = result.filter((r) => r.status === filter.status);
    }
    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return result.map((r) => ({ ...r }));
  }

  async update(id: string, patch: Partial<ReleaseCatalogRecord>): Promise<ReleaseCatalogRecord> {
    const existing = this.releases.get(id);
    if (!existing) {
      throw new Error(`Release not found: ${id}`);
    }
    const updated: ReleaseCatalogRecord = {
      ...existing,
      ...patch,
    };
    this.releases.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<void> {
    this.releases.delete(id);
  }
}

export class InMemoryControlAuditRepository implements ControlAuditRepositoryPort {
  private readonly logs: ControlAuditRecord[] = [];

  async record(audit: Omit<ControlAuditRecord, 'id'>): Promise<ControlAuditRecord> {
    const record: ControlAuditRecord = {
      ...audit,
      id: `caud_${generateId()}`,
    };
    this.logs.unshift(record);
    return { ...record };
  }

  async findByDeviceId(deviceId: string, opts?: ListOptions): Promise<ControlAuditRecord[]> {
    let result = this.logs.filter((l) => l.deviceId === deviceId);
    if (opts?.offset) {
      result = result.slice(opts.offset);
    }
    if (opts?.limit) {
      result = result.slice(0, opts.limit);
    }
    return result.map((l) => ({ ...l }));
  }

  async findAll(opts?: ListOptions): Promise<ControlAuditRecord[]> {
    let result = [...this.logs];
    if (opts?.offset) {
      result = result.slice(opts.offset);
    }
    if (opts?.limit) {
      result = result.slice(0, opts.limit);
    }
    return result.map((l) => ({ ...l }));
  }
}
