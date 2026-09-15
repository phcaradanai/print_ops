import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'sql.js';
import { TERMINAL_PRINT_STATUSES } from '@printerops/domain';

/**
 * Data-retention sweep for the SQLite store.
 *
 * sql.js keeps the whole database in memory and re-exports + rewrites the
 * entire file to disk on every write (see `saveDb()` in sqlite.ts). With no
 * retention policy, a long-running installation that prints every day for
 * months accumulates unbounded `jobs`/`traces`/`audit_logs` rows, and every
 * subsequent write gets slower because it re-serializes that whole history.
 *
 * PrintOps is a print *gateway*, not the system of record for print/job
 * transaction history — the integration system on the other end of the API
 * already owns that data. So this keeps only a short operational window: by
 * default, terminal jobs/audit rows older than 7 days are pruned, and the
 * row count is additionally capped at 1000 per table even within that
 * window, whichever limit is smaller. Both are configurable via env vars for
 * sites that want a longer local window.
 */

/** Only terminal jobs are ever eligible for deletion — in-flight jobs
 * (ACCEPTED/VALIDATED/QUEUED/DISPATCHED/PRINTING) are kept regardless of age
 * or count, since they represent unfinished work, not history. */
const TERMINAL_JOB_STATUSES = TERMINAL_PRINT_STATUSES;

export interface RetentionOptions {
  /** Delete terminal jobs/audit rows older than this many days. 0 disables age-based pruning. */
  retentionDays: number;
  /** Additionally cap each table at this many rows (keeps the most recent). 0 disables the cap. */
  maxRows: number;
  /** When set, every pruned row (jobs, traces, callback deliveries, audit
   * logs) is written to a timestamped JSON file in this directory BEFORE
   * deletion. A failed archive write aborts the sweep — data is never deleted
   * unarchived (product decision, 2026-08-03). */
  archiveDir?: string;
}

export interface RetentionResult {
  jobsDeleted: number;
  tracesDeleted: number;
  auditLogsDeleted: number;
  callbackDeliveriesDeleted: number;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function countRows(db: Database, sql: string, params: (string | number)[]): number {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) {
      return Number(stmt.getAsObject()['c'] ?? 0);
    }
    return 0;
  } finally {
    stmt.free();
  }
}

