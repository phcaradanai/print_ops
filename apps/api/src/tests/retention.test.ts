import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { closeDatabase, getDb, initDatabase } from '../infra/db/sqlite.js';
import { pruneOldRecords, retentionDaysFromEnv, retentionMaxRowsFromEnv } from '../infra/db/retention.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'printops-retention-'));
  process.env['PRINTOPS_DB_PATH'] = join(tempDir, 'printops.db');
  process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
  await initDatabase();
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env['PRINTOPS_RETENTION_DAYS'];
  delete process.env['PRINTOPS_RETENTION_MAX_ROWS'];
});

function insertJob(id: string, status: string, createdAt: string) {
  const db = getDb();
  db.run(
    `INSERT INTO jobs (id, printer_id, created_by, status, trace_id, correlation_id, mime_type, created_at, updated_at)
     VALUES (?, 'printer-1', 'tester', ?, 'trace-1', 'corr-1', 'text/plain', ?, ?)`,
    [id, status, createdAt, createdAt],
  );
}

function insertTrace(id: string, jobId: string) {
  const db = getDb();
  db.run(
    `INSERT INTO traces (id, job_id, trace_id, correlation_id, source, destination, printer_id, adapter_name, created_at, updated_at)
     VALUES (?, ?, 'trace-1', 'corr-1', 'test', 'test', 'printer-1', 'fake', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
    [id, jobId],
  );
}

function insertAudit(id: string, occurredAt: string) {
  const db = getDb();
  db.run(
    `INSERT INTO audit_logs (id, trace_id, action, resource_type, resource_id, metadata, occurred_at)
     VALUES (?, 'trace-1', 'job.created', 'job', 'job-x', '{}', ?)`,
    [id, occurredAt],
  );
}

const OLD_DATE = '2000-01-01T00:00:00.000Z';
const RECENT_DATE = new Date().toISOString();

describe('pruneOldRecords — age-based cutoff', () => {
  it('deletes terminal jobs (and their traces) older than the retention window, keeps recent and in-flight ones', () => {
    insertJob('old-success', 'SUCCESS', OLD_DATE);
    insertTrace('old-success-trace', 'old-success');
    insertJob('old-queued', 'QUEUED', OLD_DATE); // in-flight — must survive regardless of age
    insertJob('recent-success', 'SUCCESS', RECENT_DATE);

    const result = pruneOldRecords(getDb(), { retentionDays: 7, maxRows: 0 });

    expect(result.jobsDeleted).toBe(1);
    expect(result.tracesDeleted).toBe(1);

    const db = getDb();
    const remainingIds: string[] = [];
    const stmt = db.prepare('SELECT id FROM jobs ORDER BY id');
    while (stmt.step()) remainingIds.push(stmt.getAsObject()['id'] as string);
    stmt.free();

    expect(remainingIds.sort()).toEqual(['old-queued', 'recent-success']);

    const traceCountStmt = db.prepare("SELECT COUNT(*) as c FROM traces WHERE id = 'old-success-trace'");
    traceCountStmt.step();
    expect(traceCountStmt.getAsObject()['c']).toBe(0);
    traceCountStmt.free();
  });

  it('deletes old audit log rows independently of job retention', () => {
    insertAudit('old-audit', OLD_DATE);
    insertAudit('recent-audit', RECENT_DATE);

    const result = pruneOldRecords(getDb(), { retentionDays: 7, maxRows: 0 });

    expect(result.auditLogsDeleted).toBe(1);
    const db = getDb();
    const stmt = db.prepare('SELECT id FROM audit_logs ORDER BY id');
    const remaining: string[] = [];
    while (stmt.step()) remaining.push(stmt.getAsObject()['id'] as string);
    stmt.free();
    expect(remaining).toEqual(['recent-audit']);
  });

  it('is a no-op when both retentionDays and maxRows are 0', () => {
    insertJob('old-success', 'SUCCESS', OLD_DATE);
    insertAudit('old-audit', OLD_DATE);

    const result = pruneOldRecords(getDb(), { retentionDays: 0, maxRows: 0 });

    expect(result).toEqual({
      jobsDeleted: 0,
      tracesDeleted: 0,
      auditLogsDeleted: 0,
      callbackDeliveriesDeleted: 0,
    });
    const db = getDb();
    const stmt = db.prepare('SELECT COUNT(*) as c FROM jobs');
    stmt.step();
    expect(stmt.getAsObject()['c']).toBe(1);
    stmt.free();
  });
});

describe('pruneOldRecords — row-count cap', () => {
  it('keeps only the newest maxRows terminal jobs even when all are within the age window', () => {
    // 5 recent terminal jobs, capped to the newest 3 by created_at.
    for (let i = 0; i < 5; i++) {
      insertJob(`job-${i}`, 'SUCCESS', new Date(Date.now() - i * 1000).toISOString());
    }
    insertJob('in-flight', 'QUEUED', new Date(Date.now() - 999_000).toISOString());

    const result = pruneOldRecords(getDb(), { retentionDays: 0, maxRows: 3 });

    expect(result.jobsDeleted).toBe(2); // job-3 and job-4 are the oldest two of the five
    const db = getDb();
    const stmt = db.prepare('SELECT id FROM jobs ORDER BY id');
    const remaining: string[] = [];
    while (stmt.step()) remaining.push(stmt.getAsObject()['id'] as string);
    stmt.free();
    expect(remaining.sort()).toEqual(['in-flight', 'job-0', 'job-1', 'job-2']);
  });

  it('caps audit_logs at maxRows regardless of age', () => {
    for (let i = 0; i < 5; i++) {
      insertAudit(`audit-${i}`, new Date(Date.now() - i * 1000).toISOString());
    }

    const result = pruneOldRecords(getDb(), { retentionDays: 0, maxRows: 3 });

    expect(result.auditLogsDeleted).toBe(2);
    const db = getDb();
    const stmt = db.prepare('SELECT COUNT(*) as c FROM audit_logs');
    stmt.step();
    expect(stmt.getAsObject()['c']).toBe(3);
    stmt.free();
  });
});

describe('retentionDaysFromEnv / retentionMaxRowsFromEnv', () => {
  it('defaults to 7 days and 1000 rows when unset', () => {
    delete process.env['PRINTOPS_RETENTION_DAYS'];
    delete process.env['PRINTOPS_RETENTION_MAX_ROWS'];
    expect(retentionDaysFromEnv()).toBe(7);
    expect(retentionMaxRowsFromEnv()).toBe(1000);
  });

  it('reads configured values, and falls back to defaults for invalid input', () => {
    process.env['PRINTOPS_RETENTION_DAYS'] = '30';
    expect(retentionDaysFromEnv()).toBe(30);
    process.env['PRINTOPS_RETENTION_DAYS'] = 'not-a-number';
    expect(retentionDaysFromEnv()).toBe(7);
    process.env['PRINTOPS_RETENTION_DAYS'] = '0';
    expect(retentionDaysFromEnv()).toBe(0);

    process.env['PRINTOPS_RETENTION_MAX_ROWS'] = '500';
    expect(retentionMaxRowsFromEnv()).toBe(500);
    process.env['PRINTOPS_RETENTION_MAX_ROWS'] = 'nope';
    expect(retentionMaxRowsFromEnv()).toBe(1000);
    process.env['PRINTOPS_RETENTION_MAX_ROWS'] = '0';
    expect(retentionMaxRowsFromEnv()).toBe(0);
  });
});
