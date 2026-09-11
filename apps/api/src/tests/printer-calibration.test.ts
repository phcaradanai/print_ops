import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { closeDatabase, initDatabase } from '../infra/db/sqlite.js';
import { InMemoryPrinterPaperCalibrationRepository } from '../infra/repos/in-memory-printer-paper-calibration.repo.js';
import { SqlitePrinterPaperCalibrationRepository } from '../infra/repos/sqlite/sqlite-printer-paper-calibration.repo.js';
import { SqlitePaperProfileRepository } from '../infra/repos/sqlite/sqlite-paper-profile.repo.js';
import { SqlitePrinterRepository } from '../infra/repos/sqlite/sqlite-printer.repo.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

async function login(app: Awaited<ReturnType<typeof buildApp>>['app'], email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'Dev-password1!' },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const calibrationInput = {
  printerId: 'printer-1',
  paperProfileId: 'paper-1',
  dpi: 203,
  xOffsetDots: -7,
  yOffsetDots: 11,
};

describe('printer-paper calibration API and operator test print', () => {
  it('supports signed CRUD by the printer/profile/DPI tuple and applies the saved values to a test print', async () => {
    const { app } = await buildApp();
    try {
      const owner = await login(app, 'sysadmin@printerops.local');
      const printers = (await app.inject({
        method: 'GET',
        url: '/printers',
        headers: auth(owner),
      })).json() as Array<{ id: string; code: string; protocol: string }>;
      const papers = (await app.inject({
        method: 'GET',
        url: '/api/v1/paper-profiles',
        headers: auth(owner),
      })).json() as Array<{ id: string; code: string; dpi: number }>;
      const printer = printers.find((item) => item.code === 'OFFICE_LASER_01');
      const paper = papers.find((item) => item.code === 'LABEL_100X50');
      expect(printer).toBeDefined();
      expect(paper).toBeDefined();

      const input = { ...calibrationInput, printerId: printer!.id, paperProfileId: paper!.id };
      const badDpi = await app.inject({
        method: 'POST',
        url: '/api/v1/printer-calibrations',
        headers: auth(owner),
        payload: { ...input, dpi: 300 },
      });
      expect(badDpi.statusCode).toBe(400);
      expect((badDpi.json() as { error: string }).error).toBe('VALIDATION_ERROR');

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/printer-calibrations',
        headers: auth(owner),
        payload: input,
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject(input);
      const calibrationId = (created.json() as { id: string }).id;

      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/v1/printer-calibrations',
        headers: auth(owner),
        payload: input,
      });
      expect(duplicate.statusCode).toBe(409);
      expect((duplicate.json() as { error: string }).error).toBe('CALIBRATION_EXISTS');

      const keyMutation = await app.inject({
        method: 'PUT',
        url: `/api/v1/printer-calibrations/${calibrationId}`,
        headers: auth(owner),
        payload: { dpi: 300, xOffsetDots: -8, yOffsetDots: 12 },
      });
      expect(keyMutation.statusCode).toBe(400);

      const updated = await app.inject({
        method: 'PUT',
        url: `/api/v1/printer-calibrations/${calibrationId}`,
        headers: auth(owner),
        payload: { xOffsetDots: -9, yOffsetDots: 13 },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ ...input, xOffsetDots: -9, yOffsetDots: 13 });

      const listed = await app.inject({
        method: 'GET',
        url: `/api/v1/printer-calibrations?printerId=${printer!.id}&paperProfileId=${paper!.id}&dpi=203`,
        headers: auth(owner),
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual([
        expect.objectContaining({ ...input, xOffsetDots: -9, yOffsetDots: 13 }),
      ]);

      const testPrint = await app.inject({
        method: 'POST',
        url: '/api/v1/printer-calibrations/test-print',
        headers: auth(owner),
        // The service must ignore offsets supplied by a caller and resolve the
        // persisted tuple at job creation time.
        payload: { ...input, xOffsetDots: 9999, yOffsetDots: -9999 },
      });
      expect(testPrint.statusCode).toBe(201);
      const testPrintBody = testPrint.json() as { jobId: string; status: string };
      expect(testPrintBody.status).toBe('SUCCESS');

      const jobResponse = await app.inject({
        method: 'GET',
        url: `/jobs/${testPrintBody.jobId}`,
        headers: auth(owner),
      });
      expect(jobResponse.statusCode).toBe(200);
      const job = jobResponse.json() as { metadata?: { printerCalibration?: Record<string, unknown> } };
      expect(job.metadata?.printerCalibration).toMatchObject({
        printerId: printer!.id,
        paperProfileId: paper!.id,
        dpi: 203,
        xOffsetDots: -9,
        yOffsetDots: 13,
      });
    } finally {
      await app.close();
    }
  });
});

