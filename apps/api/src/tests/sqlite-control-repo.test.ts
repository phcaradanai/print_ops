import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { closeDatabase, getDb, initDatabase } from '../infra/db/sqlite.js';
import { CURRENT_SCHEMA_VERSION, schemaVersion } from '../infra/db/sqlite.schema.js';
import {
  SqliteDeviceRegistryRepository,
  SqliteEnrollmentTokenRepository,
  SqliteControlCommandRepository,
  SqliteReleaseCatalogRepository,
  SqliteControlAuditRepository,
} from '../infra/repos/sqlite/sqlite-control.repo.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
let tempDir: string;

describe('SQLite Control Repositories (Schema v8)', () => {
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'printops-control-sqlite-'));
    process.env['PRINTOPS_DB_PATH'] = join(tempDir, 'printops.db');
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
    await initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates schema to version 8 and initializes control tables', () => {
    const db = getDb();
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(8);

    const tables = db
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .flatMap((r) => r.values.map((v) => v[0]));

    expect(tables).toContain('control_devices');
    expect(tables).toContain('control_enrollment_tokens');
    expect(tables).toContain('control_commands');
    expect(tables).toContain('control_releases');
    expect(tables).toContain('control_audit_logs');
  });

  it('creates and retrieves device records with heartbeats', async () => {
    const repo = new SqliteDeviceRegistryRepository();

    const created = await repo.create({
      deviceId: 'dev_sql_001',
      installationId: 'inst_sql_001',
      siteId: 'site-a',
      hostname: 'station-alpha',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 8,
      runnerVersion: '0.1.28',
      deviceTokenHash: 'hash123456',
      displayName: 'Front Desk Labeler',
    });

    expect(created.deviceId).toBe('dev_sql_001');
    expect(created.installationId).toBe('inst_sql_001');
    expect(created.connectionState).toBe('ONLINE');

    const byId = await repo.findById('dev_sql_001');
    expect(byId?.hostname).toBe('station-alpha');
    expect(byId?.displayName).toBe('Front Desk Labeler');

    const byInst = await repo.findByInstallationId('inst_sql_001');
    expect(byInst?.deviceId).toBe('dev_sql_001');

    // Record heartbeat
    const updated = await repo.recordHeartbeat('dev_sql_001', {
      deviceId: 'dev_sql_001',
      installationId: 'inst_sql_001',
      siteId: 'site-a',
      hostname: 'station-alpha-renamed',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 8,
      runnerVersion: '0.1.28',
      runnerStatus: 'RUNNING',
      printReadinessSummary: 'READY',
      printState: 'IDLE',
      otaState: 'IDLE',
      lastOtaOperation: 'CHECK',
      timestamp: new Date().toISOString(),
    });

    expect(updated.hostname).toBe('station-alpha-renamed');
    expect(updated.runnerStatus).toBe('RUNNING');
    expect(updated.lastOtaOperation).toBe('CHECK');
  });

  it('manages enrollment tokens with atomic one-time consumption', async () => {
    const repo = new SqliteEnrollmentTokenRepository();

    const token = await repo.create({
      siteId: 'clinic-north',
      createdBy: 'admin@hospital.local',
      expiresInSeconds: 300,
    });

    expect(token.token).toMatch(/^enroll_/);
    expect(token.siteId).toBe('clinic-north');
    expect(token.consumedAt).toBeNull();

    const found = await repo.findByToken(token.token);
    expect(found?.token).toBe(token.token);

    // First consumption succeeds
    const consumedFirst = await repo.consume(token.token, 'dev_sql_002');
    expect(consumedFirst).toBe(true);

    const consumedToken = await repo.findByToken(token.token);
    expect(consumedToken?.consumedAt).not.toBeNull();
    expect(consumedToken?.consumedByDeviceId).toBe('dev_sql_002');

    // Second consumption fails (token is already consumed)
    const consumedSecond = await repo.consume(token.token, 'dev_sql_003');
    expect(consumedSecond).toBe(false);
  });

  it('persists commands and enforces idempotency key uniqueness per device', async () => {
    const repo = new SqliteControlCommandRepository();

    const cmd = await repo.create({
      deviceId: 'dev_sql_001',
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      requestedBy: 'operator@hospital.local',
      idempotencyKey: 'idem_key_001',
      expiresInSeconds: 600,
    });

    expect(cmd.commandId).toMatch(/^cmd_/);
    expect(cmd.status).toBe('PENDING');

    const byIdem = await repo.findByIdempotencyKey('dev_sql_001', 'idem_key_001');
    expect(byIdem?.commandId).toBe(cmd.commandId);

    // Duplicate idempotency key for same device fails with unique constraint
    await expect(
      repo.create({
        deviceId: 'dev_sql_001',
        type: 'OTA_INSTALL',
        targetVersion: '0.1.29',
        requestedBy: 'operator@hospital.local',
        idempotencyKey: 'idem_key_001',
      }),
    ).rejects.toThrow();

    // Update command status
    const updated = await repo.update(cmd.commandId, {
      status: 'COMPLETED',
      completedAt: new Date(),
      terminalState: 'COMPLETED',
    });
    expect(updated.status).toBe('COMPLETED');
    expect(updated.terminalState).toBe('COMPLETED');
  });

  it('registers and filters releases in the release catalog', async () => {
    const repo = new SqliteReleaseCatalogRepository();

    const release = await repo.create({
      version: '0.1.29',
      channel: 'stable',
      platform: 'windows-x64',
      architecture: 'x64',
      schemaVersion: 8,
      manifestRef: 'https://releases.local/v0.1.29/manifest.json',
      artifactRef: 'https://releases.local/v0.1.29/PrintOps_0.1.29_x64-setup.exe',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      signature: 'sig_base64_example',
      minSupportedVersion: '0.1.20',
      status: 'AVAILABLE',
      releaseNotes: 'Fixed label rotation margin bug',
    });

    expect(release.id).toMatch(/^rel_/);
    expect(release.version).toBe('0.1.29');

    const byVersion = await repo.findByVersion('0.1.29', 'windows-x64');
    expect(byVersion?.id).toBe(release.id);
    expect(byVersion?.releaseNotes).toBe('Fixed label rotation margin bug');

    const list = await repo.findAll({ channel: 'stable', platform: 'windows-x64' });
    expect(list.length).toBe(1);
    expect(list[0]?.version).toBe('0.1.29');
  });

  it('records and queries control audit logs', async () => {
    const repo = new SqliteControlAuditRepository();

    await repo.record({
      actor: 'operator@hospital.local',
      deviceId: 'dev_sql_001',
      commandId: 'cmd_123',
      action: 'ota.requested',
      sourceVersion: '0.1.28',
      targetVersion: '0.1.29',
      requestedAt: new Date(),
      metadata: { reason: 'Scheduled ward update' },
    });

    const logs = await repo.findByDeviceId('dev_sql_001');
    expect(logs.length).toBe(1);
    expect(logs[0]?.action).toBe('ota.requested');
    expect(logs[0]?.metadata).toEqual({ reason: 'Scheduled ward update' });
  });
});