function collectRows(db: Database, sql: string, params: (string | number)[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

function collectIds(db: Database, sql: string, params: (string | number)[]): string[] {
  const stmt = db.prepare(sql);
  const ids: string[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      ids.push(stmt.getAsObject()['id'] as string);
    }
  } finally {
    stmt.free();
  }
  return ids;
}

/**
 * Deletes terminal jobs (and their traces) that are either older than
 * `retentionDays` OR rank past the newest `maxRows` terminal jobs — and
 * separately applies the same two rules to `audit_logs`. Pass `0` for either
 * option to disable that rule; pass both as `0` to disable pruning entirely.
 */
export function pruneOldRecords(db: Database, options: RetentionOptions): RetentionResult {
  const { retentionDays, maxRows } = options;
  const ageEnabled = Number.isFinite(retentionDays) && retentionDays > 0;
  const countEnabled = Number.isFinite(maxRows) && maxRows > 0;
  if (!ageEnabled && !countEnabled) {
    return { jobsDeleted: 0, tracesDeleted: 0, auditLogsDeleted: 0, callbackDeliveriesDeleted: 0 };
  }

  const cutoff = ageEnabled ? isoDaysAgo(retentionDays) : undefined;
  const statusPlaceholders = TERMINAL_JOB_STATUSES.map(() => '?').join(',');

  // Jobs past the age cutoff.
  const staleByAge = new Set<string>(
    cutoff
      ? collectIds(
          db,
          `SELECT id FROM jobs WHERE status IN (${statusPlaceholders}) AND created_at < ?`,
          [...TERMINAL_JOB_STATUSES, cutoff],
        )
      : [],
  );

  // Terminal jobs ranked past the row-count cap (kept = newest `maxRows`).
  const staleByCount = new Set<string>(
    countEnabled
      ? collectIds(
          db,
          `SELECT id FROM jobs WHERE status IN (${statusPlaceholders})
           ORDER BY created_at DESC LIMIT -1 OFFSET ?`,
          [...TERMINAL_JOB_STATUSES, maxRows],
        )
      : [],
  );

  const staleJobIds = Array.from(new Set([...staleByAge, ...staleByCount]));

  const staleAuditByAge = new Set<string>(
    cutoff ? collectIds(db, 'SELECT id FROM audit_logs WHERE occurred_at < ?', [cutoff]) : [],
  );
  const staleAuditByCount = new Set<string>(
    countEnabled
      ? collectIds(db, 'SELECT id FROM audit_logs ORDER BY occurred_at DESC LIMIT -1 OFFSET ?', [maxRows])
      : [],
  );
  const staleAuditIds = Array.from(new Set([...staleAuditByAge, ...staleAuditByCount]));

  // Archive BEFORE any delete. If this throws, nothing has been pruned yet.
  if (options.archiveDir && (staleJobIds.length > 0 || staleAuditIds.length > 0)) {
    archivePrunedRows(db, options.archiveDir, staleJobIds, staleAuditIds);
  }

  let tracesDeleted = 0;
  let callbackDeliveriesDeleted = 0;
  if (staleJobIds.length > 0) {
    const jobPlaceholders = staleJobIds.map(() => '?').join(',');
    tracesDeleted = countRows(
      db,
      `SELECT COUNT(*) as c FROM traces WHERE job_id IN (${jobPlaceholders})`,
      staleJobIds,
    );
    db.run(`DELETE FROM traces WHERE job_id IN (${jobPlaceholders})`, staleJobIds);
    // Result-callback deliveries belong to the job they report on: keeping them
    // after the job is gone leaves rows nothing can ever be correlated back to,
    // and (for a RETRY_SCHEDULED row) a retry worker chasing a vanished job.
    callbackDeliveriesDeleted = countRows(
      db,
      `SELECT COUNT(*) as c FROM callback_deliveries WHERE print_job_id IN (${jobPlaceholders})`,
      staleJobIds,
    );
    db.run(`DELETE FROM callback_deliveries WHERE print_job_id IN (${jobPlaceholders})`, staleJobIds);
    db.run(`DELETE FROM jobs WHERE id IN (${jobPlaceholders})`, staleJobIds);
  }

  if (staleAuditIds.length > 0) {
    const auditPlaceholders = staleAuditIds.map(() => '?').join(',');
    db.run(`DELETE FROM audit_logs WHERE id IN (${auditPlaceholders})`, staleAuditIds);
  }

  return {
    jobsDeleted: staleJobIds.length,
    tracesDeleted,
    auditLogsDeleted: staleAuditIds.length,
    callbackDeliveriesDeleted,
  };
}

/** Writes every row about to be pruned to a timestamped JSON file. Throws on
 * any write failure so the caller aborts the sweep instead of deleting
 * unarchived history. */
function archivePrunedRows(
  db: Database,
  archiveDir: string,
  staleJobIds: string[],
  staleAuditIds: string[],
): void {
  const jobPlaceholders = staleJobIds.map(() => '?').join(',');
  const auditPlaceholders = staleAuditIds.map(() => '?').join(',');
  const payload = {
    version: 1,
    type: 'printops_retention_archive',
    archivedAt: new Date().toISOString(),
    jobs: staleJobIds.length > 0
      ? collectRows(db, `SELECT * FROM jobs WHERE id IN (${jobPlaceholders})`, staleJobIds)
      : [],
    traces: staleJobIds.length > 0
      ? collectRows(db, `SELECT * FROM traces WHERE job_id IN (${jobPlaceholders})`, staleJobIds)
      : [],
    callbackDeliveries: staleJobIds.length > 0
      ? collectRows(db, `SELECT * FROM callback_deliveries WHERE print_job_id IN (${jobPlaceholders})`, staleJobIds)
      : [],
    auditLogs: staleAuditIds.length > 0
      ? collectRows(db, `SELECT * FROM audit_logs WHERE id IN (${auditPlaceholders})`, staleAuditIds)
      : [],
  };
  mkdirSync(archiveDir, { recursive: true });
  const fileName = `retention-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(join(archiveDir, fileName), JSON.stringify(payload));
}

/**
 * Retention window in days — override via PRINTOPS_RETENTION_DAYS. Defaults
 * to 14 (product decision, 2026-08-03: hot data 7–14 days): PrintOps is a
 * print gateway, not the system of record for print job history, so a short
 * operational window (enough to debug "what happened last week") is enough.
 * `0` disables age-based pruning (count cap still applies unless that is
 * also disabled).
 */
export function retentionDaysFromEnv(): number {
  const raw = process.env['PRINTOPS_RETENTION_DAYS'];
  if (raw === undefined || raw.trim() === '') return 14;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 14;
}

/**
 * Row-count cap per table — override via PRINTOPS_RETENTION_MAX_ROWS.
 * Defaults to 0 = DISABLED (product decision, 2026-08-03: the hot window is
 * bounded by age, not by an arbitrary row count that could silently truncate
 * a busy day's history). Set a positive number to re-enable the cap.
 */
export function retentionMaxRowsFromEnv(): number {
  const raw = process.env['PRINTOPS_RETENTION_MAX_ROWS'];
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Archive directory for pruned rows — <db dir>/archive by default; disable
 * with PRINTOPS_RETENTION_ARCHIVE=false. */
export function retentionArchiveDirFromEnv(): string | undefined {
  if ((process.env['PRINTOPS_RETENTION_ARCHIVE'] ?? '').toLowerCase() === 'false') return undefined;
  const explicit = process.env['PRINTOPS_RETENTION_ARCHIVE_DIR'];
  if (explicit && explicit.trim()) return explicit.trim();
  const dbPath = process.env['PRINTOPS_DB_PATH'] ?? './printops.db';
  const lastSep = Math.max(dbPath.lastIndexOf('/'), dbPath.lastIndexOf('\\'));
  const dbDir = lastSep >= 0 ? dbPath.slice(0, lastSep) : '.';
  return join(dbDir, 'archive');
}
