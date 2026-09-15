import type {
  CreatePrinterPaperCalibrationInput,
  ListOptions,
  PrinterPaperCalibration,
  PrinterPaperCalibrationRepositoryPort,
  UpdatePrinterPaperCalibrationInput,
} from '@printerops/domain';
import type { SqlValue } from 'sql.js';
import { generateId } from '@printerops/shared';

function assertCalibrationOffsets(xOffsetDots: number, yOffsetDots: number): void {
  if (
    !Number.isInteger(xOffsetDots) || Math.abs(xOffsetDots) > 10000 ||
    !Number.isInteger(yOffsetDots) || Math.abs(yOffsetDots) > 10000
  ) {
    throw new Error('Calibration offsets must be whole numbers from -10000 to 10000');
  }
}
import { getDb } from '../../db/sqlite.js';
import { dateStr, toDate } from '../../db/json.js';

function rowToCalibration(row: Record<string, unknown>): PrinterPaperCalibration {
  return {
    id: row['id'] as string,
    printerId: row['printer_id'] as string,
    paperProfileId: row['paper_profile_id'] as string,
    dpi: row['dpi'] as number,
    xOffsetDots: row['x_offset_dots'] as number,
    yOffsetDots: row['y_offset_dots'] as number,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqlitePrinterPaperCalibrationRepository implements PrinterPaperCalibrationRepositoryPort {
  async findById(id: string): Promise<PrinterPaperCalibration | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM printer_paper_calibrations WHERE id = ?');
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      return undefined;
    }
    const result = rowToCalibration(stmt.getAsObject());
    stmt.free();
    return result;
  }

  async findByKey(printerId: string, paperProfileId: string, dpi: number): Promise<PrinterPaperCalibration | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM printer_paper_calibrations WHERE printer_id = ? AND paper_profile_id = ? AND dpi = ?');
    stmt.bind([printerId, paperProfileId, dpi]);
    if (!stmt.step()) {
      stmt.free();
      return undefined;
    }
    const result = rowToCalibration(stmt.getAsObject());
    stmt.free();
    return result;
  }

  async findAll(opts?: ListOptions & { printerId?: string; paperProfileId?: string }): Promise<PrinterPaperCalibration[]> {
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    if (opts?.printerId) {
      clauses.push('printer_id = ?');
      values.push(opts.printerId);
    }
    if (opts?.paperProfileId) {
      clauses.push('paper_profile_id = ?');
      values.push(opts.paperProfileId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push((opts?.limit ?? -1) as SqlValue, (opts?.offset ?? 0) as SqlValue);
    const stmt = getDb().prepare(`SELECT * FROM printer_paper_calibrations ${where} ORDER BY printer_id, paper_profile_id, dpi LIMIT ? OFFSET ?`);
    stmt.bind(values);
    const results: PrinterPaperCalibration[] = [];
    while (stmt.step()) results.push(rowToCalibration(stmt.getAsObject()));
    stmt.free();
    return results;
  }

  async create(input: CreatePrinterPaperCalibrationInput): Promise<PrinterPaperCalibration> {
    assertCalibrationOffsets(input.xOffsetDots, input.yOffsetDots);
    const id = generateId();
    const now = dateStr(new Date());
    getDb().run(
      'INSERT INTO printer_paper_calibrations (id, printer_id, paper_profile_id, dpi, x_offset_dots, y_offset_dots, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, input.printerId, input.paperProfileId, input.dpi, input.xOffsetDots, input.yOffsetDots, now, now],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, patch: UpdatePrinterPaperCalibrationInput): Promise<PrinterPaperCalibration> {
    const current = await this.findById(id);
    if (!current) throw new Error(`PrinterPaperCalibration ${id} not found`);
    assertCalibrationOffsets(patch.xOffsetDots, patch.yOffsetDots);
    const fields: string[] = [];
    const values: SqlValue[] = [];
    const add = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      values.push(value as SqlValue);
    };
    if ('xOffsetDots' in patch) add('x_offset_dots', patch.xOffsetDots);
    if ('yOffsetDots' in patch) add('y_offset_dots', patch.yOffsetDots);
    add('updated_at', dateStr(new Date()));
    values.push(id);
    getDb().run(`UPDATE printer_paper_calibrations SET ${fields.join(', ')} WHERE id = ?`, values);
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    getDb().run('DELETE FROM printer_paper_calibrations WHERE id = ?', [id]);
  }
}
