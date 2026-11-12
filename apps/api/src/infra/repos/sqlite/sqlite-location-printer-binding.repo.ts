import type { SqlValue } from 'sql.js';
import type {
  CreateLocationPrinterBindingInput,
  LocationPrinterBinding,
  LocationPrinterBindingRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toDate, dateStr } from '../../db/json.js';

function rowToBinding(row: Record<string, unknown>): LocationPrinterBinding {
  return {
    id: row['id'] as string,
    locationCode: row['location_code'] as string,
    printerIp: row['printer_ip'] as string,
    printerName: (row['printer_name'] as string) || undefined,
    printerModel: (row['printer_model'] as string) || undefined,
    isDefault: row['is_default'] === 1,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

function query(sql: string, params: SqlValue[] = []): LocationPrinterBinding[] {
  const stmt = getDb().prepare(sql);
  stmt.bind(params);
  const rows: LocationPrinterBinding[] = [];
  while (stmt.step()) rows.push(rowToBinding(stmt.getAsObject()));
  stmt.free();
  return rows;
}

export class SqliteLocationPrinterBindingRepository implements LocationPrinterBindingRepositoryPort {
  async findById(id: string): Promise<LocationPrinterBinding | undefined> {
    return query('SELECT * FROM location_printer_bindings WHERE id = ?', [id])[0];
  }

  async findAll(opts?: { locationCode?: string }): Promise<LocationPrinterBinding[]> {
    return opts?.locationCode
      ? query('SELECT * FROM location_printer_bindings WHERE location_code = ? ORDER BY is_default DESC, created_at', [opts.locationCode])
      : query('SELECT * FROM location_printer_bindings ORDER BY location_code, is_default DESC, created_at');
  }

  async create(input: CreateLocationPrinterBindingInput): Promise<LocationPrinterBinding> {
    const id = generateId();
    const now = dateStr(new Date());
    getDb().run(
      `INSERT INTO location_printer_bindings (id, location_code, printer_ip, printer_name, printer_model, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.locationCode, input.printerIp, input.printerName ?? null, input.printerModel ?? null, input.isDefault ? 1 : 0, now, now],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, patch: Partial<CreateLocationPrinterBindingInput>): Promise<LocationPrinterBinding> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`LocationPrinterBinding ${id} not found`);
    const next = { ...existing, ...patch };
    getDb().run(
      `UPDATE location_printer_bindings SET location_code = ?, printer_ip = ?, printer_name = ?, printer_model = ?, is_default = ?, updated_at = ? WHERE id = ?`,
      [next.locationCode, next.printerIp, next.printerName ?? null, next.printerModel ?? null, next.isDefault ? 1 : 0, dateStr(new Date()), id],
    );
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    getDb().run('DELETE FROM location_printer_bindings WHERE id = ?', [id]);
  }
}
