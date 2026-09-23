import type { SqlValue } from 'sql.js';
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
import { getDb } from '../../db/sqlite.js';
import { dateStr, fromJson, toDate, toJson } from '../../db/json.js';
import { randomBytes } from 'node:crypto';

function rowToDevice(row: Record<string, unknown>): DeviceRecord {
  return {
    deviceId: row['device_id'] as string,
    installationId: row['installation_id'] as string,
    siteId: row['site_id'] as string,
    hostname: row['hostname'] as string,
    platform: row['platform'] as string,
    architecture: row['architecture'] as string,
    appVersion: row['app_version'] as string,
    schemaVersion: Number(row['schema_version'] ?? 7),
    runnerVersion: row['runner_version'] as string,
    runnerStatus: row['runner_status'] ? (row['runner_status'] as string) : undefined,
    printReadinessSummary: row['print_readiness_summary'] ? (row['print_readiness_summary'] as string) : undefined,
    enrolledAt: toDate(row['enrolled_at']),
    lastSeenAt: row['last_seen_at'] ? toDate(row['last_seen_at']) : null,
    connectionState: (row['connection_state'] as DeviceRecord['connectionState']) ?? 'ONLINE',
    printState: (row['print_state'] as DeviceRecord['printState']) ?? 'IDLE',
    otaState: (row['ota_state'] as string) ?? 'IDLE',
    lastOtaOperation: row['last_ota_operation'] ? (row['last_ota_operation'] as string) : null,
    deviceTokenHash: row['device_token_hash'] as string,
    status: (row['status'] as DeviceRecord['status']) ?? 'ACTIVE',
    displayName: row['display_name'] ? (row['display_name'] as string) : undefined,
  };
}

