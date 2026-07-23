import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { closeDatabase, getDb, initDatabase } from '../infra/db/sqlite.js';
import { SqliteAuditRepository } from '../infra/repos/sqlite/sqlite-audit.repo.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'printops-sqlite-schema-'));
  process.env['PRINTOPS_DB_PATH'] = join(tempDir, 'printops.db');
  process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
  await initDatabase();
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SQLite schema migration', () => {
  it('repairs audit_logs databases created with snapshot column names', async () => {
    const db = getDb();
    db.run('DROP TABLE audit_logs');
    db.run(`
      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY NOT NULL,
        trace_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor_id TEXT,
        actor_email TEXT,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        before_snapshot TEXT,
        after_snapshot TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL
      )
    `);
    closeDatabase();

    await initDatabase();
    const audit = await new SqliteAuditRepository().create({
      traceId: 'migration-test',
      action: 'runner.registered',
      resourceType: 'runner',
      resourceId: 'runner-1',
      before: { status: 'offline' },
      after: { status: 'online' },
      metadata: {},
    });

    expect(audit.before).toEqual({ status: 'offline' });
    expect(audit.after).toEqual({ status: 'online' });
  });
});
