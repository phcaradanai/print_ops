import type { SqlValue } from 'sql.js';
import type { CreatePaperProfileInput, ListOptions, PaperProfile, PaperProfileRepositoryPort } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toDate, dateStr } from '../../db/json.js';

function rowToPaperProfile(row: Record<string, unknown>): PaperProfile {
  return {
    id: row['id'] as string,
    code: row['code'] as string,
    name: row['name'] as string,
    widthMm: row['width_mm'] as number,
    heightMm: row['height_mm'] as number,
    marginTopMm: row['margin_top_mm'] as number,
    marginRightMm: row['margin_right_mm'] as number,
    marginBottomMm: row['margin_bottom_mm'] as number,
    marginLeftMm: row['margin_left_mm'] as number,
    dpi: row['dpi'] as number,
    orientation: row['orientation'] as PaperProfile['orientation'],
    unit: row['unit'] as PaperProfile['unit'],
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqlitePaperProfileRepository implements PaperProfileRepositoryPort {
  async findById(id: string): Promise<PaperProfile | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM paper_profiles WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToPaperProfile(row);
    }
    stmt.free();
    return undefined;
  }

  async findByCode(code: string): Promise<PaperProfile | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM paper_profiles WHERE code = ?');
    stmt.bind([code]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToPaperProfile(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions): Promise<PaperProfile[]> {
    const db = getDb();
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;
    const stmt = db.prepare('SELECT * FROM paper_profiles ORDER BY code ASC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const results: PaperProfile[] = [];
    while (stmt.step()) {
      results.push(rowToPaperProfile(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: CreatePaperProfileInput): Promise<PaperProfile> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO paper_profiles (id, code, name, width_mm, height_mm, margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm, dpi, orientation, unit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.code,
        input.name,
        input.widthMm,
        input.heightMm,
        input.marginTopMm,
        input.marginRightMm,
        input.marginBottomMm,
        input.marginLeftMm,
        input.dpi,
        input.orientation,
        input.unit,
        now,
        now,
      ],
    );

    const stmt = db.prepare('SELECT * FROM paper_profiles WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToPaperProfile(row);
  }

  async update(id: string, patch: Partial<PaperProfile>): Promise<PaperProfile> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`PaperProfile ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('code' in patch) add('code', patch.code);
    if ('name' in patch) add('name', patch.name);
    if ('widthMm' in patch) add('width_mm', patch.widthMm);
    if ('heightMm' in patch) add('height_mm', patch.heightMm);
    if ('marginTopMm' in patch) add('margin_top_mm', patch.marginTopMm);
    if ('marginRightMm' in patch) add('margin_right_mm', patch.marginRightMm);
    if ('marginBottomMm' in patch) add('margin_bottom_mm', patch.marginBottomMm);
    if ('marginLeftMm' in patch) add('margin_left_mm', patch.marginLeftMm);
    if ('dpi' in patch) add('dpi', patch.dpi);
    if ('orientation' in patch) add('orientation', patch.orientation);
    if ('unit' in patch) add('unit', patch.unit);

    add('updated_at', dateStr(new Date()));

    const sql = `UPDATE paper_profiles SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id as SqlValue);
    db.run(sql, values);

    return (await this.findById(id))!;
  }
}