describe('printer-paper calibration storage', () => {
  it('keeps signed offsets and enforces tuple uniqueness in memory', async () => {
    const repository = new InMemoryPrinterPaperCalibrationRepository();
    const created = await repository.create(calibrationInput);

    expect(created).toMatchObject(calibrationInput);
    await expect(repository.create(calibrationInput)).rejects.toThrow(/already exists/);
    await expect(repository.update(created.id, { xOffsetDots: -10001, yOffsetDots: 0 }))
      .rejects.toThrow(/whole numbers/);
    await expect(repository.findByKey('printer-1', 'paper-1', 203)).resolves.toMatchObject(calibrationInput);
  });

  it('round-trips signed offsets through SQLite across a database restart', async () => {
    const originalDbPath = process.env['PRINTOPS_DB_PATH'];
    const originalWasmPath = process.env['SQL_WASM_PATH'];
    const tempDirectory = mkdtempSync(join(tmpdir(), 'printops-calibration-'));
    process.env['PRINTOPS_DB_PATH'] = join(tempDirectory, 'printops.db');
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;

    try {
      await initDatabase();
      const printers = new SqlitePrinterRepository();
      const papers = new SqlitePaperProfileRepository();
      const printer = await printers.create({
        code: 'CALIBRATION_PRINTER',
        name: 'Calibration printer',
        protocol: 'fake',
        connectionUri: 'fake://calibration-printer',
        metadata: {},
        isActive: true,
      });
      const paper = await papers.create({
        code: 'CALIBRATION_PAPER',
        name: 'Calibration paper',
        widthMm: 100,
        heightMm: 50,
        marginTopMm: 2,
        marginRightMm: 2,
        marginBottomMm: 2,
        marginLeftMm: 2,
        dpi: 203,
        orientation: 'portrait',
        unit: 'mm',
      });
      const repository = new SqlitePrinterPaperCalibrationRepository();
      const created = await repository.create({
        printerId: printer.id,
        paperProfileId: paper.id,
        dpi: paper.dpi,
        xOffsetDots: -17,
        yOffsetDots: 23,
      });
      expect(await repository.findByKey(printer.id, paper.id, paper.dpi)).toMatchObject({
        id: created.id,
        xOffsetDots: -17,
        yOffsetDots: 23,
      });

      closeDatabase();
      await initDatabase();
      await expect(new SqlitePrinterPaperCalibrationRepository().findById(created.id))
        .resolves.toMatchObject({
          printerId: printer.id,
          paperProfileId: paper.id,
          dpi: 203,
          xOffsetDots: -17,
          yOffsetDots: 23,
        });
    } finally {
      closeDatabase();
      if (originalDbPath === undefined) delete process.env['PRINTOPS_DB_PATH'];
      else process.env['PRINTOPS_DB_PATH'] = originalDbPath;
      if (originalWasmPath === undefined) delete process.env['SQL_WASM_PATH'];
      else process.env['SQL_WASM_PATH'] = originalWasmPath;
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
