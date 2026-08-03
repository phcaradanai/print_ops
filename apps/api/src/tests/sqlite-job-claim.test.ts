import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { Job, JobStatus } from '@printerops/domain';
import { SqliteJobRepository } from '../infra/repos/sqlite/sqlite-job.repo.js';
import { initDatabase, closeDatabase } from '../infra/db/sqlite.js';

// npm workspaces hoist sql.js to the repo-root node_modules, not apps/api's
// own — a path built from process.cwd() misses it. require.resolve follows
// Node's real module resolution (and therefore the hoist) instead of guessing.
const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

/**
 * SqliteJobRepository.claim is the production concurrency guard (DB_MODE=sqlite),
 * but it had zero test coverage — the only claim test used the in-memory repo.
 * These tests pin the conditional-write semantics directly against sql.js so a
 * future buildJobPatch change can't silently reduce claim to an unconditional
 * write: insert QUEUED, claim twice, assert the second is rejected and the row
 * is not touched a second time.
 */

let repo: SqliteJobRepository;
let tmpDir: string;

/** Insert a job at ACCEPTED (what create() always produces), then move it to
 * the requested status via update. Claims are what move jobs out of QUEUED, so
 * tests that need a claimable job seed QUEUED here. Both calls are async —
 * forgetting to await leaves the row inserted but returns an unresolved job. */
async function seedJob(status: JobStatus = 'ACCEPTED'): Promise<Job> {
  const r = new SqliteJobRepository();
  const created = await r.create({
    id: `job-${Math.random().toString(36).slice(2, 10)}`,
    printerId: 'printer-1',
    createdBy: 'user-1',
    mimeType: 'application/pdf',
    copies: 1,
    duplex: false,
    colorMode: 'monochrome',
    metadata: {},
    traceId: 'trace-1',
    correlationId: 'corr-1',
  });
  if (status !== 'ACCEPTED') {
    await r.update(created.id, { status });
  }
  return created;
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'printops-sqlite-test-'));
  process.env['PRINTOPS_DB_PATH'] = join(tmpDir, 'test.db');
  // Point sql.js at the real WASM asset. locateFile() in sqlite.ts honours
  // SQL_WASM_PATH when it exists, else falls back to a path relative to the
  // executable — which under vitest resolves to the vitest binary and misses.
  process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
  await initDatabase();
  repo = new SqliteJobRepository();
});

afterEach(async () => {
  closeDatabase();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SqliteJobRepository.claim', () => {
  it('claims a QUEUED job and flips its status', async () => {
    const job = await seedJob('QUEUED');

    const claimed = await repo.claim(job.id, ['QUEUED'], {
      status: 'DISPATCHED',
      runnerId: 'runner-1',
    });

    expect(claimed).toBeDefined();
    expect(claimed!.status).toBe('DISPATCHED');
    expect(claimed!.runnerId).toBe('runner-1');

    const reloaded = await repo.findById(job.id);
    expect(reloaded!.status).toBe('DISPATCHED');
  });

  it('rejects a second claim once the status has moved', async () => {
    const job = await seedJob('QUEUED');

    const first = await repo.claim(job.id, ['QUEUED'], { status: 'DISPATCHED' });
    expect(first).toBeDefined();

    // The row is no longer QUEUED, so claiming from QUEUED again must fail.
    const second = await repo.claim(job.id, ['QUEUED'], { status: 'DISPATCHED' });
    expect(second).toBeUndefined();

    // And the row must not have been touched a second time.
    const reloaded = await repo.findById(job.id);
    expect(reloaded!.status).toBe('DISPATCHED');
    expect(reloaded!.runnerId).toBeUndefined(); // second claim did not set it
  });

  it('returns undefined when the status is not in fromStatuses', async () => {
    const job = await seedJob('QUEUED');

    // Claiming from statuses that do not include QUEUED must not match.
    const claimed = await repo.claim(job.id, ['ACCEPTED', 'VALIDATED'], {
      status: 'DISPATCHED',
    });
    expect(claimed).toBeUndefined();

    const reloaded = await repo.findById(job.id);
    expect(reloaded!.status).toBe('QUEUED');
  });

  it('treats an empty caller patch as a no-op, not a successful claim', async () => {
    const job = await seedJob('QUEUED');

    // An empty patch must NOT claim: buildJobPatch always appends updated_at,
    // so guarding on fields.length would issue UPDATE ... SET updated_at=?
    // WHERE ... status IN ('QUEUED'), match the row, report rowsModified===1,
    // and hand back a "claimed" job that changed no status.
    const claimed = await repo.claim(job.id, ['QUEUED'], {});
    expect(claimed).toBeUndefined();

    const reloaded = await repo.findById(job.id);
    expect(reloaded!.status).toBe('QUEUED');
  });
});

describe('SqliteJobRepository.update', () => {
  it('applies a real patch', async () => {
    const job = await seedJob();
    const updated = await repo.update(job.id, { status: 'PRINTING', runnerId: 'r2' });
    expect(updated.status).toBe('PRINTING');
    expect(updated.runnerId).toBe('r2');
  });

  it('is a no-op for an empty patch (does not bump updated_at)', async () => {
    const job = await seedJob();
    const before = await repo.findById(job.id);
    const beforeUpdatedAt = before!.updatedAt.getTime();

    // Allow wall-clock to advance so a bumped updated_at would be detectable.
    await new Promise((r) => setTimeout(r, 5));

    const updated = await repo.update(job.id, {});
    expect(updated.updatedAt.getTime()).toBe(beforeUpdatedAt);
  });
});
