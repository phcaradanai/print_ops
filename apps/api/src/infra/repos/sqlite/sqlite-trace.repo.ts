import type { SqlValue } from 'sql.js';
import type { JobTrace, TraceRepositoryPort } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toJson, fromJson, dateStr, toDate } from '../../db/json.js';

function rowToTrace(row: Record<string, unknown>): JobTrace {
  return {
    id: row['id'] as string,
    jobId: row['job_id'] as string,
    traceId: row['trace_id'] as string,
    correlationId: row['correlation_id'] as string,
    source: row['source'] as string,
    destination: row['destination'] as string,
    runnerId: (row['runner_id'] as string) || undefined,
    printerId: row['printer_id'] as string,
    adapterName: row['adapter_name'] as string,
    queuedAt: (row['queued_at'] as string) ? toDate(row['queued_at']) : undefined,
    startedAt: (row['started_at'] as string) ? toDate(row['started_at']) : undefined,
    finishedAt: (row['finished_at'] as string) ? toDate(row['finished_at']) : undefined,
    durationMs: row['duration_ms'] != null ? Number(row['duration_ms']) : undefined,
    status: row['status'] as JobTrace['status'],
    errorCode: (row['error_code'] as string) || undefined,
    errorMessage: (row['error_message'] as string) || undefined,
    retryCount: Number(row['retry_count']),
    evidence: fromJson<Record<string, unknown>>(row['evidence'], {}),
    steps: fromJson<JobTrace['steps']>(row['steps'], []),
  };
}

export class SqliteTraceRepository implements TraceRepositoryPort {
  async findByJobId(jobId: string): Promise<JobTrace | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM traces WHERE job_id = ? ORDER BY created_at DESC LIMIT 1');
    stmt.bind([jobId]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToTrace(row);
    }
    stmt.free();
    return undefined;
  }

  async create(input: Omit<JobTrace, 'id'>): Promise<JobTrace> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO traces (
        id, job_id, trace_id, correlation_id, source, destination,
        runner_id, printer_id, adapter_name,
        queued_at, started_at, finished_at, duration_ms,
        status, error_code, error_message, retry_count,
        evidence, steps, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.jobId,
        input.traceId,
        input.correlationId,
        input.source,
        input.destination,
        input.runnerId ?? null,
        input.printerId,
        input.adapterName,
        input.queuedAt ? dateStr(input.queuedAt) : null,
        input.startedAt ? dateStr(input.startedAt) : null,
        input.finishedAt ? dateStr(input.finishedAt) : null,
        input.durationMs ?? null,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.retryCount,
        toJson(input.evidence),
        toJson(input.steps),
        now,
        now,
      ],
    );

    const stmt = db.prepare('SELECT * FROM traces WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToTrace(row);
  }

  async update(id: string, patch: Partial<JobTrace>): Promise<JobTrace> {
    const db = getDb();

    const stmt = db.prepare('SELECT * FROM traces WHERE id = ?');
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      throw new Error(`Trace ${id} not found`);
    }
    stmt.free();

    const now = dateStr(new Date());
    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('jobId' in patch) add('job_id', patch.jobId);
    if ('traceId' in patch) add('trace_id', patch.traceId);
    if ('correlationId' in patch) add('correlation_id', patch.correlationId);
    if ('source' in patch) add('source', patch.source);
    if ('destination' in patch) add('destination', patch.destination);
    if ('runnerId' in patch) add('runner_id', patch.runnerId ?? null);
    if ('printerId' in patch) add('printer_id', patch.printerId);
    if ('adapterName' in patch) add('adapter_name', patch.adapterName);
    if ('queuedAt' in patch) add('queued_at', patch.queuedAt ? dateStr(patch.queuedAt) : null);
    if ('startedAt' in patch) add('started_at', patch.startedAt ? dateStr(patch.startedAt) : null);
    if ('finishedAt' in patch) add('finished_at', patch.finishedAt ? dateStr(patch.finishedAt) : null);
    if ('durationMs' in patch) add('duration_ms', patch.durationMs ?? null);
    if ('status' in patch) add('status', patch.status);
    if ('errorCode' in patch) add('error_code', patch.errorCode ?? null);
    if ('errorMessage' in patch) add('error_message', patch.errorMessage ?? null);
    if ('retryCount' in patch) add('retry_count', patch.retryCount);
    if ('evidence' in patch) add('evidence', toJson(patch.evidence ?? {}));
    if ('steps' in patch) add('steps', toJson(patch.steps ?? []));

    add('updated_at', now);

    if (fields.length > 0) {
      const sql = `UPDATE traces SET ${fields.join(', ')} WHERE id = ?`;
      values.push(id as SqlValue);
      db.run(sql, values);
    }

    // Re-fetch
    const stmt2 = db.prepare('SELECT * FROM traces WHERE id = ?');
    stmt2.bind([id]);
    stmt2.step();
    const row = stmt2.getAsObject();
    stmt2.free();
    return rowToTrace(row);
  }
}