import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { buildApp } from '../app.js';
import { closeDatabase } from '../infra/db/sqlite.js';
import { SqliteAuditRepository } from '../infra/repos/sqlite/sqlite-audit.repo.js';
import { CALLBACK_INTENT_METADATA_KEY } from '@printerops/domain';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

let tempDir: string;
let activeApp: BuiltApp | undefined;
let originalDbMode: string | undefined;
let originalDbPath: string | undefined;
let originalWasmPath: string | undefined;
let originalLocalWorker: string | undefined;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function closeActiveApp(): Promise<void> {
  if (activeApp) {
    await activeApp.app.close();
    activeApp = undefined;
  }
  closeDatabase();
}

async function login(app: BuiltApp['app']): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'sysadmin@printerops.local', password: 'Dev-password1!' },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

async function waitForStatus(app: BuiltApp, jobId: string, status: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const job = await app.jobRepo.findById(jobId);
    if (job?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const job = await app.jobRepo.findById(jobId);
  throw new Error(`Job ${jobId} did not reach ${status}; current status is ${job?.status ?? 'missing'}`);
}

beforeEach(() => {
  originalDbMode = process.env['DB_MODE'];
  originalDbPath = process.env['PRINTOPS_DB_PATH'];
  originalWasmPath = process.env['SQL_WASM_PATH'];
  originalLocalWorker = process.env['PRINTOPS_LOCAL_WORKER'];

  tempDir = mkdtempSync(join(tmpdir(), 'printops-local-worker-restart-'));
  process.env['DB_MODE'] = 'sqlite';
  process.env['PRINTOPS_DB_PATH'] = join(tempDir, 'printops.db');
  process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
  delete process.env['PRINTOPS_LOCAL_WORKER'];
});

afterEach(async () => {
  await closeActiveApp();
  restoreEnv('DB_MODE', originalDbMode);
  restoreEnv('PRINTOPS_DB_PATH', originalDbPath);
  restoreEnv('SQL_WASM_PATH', originalWasmPath);
  restoreEnv('PRINTOPS_LOCAL_WORKER', originalLocalWorker);
  rmSync(tempDir, { recursive: true, force: true });
});

describe('desktop local-worker restart recovery', () => {
  it('recovers safe pre-dispatch jobs and never executes an ambiguous or terminal job twice', async () => {
    activeApp = await buildApp();
    const token = await login(activeApp.app);
    const fakePrinter = (await activeApp.printerRepo.findAll())
      .find((printer) => printer.protocol === 'fake');
    expect(fakePrinter).toBeDefined();

    const createQueuedJob = async (label: string): Promise<string> => {
      const response = await activeApp!.app.inject({
        method: 'POST',
        url: '/jobs',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          printerId: fakePrinter!.id,
          createdBy: 'restart-test',
          renderedPrintPayload: label,
          mimeType: 'text/plain',
          copies: 1,
          duplex: false,
          colorMode: 'monochrome',
          metadata: {},
        },
      });
      expect(response.statusCode).toBe(201);
      return (response.json() as { id: string }).id;
    };

    const queuedJobId = await createQueuedJob('queued');
    const acceptedJobId = await createQueuedJob('accepted');
    const validatedJobId = await createQueuedJob('validated');
    const dispatchedJobId = await createQueuedJob('dispatched');
    const printingJobId = await createQueuedJob('printing');
    const unverifiedJobId = await createQueuedJob('unverified');
    await activeApp.jobRepo.update(acceptedJobId, { status: 'ACCEPTED' });
    await activeApp.jobRepo.update(validatedJobId, { status: 'VALIDATED' });
    await activeApp.jobRepo.update(dispatchedJobId, {
      status: 'DISPATCHED',
      runnerId: 'desktop-before-restart',
      metadata: {
        [CALLBACK_INTENT_METADATA_KEY]: {
          enabled: true,
          trigger: 'PRINT_RESULT',
          transports: ['NATS'],
          natsSubject: 'results.recovered-unverified',
        },
      },
    });
    await activeApp.jobRepo.update(printingJobId, { status: 'PRINTING' });
    await activeApp.jobRepo.update(unverifiedJobId, { status: 'UNVERIFIED' });

    // Simulate closing the desktop process: its volatile queue disappears but
    // the SQLite rows remain.
    await closeActiveApp();

    process.env['PRINTOPS_LOCAL_WORKER'] = 'true';
    activeApp = await buildApp();

    // QUEUED plus both pre-dispatch states are safe to restore. In-flight or
    // ambiguous jobs must not enter the rebuilt queue.
    expect(await activeApp.queue.size()).toBe(3);
    await waitForStatus(activeApp, queuedJobId, 'SUCCESS');
    await waitForStatus(activeApp, acceptedJobId, 'SUCCESS');
    await waitForStatus(activeApp, validatedJobId, 'SUCCESS');

    await expect(activeApp.jobRepo.findById(dispatchedJobId))
      .resolves.toMatchObject({
        status: 'UNVERIFIED',
        errorCode: 'RECOVERY_PRINT_STATUS_UNKNOWN',
      });
    await expect(activeApp.jobRepo.findById(printingJobId))
      .resolves.toMatchObject({
        status: 'UNVERIFIED',
        errorCode: 'RECOVERY_PRINT_STATUS_UNKNOWN',
      });
    await expect(activeApp.jobRepo.findById(unverifiedJobId))
      .resolves.toMatchObject({ status: 'UNVERIFIED' });

    await activeApp.eventBus.settled();
    const recoveredCallbacks = await activeApp.callbackDeliveryRepo.findAll({ printJobId: dispatchedJobId });
    expect(recoveredCallbacks).toHaveLength(1);
    expect(recoveredCallbacks[0]).toMatchObject({
      printStatus: 'UNVERIFIED',
      transport: 'NATS',
      target: 'results.recovered-unverified',
      // No NATS connection is configured in this test, so the durable result
      // remains retryable rather than being silently lost.
      deliveryStatus: 'RETRY_SCHEDULED',
    });

    const firstSuccess = await activeApp.jobRepo.findById(queuedJobId);
    const firstAckAt = firstSuccess?.printerAckAt?.getTime();
    expect(firstAckAt).toBeDefined();
    expect((await new SqliteAuditRepository().findAll({
      resourceType: 'job', resourceId: queuedJobId,
    })).filter((entry) => entry.action === 'job.succeeded')).toHaveLength(1);

    // Restart once more. SUCCESS is terminal, so it is not rehydrated and the
    // worker cannot submit a second physical copy.
    await closeActiveApp();
    activeApp = await buildApp();
    expect(await activeApp.queue.size()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 650));

    const afterSecondRestart = await activeApp.jobRepo.findById(queuedJobId);
    expect(afterSecondRestart).toMatchObject({ status: 'SUCCESS' });
    expect(afterSecondRestart?.printerAckAt?.getTime()).toBe(firstAckAt);
    expect((await new SqliteAuditRepository().findAll({
      resourceType: 'job', resourceId: queuedJobId,
    })).filter((entry) => entry.action === 'job.succeeded')).toHaveLength(1);
  });
});
