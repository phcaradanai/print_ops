import type { SqlValue } from 'sql.js';
import type { PrintTemplate, CreatePrintTemplateInput, PrintTemplateRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toDate, dateStr } from '../../db/json.js';

function rowToTemplate(row: Record<string, unknown>): PrintTemplate {
  return {
    id: row['id'] as string,
    templateCode: row['template_code'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) || undefined,
    engine: row['engine'] as PrintTemplate['engine'],
    content: row['content'] as string,
    version: row['version'] as number,
    status: row['status'] as PrintTemplate['status'],
    paperProfileId: (row['paper_profile_id'] as string) || undefined,
    createdBy: row['created_by'] as string,
    updatedBy: row['updated_by'] as string,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqlitePrintTemplateRepository implements PrintTemplateRepositoryPort {
  async findById(id: string): Promise<PrintTemplate | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM print_templates WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToTemplate(row);
    }
    stmt.free();
    return undefined;
  }

  async findByCode(templateCode: string): Promise<PrintTemplate | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM print_templates WHERE template_code = ?');
    stmt.bind([templateCode]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToTemplate(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions & { status?: string }): Promise<PrintTemplate[]> {
    const db = getDb();
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (opts?.status) {
      clauses.push('status = ?');
      params.push(opts.status as SqlValue);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;

    const sql = `SELECT * FROM print_templates ${where} ORDER BY template_code ASC LIMIT ? OFFSET ?`;
    params.push(limit as SqlValue, offset as SqlValue);

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: PrintTemplate[] = [];
    while (stmt.step()) {
      results.push(rowToTemplate(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: CreatePrintTemplateInput): Promise<PrintTemplate> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO print_templates (id, template_code, name, description, engine, content, version, status, paper_profile_id, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.templateCode,
        input.name,
        input.description ?? null,
        input.engine,
        input.content,
        input.version ?? 1,
        input.status ?? 'DRAFT',
        input.paperProfileId ?? null,
        input.createdBy,
        input.updatedBy ?? input.createdBy,
        now,
        now,
      ],
    );

    const stmt = db.prepare('SELECT * FROM print_templates WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToTemplate(row);
  }

  async update(id: string, patch: Partial<PrintTemplate>): Promise<PrintTemplate> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`PrintTemplate ${id} not found`);

    // auto-increment version when content changes
    const newVersion = patch.content && patch.content !== existing.content
      ? existing.version + 1
      : patch.version ?? existing.version;

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('templateCode' in patch) add('template_code', patch.templateCode);
    if ('name' in patch) add('name', patch.name);
    if ('description' in patch) add('description', patch.description ?? null);
    if ('engine' in patch) add('engine', patch.engine);
    if ('content' in patch) add('content', patch.content);
    if ('status' in patch) add('status', patch.status);
    if ('paperProfileId' in patch) add('paper_profile_id', patch.paperProfileId ?? null);
    if ('createdBy' in patch) add('created_by', patch.createdBy);
    if ('updatedBy' in patch) add('updated_by', patch.updatedBy);

    add('version', newVersion);
    add('updated_at', dateStr(new Date()));

    const sql = `UPDATE print_templates SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id as SqlValue);
    db.run(sql, values);

    return (await this.findById(id))!;
  }
}