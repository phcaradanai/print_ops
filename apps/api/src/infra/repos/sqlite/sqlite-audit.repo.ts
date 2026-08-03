import type { SqlValue } from 'sql.js';
import type { AuditLog, CreateAuditLogInput, AuditRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toJson, fromJson, dateStr, toDate } from '../../db/json.js';

function rowToAudit(row: Record<string, unknown>): AuditLog {
  return {
    id: row['id'] as string,
    traceId: row['trace_id'] as string,
    action: row['action'] as AuditLog['action'],
    actorId: (row['actor_id'] as string) || undefined,
    actorEmail: (row['actor_email'] as string) || undefined,
    resourceType: row['resource_type'] as string,
    resourceId: row['resource_id'] as string,
    before: row['before'] ? fromJson<Record<string, unknown>>(row['before'], {}) : undefined,
    after: row['after'] ? fromJson<Record<string, unknown>>(row['after'], {}) : undefined,
    metadata: fromJson<Record<string, unknown>>(row['metadata'], {}),
    occurredAt: toDate(row['occurred_at']),
  };
}

export class SqliteAuditRepository implements AuditRepositoryPort {
  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const db = getDb();
    const id = generateId();
    const occurredAt = dateStr(new Date());

    db.run(
      `INSERT INTO audit_logs (id, trace_id, action, actor_id, actor_email, resource_type, resource_id, before, after, metadata, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.traceId,
        input.action,
        input.actorId ?? null,
        input.actorEmail ?? null,
        input.resourceType,
        input.resourceId,
        input.before ? toJson(input.before) : null,
        input.after ? toJson(input.after) : null,
        toJson(input.metadata),
        occurredAt,
      ],
    );

    const stmt = db.prepare('SELECT * FROM audit_logs WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToAudit(row);
  }

  async findAll(
    opts?: ListOptions & { resourceType?: string; resourceId?: string; actorId?: string },
  ): Promise<AuditLog[]> {
    const db = getDb();
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (opts?.resourceType) {
      clauses.push('resource_type = ?');
      params.push(opts.resourceType as SqlValue);
    }
    if (opts?.resourceId) {
      clauses.push('resource_id = ?');
      params.push(opts.resourceId as SqlValue);
    }
    if (opts?.actorId) {
      clauses.push('actor_id = ?');
      params.push(opts.actorId as SqlValue);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;

    const sql = `SELECT * FROM audit_logs ${where} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`;
    params.push(limit as SqlValue, offset as SqlValue);

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: AuditLog[] = [];
    while (stmt.step()) {
      results.push(rowToAudit(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }
}