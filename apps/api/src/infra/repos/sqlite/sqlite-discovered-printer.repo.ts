import type { SqlValue } from 'sql.js';
import type { DiscoveredPrinter, CreateDiscoveredPrinterInput, DiscoveredPrinterRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toJson, fromJson, dateStr, toDate } from '../../db/json.js';

function rowToDiscoveredPrinter(row: Record<string, unknown>): DiscoveredPrinter {
  return {
    id: row['id'] as string,
    runnerId: row['runner_id'] as string,
    localPrinterName: row['local_printer_name'] as string,
    driverName: (row['driver_name'] as string) || undefined,
    portName: (row['port_name'] as string) || undefined,
    connectionType: row['connection_type'] as DiscoveredPrinter['connectionType'],
    isDefault: row['is_default'] === 1 || row['is_default'] === true,
    isShared: row['is_shared'] === 1 || row['is_shared'] === true,
    attributes: fromJson<Record<string, unknown>>(row['attributes'], {}),
    computerName: (row['computer_name'] as string) || undefined,
    osName: (row['os_name'] as string) || undefined,
    firstSeenAt: toDate(row['first_seen_at']),
    lastSeenAt: toDate(row['last_seen_at']),
    registeredPrinterId: (row['registered_printer_id'] as string) || undefined,
  };
}

export class SqliteDiscoveredPrinterRepository implements DiscoveredPrinterRepositoryPort {
  async findById(id: string): Promise<DiscoveredPrinter | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM discovered_printers WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToDiscoveredPrinter(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions & { runnerId?: string }): Promise<DiscoveredPrinter[]> {
    const db = getDb();
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (opts?.runnerId) {
      clauses.push('runner_id = ?');
      params.push(opts.runnerId as SqlValue);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;

    const sql = `SELECT * FROM discovered_printers ${where} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`;
    params.push(limit as SqlValue, offset as SqlValue);

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: DiscoveredPrinter[] = [];
    while (stmt.step()) {
      results.push(rowToDiscoveredPrinter(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async upsert(input: CreateDiscoveredPrinterInput): Promise<DiscoveredPrinter> {
    const db = getDb();
    const now = dateStr(new Date());

    const findStmt = db.prepare(
      'SELECT * FROM discovered_printers WHERE runner_id = ? AND local_printer_name = ?',
    );
    findStmt.bind([input.runnerId, input.localPrinterName]);

    if (findStmt.step()) {
      const existing = rowToDiscoveredPrinter(findStmt.getAsObject());
      findStmt.free();

      // update existing
      db.run(
        `UPDATE discovered_printers
         SET driver_name = ?, port_name = ?, connection_type = ?, is_default = ?, is_shared = ?,
             attributes = ?, computer_name = ?, os_name = ?, last_seen_at = ?
         WHERE id = ?`,
        [
          input.driverName ?? null,
          input.portName ?? null,
          input.connectionType,
          input.isDefault ? 1 : 0,
          input.isShared ? 1 : 0,
          toJson(input.attributes ?? existing.attributes),
          input.computerName ?? null,
          input.osName ?? null,
          now,
          existing.id,
        ],
      );
      return (await this.findById(existing.id))!;
    }
    findStmt.free();

    // insert new
    const id = generateId();
    db.run(
      `INSERT INTO discovered_printers (id, runner_id, local_printer_name, driver_name, port_name, connection_type, is_default, is_shared, attributes, computer_name, os_name, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.runnerId,
        input.localPrinterName,
        input.driverName ?? null,
        input.portName ?? null,
        input.connectionType,
        input.isDefault ? 1 : 0,
        input.isShared ? 1 : 0,
        toJson(input.attributes ?? {}),
        input.computerName ?? null,
        input.osName ?? null,
        now,
        now,
      ],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, patch: Partial<DiscoveredPrinter>): Promise<DiscoveredPrinter> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`DiscoveredPrinter ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('runnerId' in patch) add('runner_id', patch.runnerId);
    if ('localPrinterName' in patch) add('local_printer_name', patch.localPrinterName);
    if ('driverName' in patch) add('driver_name', patch.driverName ?? null);
    if ('portName' in patch) add('port_name', patch.portName ?? null);
    if ('connectionType' in patch) add('connection_type', patch.connectionType);
    if ('isDefault' in patch) add('is_default', patch.isDefault ? 1 : 0);
    if ('isShared' in patch) add('is_shared', patch.isShared ? 1 : 0);
    if ('attributes' in patch) add('attributes', toJson(patch.attributes ?? {}));
    if ('computerName' in patch) add('computer_name', patch.computerName ?? null);
    if ('osName' in patch) add('os_name', patch.osName ?? null);
    if (patch.firstSeenAt != null) add('first_seen_at', dateStr(patch.firstSeenAt));
    if (patch.lastSeenAt != null) add('last_seen_at', dateStr(patch.lastSeenAt));
    if ('registeredPrinterId' in patch) add('registered_printer_id', patch.registeredPrinterId ?? null);

    if (fields.length > 0) {
      const sql = `UPDATE discovered_printers SET ${fields.join(', ')} WHERE id = ?`;
      values.push(id as SqlValue);
      db.run(sql, values);
    }

    return (await this.findById(id))!;
  }
}