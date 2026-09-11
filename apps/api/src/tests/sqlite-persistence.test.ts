import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { SqlitePaperProfileRepository } from '../infra/repos/sqlite/sqlite-paper-profile.repo.js';
import { closeDatabase, initDatabase } from '../infra/db/sqlite.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'printops-sqlite-persistence-'));
  process.env['PRINTOPS_DB_PATH'] = join(tempDir, 'printops.db');
  process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
  await initDatabase();
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SQLite write durability', () => {
  it('persists a paper profile before the process performs its shutdown save', async () => {
    const profiles = new SqlitePaperProfileRepository();
    const created = await profiles.create({
      code: 'DURABLE_LABEL',
      name: 'Durable label',
      widthMm: 70,
      heightMm: 30,
      gapMm: 2,
      marginTopMm: 2,
      marginRightMm: 2,
      marginBottomMm: 2,
      marginLeftMm: 2,
      dpi: 203,
      orientation: 'portrait',
      unit: 'mm',
    });

    // Simulate the desktop host terminating the API sidecar without allowing
    // its normal shutdown hook to run.
    closeDatabase({ save: false });
    await initDatabase();

    await expect(new SqlitePaperProfileRepository().findById(created.id))
      .resolves.toMatchObject({
        code: 'DURABLE_LABEL',
        widthMm: 70,
        heightMm: 30,
        gapMm: 2,
      });
  });
});