export class SqliteDeviceRegistryRepository implements DeviceRegistryRepositoryPort {
  async findById(deviceId: string): Promise<DeviceRecord | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM control_devices WHERE device_id = ?');
    stmt.bind([deviceId]);
    try {
      if (!stmt.step()) return undefined;
      return rowToDevice(stmt.getAsObject());
    } finally {
      stmt.free();
    }
  }

  async findByInstallationId(installationId: string): Promise<DeviceRecord | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM control_devices WHERE installation_id = ?');
    stmt.bind([installationId]);
    try {
      if (!stmt.step()) return undefined;
      return rowToDevice(stmt.getAsObject());
    } finally {
      stmt.free();
    }
  }

  async findAll(filter?: DeviceRegistryFilter): Promise<DeviceRecord[]> {
    const db = getDb();
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (filter?.siteId) {
      conditions.push('site_id = ?');
      params.push(filter.siteId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.connectionState) {
      conditions.push('connection_state = ?');
      params.push(filter.connectionState);
    }
    if (filter?.otaState) {
      conditions.push('ota_state = ?');
      params.push(filter.otaState);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = db.prepare(`SELECT * FROM control_devices ${where} ORDER BY enrolled_at DESC`);
    if (params.length > 0) stmt.bind(params);

    const devices: DeviceRecord[] = [];
    try {
      while (stmt.step()) {
        devices.push(rowToDevice(stmt.getAsObject()));
      }
      return devices;
    } finally {
      stmt.free();
    }
  }

  async create(input: CreateDeviceRecordInput): Promise<DeviceRecord> {
    const db = getDb();
    const now = dateStr(new Date());
    db.run(
      `INSERT INTO control_devices (
        device_id, installation_id, site_id, hostname, platform, architecture,
        app_version, schema_version, runner_version, enrolled_at, last_seen_at,
        connection_state, print_state, ota_state, device_token_hash, status, display_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE', 'IDLE', 'IDLE', ?, 'ACTIVE', ?)`,
      [
        input.deviceId,
        input.installationId,
        input.siteId,
        input.hostname,
        input.platform,
        input.architecture,
        input.appVersion,
        input.schemaVersion,
        input.runnerVersion,
        now,
        now,
        input.deviceTokenHash,
        input.displayName ?? null,
      ],
    );
    const created = await this.findById(input.deviceId);
    if (!created) throw new Error('Failed to create device record');
    return created;
  }

  async update(deviceId: string, patch: Partial<DeviceRecord>): Promise<DeviceRecord> {
    const db = getDb();
    const sets: string[] = [];
    const params: SqlValue[] = [];

    const add = (col: string, val: SqlValue) => {
      sets.push(`${col} = ?`);
      params.push(val);
    };

    if ('hostname' in patch) add('hostname', patch.hostname ?? null);
    if ('platform' in patch) add('platform', patch.platform ?? null);
    if ('architecture' in patch) add('architecture', patch.architecture ?? null);
    if ('appVersion' in patch) add('app_version', patch.appVersion ?? null);
    if ('schemaVersion' in patch) add('schema_version', patch.schemaVersion ?? null);
    if ('runnerVersion' in patch) add('runner_version', patch.runnerVersion ?? null);
    if ('runnerStatus' in patch) add('runner_status', patch.runnerStatus ?? null);
    if ('printReadinessSummary' in patch) add('print_readiness_summary', patch.printReadinessSummary ?? null);
    if ('connectionState' in patch) add('connection_state', patch.connectionState ?? null);
    if ('printState' in patch) add('print_state', patch.printState ?? null);
    if ('otaState' in patch) add('ota_state', patch.otaState ?? null);
    if ('lastOtaOperation' in patch) add('last_ota_operation', patch.lastOtaOperation ?? null);
    if ('lastSeenAt' in patch) add('last_seen_at', patch.lastSeenAt ? dateStr(patch.lastSeenAt) : null);
    if ('deviceTokenHash' in patch) add('device_token_hash', patch.deviceTokenHash ?? null);
    if ('status' in patch) add('status', patch.status ?? null);
    if ('displayName' in patch) add('display_name', patch.displayName ?? null);

    if (sets.length > 0) {
      params.push(deviceId);
      db.run(`UPDATE control_devices SET ${sets.join(', ')} WHERE device_id = ?`, params);
    }
    const updated = await this.findById(deviceId);
    if (!updated) throw new Error(`Device not found: ${deviceId}`);
    return updated;
  }

  async recordHeartbeat(deviceId: string, heartbeat: DeviceHeartbeatPayload): Promise<DeviceRecord> {
    const db = getDb();
    db.run(
      `UPDATE control_devices SET
        hostname = ?, platform = ?, architecture = ?, app_version = ?,
        schema_version = ?, runner_version = ?, runner_status = ?,
        print_readiness_summary = ?, print_state = ?, ota_state = ?,
        last_ota_operation = COALESCE(?, last_ota_operation),
        last_seen_at = ?, connection_state = 'ONLINE'
       WHERE device_id = ?`,
      [
        heartbeat.hostname,
        heartbeat.platform,
        heartbeat.architecture,
        heartbeat.appVersion,
        heartbeat.schemaVersion,
        heartbeat.runnerVersion,
        heartbeat.runnerStatus,
        heartbeat.printReadinessSummary,
        heartbeat.printState,
        heartbeat.otaState,
        heartbeat.lastOtaOperation ?? null,
        heartbeat.timestamp,
        deviceId,
      ],
    );
    const updated = await this.findById(deviceId);
    if (!updated) throw new Error(`Device not found: ${deviceId}`);
    return updated;
  }

  async delete(deviceId: string): Promise<void> {
    const db = getDb();
    db.run('DELETE FROM control_devices WHERE device_id = ?', [deviceId]);
  }
}

function rowToToken(row: Record<string, unknown>): EnrollmentToken {
  return {
    token: row['token'] as string,
    siteId: row['site_id'] as string,
    expiresAt: toDate(row['expires_at']),
    consumedAt: row['consumed_at'] ? toDate(row['consumed_at']) : null,
    consumedByDeviceId: row['consumed_by_device_id'] ? (row['consumed_by_device_id'] as string) : null,
    createdBy: row['created_by'] as string,
    createdAt: toDate(row['created_at']),
  };
}

export class SqliteEnrollmentTokenRepository implements EnrollmentTokenRepositoryPort {
  async create(input: CreateEnrollmentTokenInput): Promise<EnrollmentToken> {
    const db = getDb();
    const tokenStr = input.token || `enroll_${randomBytes(24).toString('hex')}`;
    const ttlSeconds = input.expiresInSeconds ?? 3600;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    db.run(
      `INSERT INTO control_enrollment_tokens (
        token, site_id, expires_at, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [tokenStr, input.siteId, dateStr(expiresAt), input.createdBy, dateStr(now)],
    );
    const created = await this.findByToken(tokenStr);
    if (!created) throw new Error('Failed to create enrollment token');
    return created;
  }

  async findByToken(token: string): Promise<EnrollmentToken | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM control_enrollment_tokens WHERE token = ?');
    stmt.bind([token]);
    try {
      if (!stmt.step()) return undefined;
      return rowToToken(stmt.getAsObject());
    } finally {
      stmt.free();
    }
  }

  async consume(token: string, deviceId: string): Promise<boolean> {
    const db = getDb();
    const now = dateStr(new Date());
    db.run(
      `UPDATE control_enrollment_tokens
       SET consumed_at = ?, consumed_by_device_id = ?
       WHERE token = ? AND consumed_at IS NULL AND expires_at > ?`,
      [now, deviceId, token, now],
    );
    return db.getRowsModified() > 0;
  }

  async delete(token: string): Promise<void> {
    const db = getDb();
    db.run('DELETE FROM control_enrollment_tokens WHERE token = ?', [token]);
  }
}

function rowToCommand(row: Record<string, unknown>): ControlCommandRecord {
  return {
    commandId: row['command_id'] as string,
    deviceId: row['device_id'] as string,
    type: row['type'] as ControlCommandRecord['type'],
    targetVersion: row['target_version'] ? (row['target_version'] as string) : undefined,
    requestedAt: toDate(row['requested_at']),
    expiresAt: toDate(row['expires_at']),
    requestedBy: row['requested_by'] as string,
    idempotencyKey: row['idempotency_key'] as string,
    status: row['status'] as ControlCommandRecord['status'],
    acceptedAt: row['accepted_at'] ? toDate(row['accepted_at']) : undefined,
    completedAt: row['completed_at'] ? toDate(row['completed_at']) : undefined,
    terminalState: row['terminal_state'] ? (row['terminal_state'] as string) : undefined,
    failureReason: row['failure_reason'] ? (row['failure_reason'] as string) : undefined,
  };
}

export class SqliteControlCommandRepository implements ControlCommandRepositoryPort {
  async create(input: CreateControlCommandInput): Promise<ControlCommandRecord> {
    const db = getDb();
    const commandId = `cmd_${generateId()}`;
    const ttlSeconds = input.expiresInSeconds ?? 600;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    db.run(
      `INSERT INTO control_commands (
        command_id, device_id, type, target_version, requested_at, expires_at,
        requested_by, idempotency_key, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        commandId,
        input.deviceId,
        input.type,
        input.targetVersion ?? null,
        dateStr(now),
        dateStr(expiresAt),
        input.requestedBy,
        input.idempotencyKey,
      ],
    );
    const created = await this.findById(commandId);
    if (!created) throw new Error('Failed to create command record');
    return created;
  }

  async findById(commandId: string): Promise<ControlCommandRecord | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM control_commands WHERE command_id = ?');
    stmt.bind([commandId]);
    try {
      if (!stmt.step()) return undefined;
      return rowToCommand(stmt.getAsObject());
    } finally {
      stmt.free();
    }
  }

  async findByIdempotencyKey(deviceId: string, idempotencyKey: string): Promise<ControlCommandRecord | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM control_commands WHERE device_id = ? AND idempotency_key = ?');
    stmt.bind([deviceId, idempotencyKey]);
    try {
      if (!stmt.step()) return undefined;
      return rowToCommand(stmt.getAsObject());
    } finally {
      stmt.free();
    }
  }

  async findByDeviceId(deviceId: string, opts?: ListOptions): Promise<ControlCommandRecord[]> {
    const db = getDb();
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const stmt = db.prepare(
      'SELECT * FROM control_commands WHERE device_id = ? ORDER BY requested_at DESC LIMIT ? OFFSET ?',
    );
    stmt.bind([deviceId, limit, offset]);
    const commands: ControlCommandRecord[] = [];
    try {
      while (stmt.step()) {
        commands.push(rowToCommand(stmt.getAsObject()));
      }
      return commands;
    } finally {
      stmt.free();
    }
  }

  async update(commandId: string, patch: Partial<ControlCommandRecord>): Promise<ControlCommandRecord> {
    const db = getDb();
    const sets: string[] = [];
    const params: SqlValue[] = [];

    const add = (col: string, val: SqlValue) => {
      sets.push(`${col} = ?`);
      params.push(val);
    };

    if ('status' in patch) add('status', patch.status ?? null);
    if ('acceptedAt' in patch) add('accepted_at', patch.acceptedAt ? dateStr(patch.acceptedAt) : null);
    if ('completedAt' in patch) add('completed_at', patch.completedAt ? dateStr(patch.completedAt) : null);
    if ('terminalState' in patch) add('terminal_state', patch.terminalState ?? null);
    if ('failureReason' in patch) add('failure_reason', patch.failureReason ?? null);

    if (sets.length > 0) {
      params.push(commandId);
      db.run(`UPDATE control_commands SET ${sets.join(', ')} WHERE command_id = ?`, params);
    }
    const updated = await this.findById(commandId);
    if (!updated) throw new Error(`Command not found: ${commandId}`);
    return updated;
  }
}

