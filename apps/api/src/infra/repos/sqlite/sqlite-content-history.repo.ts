import type { SqlValue } from 'sql.js';
import type {
  ContentHistoryRecord,
  ContentHistoryRepositoryPort,
  ContentType,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { dateStr, toDate } from '../../db/json.js';

function rowToHistory(row: Record<string, unknown>): ContentHistoryRecord {
  return {
    id: row['id'] as string,
    contentType: row['content_type'] as ContentType,
    version: row['version'] as number,
    appliedAt: toDate(row['applied_at']),
    manifestJson: row['manifest_json'] as string,
  };
}

export class SqliteContentHistoryRepository implements ContentHistoryRepositoryPort {
  async create(input: Omit<ContentHistoryRecord, 'id'>): Promise<ContentHistoryRecord> {
    const db = getDb();
    const id = generateId();
    const appliedAt = dateStr(new Date());

    db.run(
      `INSERT INTO content_history (id, content_type, version, applied_at, manifest_json)
       VALUES (?, ?, ?, ?, ?)`,
      [id, input.contentType, input.version, appliedAt, input.manifestJson],
    );

    const stmt = db.prepare('SELECT * FROM content_history WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToHistory(row);
  }

  async findByType(contentType: ContentType, limit = 50): Promise<ContentHistoryRecord[]> {
    const db = getDb();
    const stmt = db.prepare(
      'SELECT * FROM content_history WHERE content_type = ? ORDER BY version DESC LIMIT ?',
    );
    stmt.bind([contentType as SqlValue, limit as SqlValue]);
    const results: ContentHistoryRecord[] = [];
    while (stmt.step()) {
      results.push(rowToHistory(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async findByTypeAndVersion(
    contentType: ContentType,
    version: number,
  ): Promise<ContentHistoryRecord | undefined> {
    const db = getDb();
    const stmt = db.prepare(
      'SELECT * FROM content_history WHERE content_type = ? AND version = ?',
    );
    stmt.bind([contentType as SqlValue, version as SqlValue]);
    if (!stmt.step()) {
      stmt.free();
      return undefined;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return rowToHistory(row);
  }
}
