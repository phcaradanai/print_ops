import type { SqlValue } from 'sql.js';
import type { PrinterTemplateBinding, CreatePrinterTemplateBindingInput, PrinterTemplateBindingRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toDate, dateStr } from '../../db/json.js';

function rowToBinding(row: Record<string, unknown>): PrinterTemplateBinding {
  return {
    id: row['id'] as string,
    printerCode: row['printer_code'] as string,
    templateCode: row['template_code'] as string,
    paperProfileId: row['paper_profile_id'] as string,
    isDefault: row['is_default'] === 1 || row['is_default'] === true,
    enabled: row['enabled'] === 1 || row['enabled'] === true,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqlitePrinterTemplateBindingRepository implements PrinterTemplateBindingRepositoryPort {
  async findById(id: string): Promise<PrinterTemplateBinding | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM printer_template_bindings WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToBinding(row);
    }
    stmt.free();
    return undefined;
  }

  async findByPrinterCode(printerCode: string): Promise<PrinterTemplateBinding[]> {
    const db = getDb();
    const stmt = db.prepare(
      'SELECT * FROM printer_template_bindings WHERE printer_code = ? AND enabled = 1 ORDER BY is_default DESC',
    );
    stmt.bind([printerCode]);
    const results: PrinterTemplateBinding[] = [];
    while (stmt.step()) {
      results.push(rowToBinding(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async findByTemplateCode(templateCode: string): Promise<PrinterTemplateBinding[]> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM printer_template_bindings WHERE template_code = ?');
    stmt.bind([templateCode]);
    const results: PrinterTemplateBinding[] = [];
    while (stmt.step()) {
      results.push(rowToBinding(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async findAll(opts?: ListOptions & { printerCode?: string; templateCode?: string }): Promise<PrinterTemplateBinding[]> {
    const db = getDb();
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (opts?.printerCode) {
      clauses.push('printer_code = ?');
      params.push(opts.printerCode as SqlValue);
    }
    if (opts?.templateCode) {
      clauses.push('template_code = ?');
      params.push(opts.templateCode as SqlValue);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;

    const sql = `SELECT * FROM printer_template_bindings ${where} ORDER BY is_default DESC LIMIT ? OFFSET ?`;
    params.push(limit as SqlValue, offset as SqlValue);

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: PrinterTemplateBinding[] = [];
    while (stmt.step()) {
      results.push(rowToBinding(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: CreatePrinterTemplateBindingInput): Promise<PrinterTemplateBinding> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO printer_template_bindings (id, printer_code, template_code, paper_profile_id, is_default, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.printerCode,
        input.templateCode,
        input.paperProfileId,
        input.isDefault ? 1 : 0,
        input.enabled ? 1 : 0,
        now,
        now,
      ],
    );

    const stmt = db.prepare('SELECT * FROM printer_template_bindings WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToBinding(row);
  }

  async update(id: string, patch: Partial<PrinterTemplateBinding>): Promise<PrinterTemplateBinding> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`PrinterTemplateBinding ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('printerCode' in patch) add('printer_code', patch.printerCode);
    if ('templateCode' in patch) add('template_code', patch.templateCode);
    if ('paperProfileId' in patch) add('paper_profile_id', patch.paperProfileId);
    if ('isDefault' in patch) add('is_default', patch.isDefault ? 1 : 0);
    if ('enabled' in patch) add('enabled', patch.enabled ? 1 : 0);

    add('updated_at', dateStr(new Date()));

    const sql = `UPDATE printer_template_bindings SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id as SqlValue);
    db.run(sql, values);

    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    db.run('DELETE FROM printer_template_bindings WHERE id = ?', [id]);
  }
}