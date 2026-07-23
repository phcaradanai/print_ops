import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { SqliteWebhookEndpointRepository } from '../infra/repos/sqlite/sqlite-webhook-endpoint.repo.js';
import { initDatabase, closeDatabase } from '../infra/db/sqlite.js';
import { runSchemaMigration } from '../infra/db/sqlite.schema.js';
import type { CreateWebhookEndpointInput } from '@printerops/domain';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

describe('SqliteWebhookEndpointRepository (callback fields)', () => {
  let originalWasmPath: string | undefined;
  let originalDbPath: string | undefined;
  let tmpDir: string;
  let repo: SqliteWebhookEndpointRepository;

  beforeEach(async () => {
    originalWasmPath = process.env['SQL_WASM_PATH'];
    originalDbPath = process.env['PRINTOPS_DB_PATH'];
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
    tmpDir = mkdtempSync(join(tmpdir(), 'printops-webhook-cb-'));
    process.env['PRINTOPS_DB_PATH'] = join(tmpDir, 'printops.db');
    await initDatabase();
    runSchemaMigration((await import('../infra/db/sqlite.js')).getDb());
    repo = new SqliteWebhookEndpointRepository();
  });

  afterEach(async () => {
    await closeDatabase({ save: false });
    if (originalWasmPath === undefined) delete process.env['SQL_WASM_PATH'];
    else process.env['SQL_WASM_PATH'] = originalWasmPath;
    if (originalDbPath === undefined) delete process.env['PRINTOPS_DB_PATH'];
    else process.env['PRINTOPS_DB_PATH'] = originalDbPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists and round-trips all callback fields', async () => {
    const input: CreateWebhookEndpointInput = {
      endpointCode: 'cb-ep',
      name: 'Callback Endpoint',
      sourceSystem: 'sys',
      authMode: 'NONE',
      enabled: true,
      routePolicyId: 'rp-1',
      callbackTransport: 'BOTH',
      callbackUrl: '$.reply_url',
      callbackNatsSubject: 'medisync.reply',
      callbackPayloadTemplate: { event: 'print_accepted', hn: '$.hn' },
      callbackOnPrintResult: true,
    };
    const created = await repo.create(input);
    expect(created.callbackTransport).toBe('BOTH');
    expect(created.callbackUrl).toBe('$.reply_url');
    expect(created.callbackNatsSubject).toBe('medisync.reply');
    expect(created.callbackPayloadTemplate).toEqual({ event: 'print_accepted', hn: '$.hn' });
    expect(created.callbackOnPrintResult).toBe(true);

    const fetched = await repo.findByCode('cb-ep');
    expect(fetched?.callbackTransport).toBe('BOTH');
    expect(fetched?.callbackPayloadTemplate).toEqual({ event: 'print_accepted', hn: '$.hn' });
    expect(fetched?.callbackOnPrintResult).toBe(true);
  });

  it('defaults callback fields when omitted', async () => {
    const created = await repo.create({
      endpointCode: 'cb-def', name: 'Def', sourceSystem: 'sys',
      authMode: 'NONE', enabled: true, routePolicyId: 'rp-1',
    });
    expect(created.callbackTransport).toBe('NONE');
    expect(created.callbackUrl).toBeUndefined();
    expect(created.callbackNatsSubject).toBeUndefined();
    expect(created.callbackPayloadTemplate).toBeUndefined();
    expect(created.callbackOnPrintResult).toBe(false);
  });

  it('updates callback fields via patch', async () => {
    const created = await repo.create({
      endpointCode: 'cb-upd', name: 'Upd', sourceSystem: 'sys',
      authMode: 'NONE', enabled: true, routePolicyId: 'rp-1',
    });
    const updated = await repo.update(created.id, {
      callbackTransport: 'HTTP',
      callbackUrl: 'https://h/cb',
      callbackPayloadTemplate: { a: 'b' },
      callbackOnPrintResult: true,
    });
    expect(updated.callbackTransport).toBe('HTTP');
    expect(updated.callbackUrl).toBe('https://h/cb');
    expect(updated.callbackPayloadTemplate).toEqual({ a: 'b' });
    expect(updated.callbackOnPrintResult).toBe(true);
  });
});