function rowToRelease(row: Record<string, unknown>): ReleaseCatalogRecord {
  return {
    id: row['id'] as string,
    version: row['version'] as string,
    channel: row['channel'] as ReleaseCatalogRecord['channel'],
    platform: row['platform'] as ReleaseCatalogRecord['platform'],
    architecture: row['architecture'] as ReleaseCatalogRecord['architecture'],
    schemaVersion: Number(row['schema_version'] ?? 7),
    manifestRef: row['manifest_ref'] as string,
    artifactRef: row['artifact_ref'] as string,
    sha256: row['sha256'] as string,
    signature: row['signature'] as string,
    minSupportedVersion: row['min_supported_version'] as string,
    status: row['status'] as ReleaseCatalogRecord['status'],
    createdAt: toDate(row['created_at']),
    releaseNotes: row['release_notes'] ? (row['release_notes'] as string) : undefined,
  };
}

export class SqliteReleaseCatalogRepository implements ReleaseCatalogRepositoryPort {
  async create(input: CreateReleaseCatalogInput): Promise<ReleaseCatalogRecord> {
    const db = getDb();
    const id = `rel_${generateId()}`;
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO control_releases (
        id, version, channel, platform, architecture, schema_version,
        manifest_ref, artifact_ref, sha256, signature, min_supported_version,
        status, release_notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.version,
        input.channel ?? 'stable',
        input.platform ?? 'windows-x64',
        input.architecture ?? 'x64',
        input.schemaVersion,
        input.manifestRef,
        input.artifactRef,
        input.sha256,
        input.signature,
        input.minSupportedVersion ?? '0.1.0',
        input.status ?? 'AVAILABLE',
        input.releaseNotes ?? null,
        now,
      ],
    );
    const created = await this.findById(id);
    if (!created) throw new Error('Failed to create release record');
    return created;
  }

  async findById(id: string): Promise<ReleaseCatalogRecord | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM control_releases WHERE id = ?');
    stmt.bind([id]);
    try {
      if (!stmt.step()) return undefined;
      return rowToRelease(stmt.getAsObject());
    } finally {
      stmt.free();
    }
  }

  async findByVersion(version: string, platform?: string): Promise<ReleaseCatalogRecord | undefined> {
    const db = getDb();
    const query = platform
      ? 'SELECT * FROM control_releases WHERE version = ? AND platform = ?'
      : 'SELECT * FROM control_releases WHERE version = ?';
    const params = platform ? [version, platform] : [version];
    const stmt = db.prepare(query);
    stmt.bind(params);
    try {
      if (!stmt.step()) return undefined;
      return rowToRelease(stmt.getAsObject());
    } finally {
      stmt.free();
    }
  }

  async findAll(filter?: ReleaseCatalogFilter): Promise<ReleaseCatalogRecord[]> {
    const db = getDb();
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (filter?.platform) {
      conditions.push('platform = ?');
      params.push(filter.platform);
    }
    if (filter?.channel) {
      conditions.push('channel = ?');
      params.push(filter.channel);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = db.prepare(`SELECT * FROM control_releases ${where} ORDER BY created_at DESC`);
    if (params.length > 0) stmt.bind(params);

    const releases: ReleaseCatalogRecord[] = [];
    try {
      while (stmt.step()) {
        releases.push(rowToRelease(stmt.getAsObject()));
      }
      return releases;
    } finally {
      stmt.free();
    }
  }

  async update(id: string, patch: Partial<ReleaseCatalogRecord>): Promise<ReleaseCatalogRecord> {
    const db = getDb();
    const sets: string[] = [];
    const params: SqlValue[] = [];

    const add = (col: string, val: SqlValue) => {
      sets.push(`${col} = ?`);
      params.push(val);
    };

    if ('status' in patch) add('status', patch.status ?? null);
    if ('releaseNotes' in patch) add('release_notes', patch.releaseNotes ?? null);

    if (sets.length > 0) {
      params.push(id);
      db.run(`UPDATE control_releases SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    const updated = await this.findById(id);
    if (!updated) throw new Error(`Release not found: ${id}`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    db.run('DELETE FROM control_releases WHERE id = ?', [id]);
  }
}

function rowToAudit(row: Record<string, unknown>): ControlAuditRecord {
  return {
    id: row['id'] as string,
    actor: row['actor'] as string,
    deviceId: row['device_id'] as string,
    commandId: row['command_id'] ? (row['command_id'] as string) : undefined,
    action: row['action'] as string,
    sourceVersion: row['source_version'] ? (row['source_version'] as string) : undefined,
    targetVersion: row['target_version'] ? (row['target_version'] as string) : undefined,
    requestedAt: toDate(row['requested_at']),
    acceptedAt: row['accepted_at'] ? toDate(row['accepted_at']) : undefined,
    terminalState: row['terminal_state'] ? (row['terminal_state'] as string) : undefined,
    failureReason: row['failure_reason'] ? (row['failure_reason'] as string) : undefined,
    metadata: fromJson(row['metadata_json'], {}),
  };
}

export class SqliteControlAuditRepository implements ControlAuditRepositoryPort {
  async record(audit: Omit<ControlAuditRecord, 'id'>): Promise<ControlAuditRecord> {
    const db = getDb();
    const id = `caud_${generateId()}`;
    db.run(
      `INSERT INTO control_audit_logs (
        id, actor, device_id, command_id, action, source_version, target_version,
        requested_at, accepted_at, terminal_state, failure_reason, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        audit.actor,
        audit.deviceId,
        audit.commandId ?? null,
        audit.action,
        audit.sourceVersion ?? null,
        audit.targetVersion ?? null,
        dateStr(audit.requestedAt),
        audit.acceptedAt ? dateStr(audit.acceptedAt) : null,
        audit.terminalState ?? null,
        audit.failureReason ?? null,
        toJson(audit.metadata ?? {}),
      ],
    );
    return { ...audit, id };
  }

  async findByDeviceId(deviceId: string, opts?: ListOptions): Promise<ControlAuditRecord[]> {
    const db = getDb();
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const stmt = db.prepare(
      'SELECT * FROM control_audit_logs WHERE device_id = ? ORDER BY requested_at DESC LIMIT ? OFFSET ?',
    );
    stmt.bind([deviceId, limit, offset]);
    const logs: ControlAuditRecord[] = [];
    try {
      while (stmt.step()) {
        logs.push(rowToAudit(stmt.getAsObject()));
      }
      return logs;
    } finally {
      stmt.free();
    }
  }

  async findAll(opts?: ListOptions): Promise<ControlAuditRecord[]> {
    const db = getDb();
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const stmt = db.prepare(
      'SELECT * FROM control_audit_logs ORDER BY requested_at DESC LIMIT ? OFFSET ?',
    );
    stmt.bind([limit, offset]);
    const logs: ControlAuditRecord[] = [];
    try {
      while (stmt.step()) {
        logs.push(rowToAudit(stmt.getAsObject()));
      }
      return logs;
    } finally {
      stmt.free();
    }
  }
}
