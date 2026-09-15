import type { SqlValue } from 'sql.js';
import type { Runner, RegisterRunnerInput, RunnerRepositoryPort, ListOptions } from '@printerops/domain';
import { getDb } from '../../db/sqlite.js';
import { toJson, fromJson, dateStr, toDate } from '../../db/json.js';

function rowToRunner(row: Record<string, unknown>): Runner {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    hostname: row['hostname'] as string,
    ipAddress: (row['ip_address'] as string) || undefined,
    status: row['status'] as Runner['status'],
    supportedProtocols: fromJson<string[]>(row['supported_protocols'], []),
    lastHeartbeatAt: (row['last_heartbeat_at'] as string) ? toDate(row['last_heartbeat_at']) : undefined,
    registeredAt: toDate(row['registered_at']),
    metadata: fromJson<Record<string, unknown>>(row['metadata'], {}),
  };
}

export class SqliteRunnerRepository implements RunnerRepositoryPort {
  async findById(id: string): Promise<Runner | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM runners WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToRunner(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions): Promise<Runner[]> {
    const db = getDb();
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;
    const stmt = db.prepare('SELECT * FROM runners ORDER BY registered_at DESC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const results: Runner[] = [];
    while (stmt.step()) {
      results.push(rowToRunner(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: RegisterRunnerInput & { id: string }): Promise<Runner> {
    const db = getDb();
    const now = new Date();
    const nowStr = dateStr(now);

    db.run(
      `INSERT INTO runners (id, name, hostname, ip_address, status, supported_protocols, registered_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.name,
        input.hostname,
        input.ipAddress ?? null,
        'online',
        toJson(input.supportedProtocols),
        nowStr,
        toJson(input.metadata),
      ],
    );

    const stmt = db.prepare('SELECT * FROM runners WHERE id = ?');
    stmt.bind([input.id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToRunner(row);
  }

  async update(id: string, patch: Partial<Runner>): Promise<Runner> {
    const db = getDb();

    const existing = await this.findById(id);
    if (!existing) throw new Error(`Runner ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('name' in patch) add('name', patch.name);
    if ('hostname' in patch) add('hostname', patch.hostname);
    if ('ipAddress' in patch) add('ip_address', patch.ipAddress ?? null);
    if ('status' in patch) add('status', patch.status);
    if ('supportedProtocols' in patch) add('supported_protocols', toJson(patch.supportedProtocols ?? []));
    if ('lastHeartbeatAt' in patch) add('last_heartbeat_at', patch.lastHeartbeatAt ? dateStr(patch.lastHeartbeatAt) : null);
    if ('metadata' in patch) add('metadata', toJson(patch.metadata ?? {}));

    if (fields.length > 0) {
      const sql = `UPDATE runners SET ${fields.join(', ')} WHERE id = ?`;
      values.push(id as SqlValue);
      db.run(sql, values);
    }

    return (await this.findById(id))!;
  }
}