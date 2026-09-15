import type { SqlValue } from 'sql.js';
import type {
  OtaUpdateStateRecord,
  OtaUpdateStateRepositoryPort,
  UpdateState,
} from '@printerops/domain';
import { getDb } from '../../db/sqlite.js';
import { dateStr, toDate } from '../../db/json.js';

function rowToState(row: Record<string, unknown>): OtaUpdateStateRecord {
  return {
    state: row['state'] as UpdateState,
    targetVersion: (row['target_version'] as string) || null,
    startedAt: row['started_at'] ? toDate(row['started_at']) : null,
    updatedAt: toDate(row['updated_at']),
    errorMessage: (row['error_message'] as string) || null,
    retryCount: (row['retry_count'] as number) || 0,
  };
}

export class SqliteOtaUpdateStateRepository implements OtaUpdateStateRepositoryPort {
  async get(): Promise<OtaUpdateStateRecord> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM ota_update_state WHERE id = 1');
    try {
      if (!stmt.step()) {
        // Singleton row missing — create it.
        db.run(
          `INSERT INTO ota_update_state (id, state, updated_at) VALUES (1, 'IDLE', ?)`,
          [dateStr(new Date())],
        );
        stmt.free();
        const stmt2 = db.prepare('SELECT * FROM ota_update_state WHERE id = 1');
        stmt2.step();
        const row = stmt2.getAsObject();
        stmt2.free();
        return rowToState(row);
      }
      const row = stmt.getAsObject();
      return rowToState(row);
    } finally {
      stmt.free();
    }
  }

  async update(patch: Partial<OtaUpdateStateRecord>): Promise<OtaUpdateStateRecord> {
    const db = getDb();
    const current = await this.get();
    const updated: OtaUpdateStateRecord = {
      ...current,
      ...patch,
      updatedAt: new Date(),
    };

    const sets: string[] = [];
    const params: SqlValue[] = [];

    if (patch.state !== undefined) {
      sets.push('state = ?');
      params.push(patch.state as SqlValue);
    }
    if (patch.targetVersion !== undefined) {
      sets.push('target_version = ?');
      params.push(patch.targetVersion ?? null);
    }
    if (patch.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(patch.startedAt ? dateStr(patch.startedAt) : null);
    }
    if (patch.errorMessage !== undefined) {
      sets.push('error_message = ?');
      params.push(patch.errorMessage ?? null);
    }
    if (patch.retryCount !== undefined) {
      sets.push('retry_count = ?');
      params.push(patch.retryCount as SqlValue);
    }

    sets.push('updated_at = ?');
    params.push(dateStr(updated.updatedAt));

    params.push(1); // id

    db.run(`UPDATE ota_update_state SET ${sets.join(', ')} WHERE id = ?`, params);
    return updated;
  }
}
