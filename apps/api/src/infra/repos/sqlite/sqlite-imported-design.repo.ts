import type {
  CreateImportedDesignInput,
  ImportedDesign,
  ImportedDesignRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toDate, dateStr } from '../../db/json.js';

function rowToImportedDesign(row: Record<string, unknown>): ImportedDesign {
  return {
    id: row['id'] as string,
    paperProfileId: row['paper_profile_id'] as string,
    sha256: row['sha256'] as string,
    fileName: row['file_name'] as string,
    mimeType: row['mime_type'] as string,
    fitMode: row['fit_mode'] as ImportedDesign['fitMode'],
    dataBase64: row['data_base64'] as string,
    pixelWidth: row['pixel_width'] as number,
    pixelHeight: row['pixel_height'] as number,
    detectedDpi: (row['detected_dpi'] as number | null) ?? null,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqliteImportedDesignRepository
  implements ImportedDesignRepositoryPort
{
  async findById(id: string): Promise<ImportedDesign | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM imported_designs WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToImportedDesign(row);
    }
    stmt.free();
    return undefined;
  }

  async findBySha256(sha256: string): Promise<ImportedDesign | undefined> {
    const db = getDb();
    const stmt = db.prepare(
      'SELECT * FROM imported_designs WHERE sha256 = ?',
    );
    stmt.bind([sha256]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToImportedDesign(row);
    }
    stmt.free();
    return undefined;
  }

  async findByPaperProfileId(
    paperProfileId: string,
  ): Promise<ImportedDesign | undefined> {
    const db = getDb();
    const stmt = db.prepare(
      'SELECT * FROM imported_designs WHERE paper_profile_id = ?',
    );
    stmt.bind([paperProfileId]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToImportedDesign(row);
    }
    stmt.free();
    return undefined;
  }

  async create(input: CreateImportedDesignInput): Promise<ImportedDesign> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO imported_designs (id, paper_profile_id, sha256, file_name, mime_type, fit_mode, data_base64, pixel_width, pixel_height, detected_dpi, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.paperProfileId,
        input.sha256,
        input.fileName,
        input.mimeType,
        input.fitMode,
        input.dataBase64,
        input.pixelWidth,
        input.pixelHeight,
        input.detectedDpi,
        now,
        now,
      ],
    );

    const stmt = db.prepare('SELECT * FROM imported_designs WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToImportedDesign(row);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    db.run('DELETE FROM imported_designs WHERE id = ?', [id]);
  }
}
