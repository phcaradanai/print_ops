import type { SqlValue } from 'sql.js';
import type { Printer, CreatePrinterInput, PrinterRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toJson, fromJson, toBool, dateStr, toDate } from '../../db/json.js';

function rowToPrinter(row: Record<string, unknown>): Printer {
  return {
    id: row['id'] as string,
    code: row['code'] as string,
    name: row['name'] as string,
    location: (row['location'] as string) || undefined,
    protocol: row['protocol'] as Printer['protocol'],
    connectionUri: row['connection_uri'] as string,
    capabilities: fromJson<Printer['capabilities']>(row['capabilities'], undefined),
    status: fromJson<Printer['status']>(row['status'], undefined),
    allowedTemplates: fromJson<Printer['allowedTemplates']>(row['allowed_templates'], undefined),
    maxCopiesPerJob: row['max_copies_per_job'] != null ? Number(row['max_copies_per_job']) : undefined,
    metadata: fromJson<Record<string, unknown>>(row['metadata'], {}),
    isActive: toBool(row['is_active']),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqlitePrinterRepository implements PrinterRepositoryPort {
  async findById(id: string): Promise<Printer | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM printers WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToPrinter(row);
    }
    stmt.free();
    return undefined;
  }

  async findByCode(code: string): Promise<Printer | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM printers WHERE code = ? AND is_active = 1');
    stmt.bind([code]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToPrinter(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions): Promise<Printer[]> {
    const db = getDb();
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;
    const stmt = db.prepare('SELECT * FROM printers ORDER BY created_at DESC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const results: Printer[] = [];
    while (stmt.step()) {
      results.push(rowToPrinter(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: CreatePrinterInput): Promise<Printer> {
    const db = getDb();
    const now = new Date();
    const nowStr = dateStr(now);
    const id = generateId();
    const code = input.code ?? input.name.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    const isActive = input.isActive ?? true;

    db.run(
      `INSERT INTO printers (id, code, name, location, protocol, connection_uri, capabilities, allowed_templates, max_copies_per_job, metadata, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        code,
        input.name,
        input.location ?? null,
        input.protocol,
        input.connectionUri,
        input.capabilities ? toJson(input.capabilities) : null,
        input.allowedTemplates ? toJson(input.allowedTemplates) : null,
        input.maxCopiesPerJob ?? null,
        toJson(input.metadata ?? {}),
        isActive ? 1 : 0,
        nowStr,
        nowStr,
      ],
    );

    const stmt = db.prepare('SELECT * FROM printers WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToPrinter(row);
  }

  async update(id: string, patch: Partial<Printer>): Promise<Printer> {
    const db = getDb();

    const existing = await this.findById(id);
    if (!existing) throw new Error(`Printer ${id} not found`);

    const now = dateStr(new Date());
    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('code' in patch) add('code', patch.code);
    if ('name' in patch) add('name', patch.name);
    if ('location' in patch) add('location', patch.location ?? null);
    if ('protocol' in patch) add('protocol', patch.protocol);
    if ('connectionUri' in patch) add('connection_uri', patch.connectionUri);
    if ('capabilities' in patch) add('capabilities', patch.capabilities != null ? toJson(patch.capabilities) : null);
    if ('status' in patch) add('status', patch.status != null ? toJson(patch.status) : null);
    if ('allowedTemplates' in patch) add('allowed_templates', patch.allowedTemplates != null ? toJson(patch.allowedTemplates) : null);
    if ('maxCopiesPerJob' in patch) add('max_copies_per_job', patch.maxCopiesPerJob ?? null);
    if ('metadata' in patch) add('metadata', toJson(patch.metadata ?? {}));
    if ('isActive' in patch) add('is_active', patch.isActive ? 1 : 0);

    add('updated_at', now);

    if (fields.length > 0) {
      const sql = `UPDATE printers SET ${fields.join(', ')} WHERE id = ?`;
      values.push(id as SqlValue);
      db.run(sql, values);
    }

    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    db.run('DELETE FROM printers WHERE id = ?', [id]);
  }
}