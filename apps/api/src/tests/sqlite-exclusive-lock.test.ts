import { createServer, type Server } from 'node:net';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  databaseLockEndpoint,
  getDb,
  initDatabase,
} from '../infra/db/sqlite.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function listenAfterRelease(endpoint: string, timeoutMs = 1_000): Promise<Server> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const candidate = createServer();
    try {
      await listen(candidate, endpoint);
      return candidate;
    } catch (error) {
      lastError = error;
      candidate.close();
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Database lock endpoint was not released within ${timeoutMs}ms`);
}

describe.sequential('sql.js exclusive database ownership', () => {
  let tempDir: string;
  let blocker: Server | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'printops-sqlite-lock-'));
    process.env['PRINTOPS_DB_PATH'] = join(tempDir, 'printops.db');
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
  });

  afterEach(async () => {
    closeDatabase({ save: false });
    if (blocker) {
      await close(blocker);
      blocker = undefined;
    }
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env['PRINTOPS_DB_PATH'];
    delete process.env['SQL_WASM_PATH'];
  });

  it('refuses to initialise while another process endpoint owns the same DB', async () => {
    blocker = createServer();
    await listen(blocker, databaseLockEndpoint());

    await expect(initDatabase()).rejects.toThrow(/PRINTOPS_DB_LOCKED/);

    await close(blocker);
    blocker = undefined;
    await expect(initDatabase()).resolves.toBeUndefined();
  });

  it('coalesces concurrent initialisation and releases ownership on close', async () => {
    await expect(Promise.all([initDatabase(), initDatabase(), initDatabase()])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    closeDatabase();
    await expect(initDatabase()).resolves.toBeUndefined();
  });

  it('cannot resurrect an unlocked DB when close races pending initialisation', async () => {
    // acquireDatabaseLock() always crosses an await boundary, so this close is
    // deterministic: the first generation is pending but has not opened SQL.
    const cancelledInit = initDatabase();
    closeDatabase({ save: false });

    // A caller starting after close must wait for the cancelled generation to
    // acquire-and-release its late lock, then own a fresh lifecycle safely.
    const replacementInit = initDatabase();
    const concurrentReplacementInit = initDatabase();
    await expect(cancelledInit).rejects.toThrow(/PRINTOPS_DB_INIT_CANCELLED/);
    await expect(Promise.all([replacementInit, concurrentReplacementInit])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(() => getDb()).not.toThrow();

    closeDatabase();

    // closeDatabase() starts an asynchronous OS-socket close. Prove the
    // endpoint becomes reusable promptly without assuming the kernel releases
    // it within exactly one event-loop turn.
    blocker = await listenAfterRelease(databaseLockEndpoint());
    expect(blocker.listening).toBe(true);
  });
});
