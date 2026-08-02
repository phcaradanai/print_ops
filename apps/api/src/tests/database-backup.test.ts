import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { closeDatabase, initDatabase } from '../infra/db/sqlite.js';
import { CURRENT_SCHEMA_VERSION, schemaVersion } from '../infra/db/sqlite.schema.js';
import { databaseBackupRoutes } from '../routes/v1/database-backup.routes.js';

const originalDbPath = process.env['PRINTOPS_DB_PATH'];
const originalWasmPath = process.env['SQL_WASM_PATH'];
const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const directories: string[] = [];

afterEach(() => {
  closeDatabase({ save: false });
  if (originalDbPath === undefined) delete process.env['PRINTOPS_DB_PATH'];
  else process.env['PRINTOPS_DB_PATH'] = originalDbPath;
  if (originalWasmPath === undefined) delete process.env['SQL_WASM_PATH'];
  else process.env['SQL_WASM_PATH'] = originalWasmPath;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('database backup export', () => {
  it('exports a valid current-schema snapshot and audits the OWNER', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'printops-backup-'));
    directories.push(directory);
    process.env['PRINTOPS_DB_PATH'] = join(directory, 'printops.db');
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
    await initDatabase();

    const app = Fastify();
    await app.register(jwt, { secret: 'database-backup-test-secret' });
    const audit = new InMemoryAuditRepository();
    await databaseBackupRoutes(app, { audit, sqliteEnabled: true });
    const token = app.jwt.sign({ sub: 'owner-id', email: 'owner@example.test', role: 'OWNER' });
    const response = await app.inject({
      method: 'GET',
      url: '/system/database-backup',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.sqlite3');
    expect(response.headers['cache-control']).toBe('no-store');
    const SQL = await initSqlJs();
    const snapshot = new SQL.Database(new Uint8Array(response.rawPayload));
    expect(schemaVersion(snapshot)).toBe(CURRENT_SCHEMA_VERSION);
    snapshot.close();

    const logs = await audit.findAll({ resourceType: 'database' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'database.backup_exported',
      actorId: 'owner-id',
      actorEmail: 'owner@example.test',
    });
  });
});
