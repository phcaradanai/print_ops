import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { CallbackDeliveryRepositoryPort, CreateCallbackDeliveryInput } from '@printerops/domain';
import { InMemoryCallbackDeliveryRepository } from '../infra/repos/in-memory-callback-delivery.repo.js';
import { SqliteCallbackDeliveryRepository } from '../infra/repos/sqlite/sqlite-callback-delivery.repo.js';
import { closeDatabase, initDatabase } from '../infra/db/sqlite.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

function input(over: Partial<CreateCallbackDeliveryInput> = {}): CreateCallbackDeliveryInput {
  return {
    eventId: 'evt-1',
    printJobId: 'job-1',
    requestId: 'REQ-1',
    sourceSystem: 'medisync',
    transport: 'HTTP',
    target: 'https://receiver.example/results',
    trigger: 'PRINT_RESULT',
    deliveryStatus: 'PENDING',
    maxAttempts: 5,
    printStatus: 'SUCCESS',
    payload: { event_id: 'evt-1', print_status: 'SUCCESS' },
    endpointId: 'ep-1',
    endpointCode: 'medisync-results',
    ...over,
  };
}

/**
 * The same contract has to hold in BOTH official runtime modes. Implementing
 * only the in-memory path is how "restart with a pending delivery" quietly
 * becomes untestable — and then untrue.
 */
function contractSuite(name: string, make: () => CallbackDeliveryRepositoryPort): void {
  describe(`CallbackDeliveryRepository (${name})`, () => {
    it('is idempotent on (printJobId, transport, target)', async () => {
      const repo = make();
      const first = await repo.createIfAbsent(input());
      const second = await repo.createIfAbsent(input({ eventId: 'a-different-event-id' }));
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.delivery.id).toBe(first.delivery.id);
      // The stored row must come back UNTOUCHED — re-arming a delivery that
      // already ran is exactly the duplicate-callback bug this key prevents.
      expect(second.delivery.eventId).toBe('evt-1');
      expect(await repo.findAll({ printJobId: 'job-1' })).toHaveLength(1);
    });

    it('allows the same job to have one delivery per transport', async () => {
      const repo = make();
      await repo.createIfAbsent(input());
      await repo.createIfAbsent(input({ transport: 'NATS', target: 'results.medisync' }));
      expect(await repo.findAll({ printJobId: 'job-1' })).toHaveLength(2);
    });

    it('filters by every documented field', async () => {
      const repo = make();
      await repo.createIfAbsent(input());
      await repo.createIfAbsent(
        input({ printJobId: 'job-2', requestId: 'REQ-2', eventId: 'evt-2', transport: 'NATS', target: 'results.x', deliveryStatus: 'FAILED' }),
      );
      expect(await repo.findAll({ printJobId: 'job-2' })).toHaveLength(1);
      expect(await repo.findAll({ requestId: 'REQ-1' })).toHaveLength(1);
      expect(await repo.findAll({ eventId: 'evt-2' })).toHaveLength(1);
      expect(await repo.findAll({ deliveryStatus: 'FAILED' })).toHaveLength(1);
      expect(await repo.findAll({ transport: 'NATS' })).toHaveLength(1);
      expect(await repo.findAll({ endpointId: 'ep-1' })).toHaveLength(2);
    });

    it('returns only deliveries whose retry has come due', async () => {
      const repo = make();
      const soon = new Date('2026-07-27T06:00:05.000Z');
      const later = new Date('2026-07-27T06:10:00.000Z');
      const a = await repo.createIfAbsent(input());
      const b = await repo.createIfAbsent(input({ printJobId: 'job-2', target: 'https://r/2' }));
      await repo.update(a.delivery.id, { deliveryStatus: 'RETRY_SCHEDULED', nextAttemptAt: soon });
      await repo.update(b.delivery.id, { deliveryStatus: 'RETRY_SCHEDULED', nextAttemptAt: later });

      const due = await repo.findDue(new Date('2026-07-27T06:00:06.000Z'));
      expect(due.map((d) => d.printJobId)).toEqual(['job-1']);
    });

    it('never returns a terminal delivery as due', async () => {
      const repo = make();
      const created = await repo.createIfAbsent(input());
      await repo.update(created.delivery.id, {
        deliveryStatus: 'DELIVERED',
        nextAttemptAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      expect(await repo.findDue(new Date())).toHaveLength(0);
    });

    it('claims conditionally so two workers cannot both send one attempt', async () => {
      const repo = make();
      const created = await repo.createIfAbsent(input());
      const won = await repo.claim(created.delivery.id, ['PENDING'], { deliveryStatus: 'DELIVERING' });
      const lost = await repo.claim(created.delivery.id, ['PENDING'], { deliveryStatus: 'DELIVERING' });
      expect(won).toBeDefined();
      expect(lost).toBeUndefined();
    });

    it('round-trips the payload and every outcome field', async () => {
      const repo = make();
      const created = await repo.createIfAbsent(input());
      const at = new Date('2026-07-27T06:01:00.000Z');
      await repo.update(created.delivery.id, {
        deliveryStatus: 'FAILED',
        guarantee: 'ACKNOWLEDGED',
        attemptCount: 5,
        lastAttemptAt: at,
        lastHttpStatus: 503,
        lastErrorCode: 'HTTP_503',
        lastErrorMessage: 'receiver unavailable',
      });
      const found = await repo.findById(created.delivery.id);
      expect(found?.deliveryStatus).toBe('FAILED');
      expect(found?.attemptCount).toBe(5);
      expect(found?.lastHttpStatus).toBe(503);
      expect(found?.lastErrorCode).toBe('HTTP_503');
      expect(found?.lastAttemptAt?.toISOString()).toBe(at.toISOString());
      expect(found?.payload).toEqual({ event_id: 'evt-1', print_status: 'SUCCESS' });
    });
  });
}

contractSuite('memory', () => new InMemoryCallbackDeliveryRepository());

describe('SQLite-backed deliveries', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'printops-callback-delivery-'));
    process.env['PRINTOPS_DB_PATH'] = join(tempDir, 'printops.db');
    process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
    await initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  contractSuite('sqlite', () => new SqliteCallbackDeliveryRepository());

  it('survives a process restart with a pending delivery', async () => {
    const repo = new SqliteCallbackDeliveryRepository();
    const created = await repo.createIfAbsent(input());
    await repo.update(created.delivery.id, {
      deliveryStatus: 'RETRY_SCHEDULED',
      nextAttemptAt: new Date('2026-07-27T06:00:05.000Z'),
      attemptCount: 1,
    });

    // Close and reopen the database — this is the restart the in-memory ring
    // buffer could never model.
    closeDatabase();
    await initDatabase();

    const reopened = new SqliteCallbackDeliveryRepository();
    const due = await reopened.findDue(new Date('2026-07-27T06:00:06.000Z'));
    expect(due).toHaveLength(1);
    expect(due[0]?.attemptCount).toBe(1);
    expect(due[0]?.payload).toEqual({ event_id: 'evt-1', print_status: 'SUCCESS' });
  });
});
