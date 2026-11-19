import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import type { DiscoveredPrinterRepositoryPort, DiscoveryItem, RunnerRepositoryPort } from '@printerops/domain';
import { closeDatabase, getDb, initDatabase } from '../infra/db/sqlite.js';
import { pruneOldRecords } from '../infra/db/retention.js';
import { InMemoryDiscoveredPrinterRepository } from '../infra/repos/in-memory-discovered-printer.repo.js';
import { SqliteDiscoveredPrinterRepository } from '../infra/repos/sqlite/sqlite-discovered-printer.repo.js';
import { InMemoryRunnerRepository } from '../infra/repos/in-memory-runner.repo.js';
import { SqliteRunnerRepository } from '../infra/repos/sqlite/sqlite-runner.repo.js';
import { ReconcileDiscoveredPrintersService } from '../services/reconcile-discovered-printers.service.js';
import { SyncPrinterDiscoveryService } from '../services/sync-printer-discovery.service.js';
import { buildApp } from '../app.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

/** The same physical printer, reported with a hostname — the identity the display dedupe uses. */
const HP_ITEM: DiscoveryItem = {
  localPrinterName: 'HP LaserJet Pro',
  driverName: 'HP Universal PCL6',
  portName: 'USB001',
  connectionType: 'usb',
  isDefault: true,
  isShared: false,
  computerName: 'nurse-pc',
};

const RUNNER_A = { name: 'cleanup-runner-a', hostname: 'cleanup-host-a', supportedProtocols: ['fake'], metadata: {} };
const RUNNER_B = { name: 'cleanup-runner-b', hostname: 'cleanup-host-b', supportedProtocols: ['fake'], metadata: {} };

function useTempSqlite(): string {
  const dir = mkdtempSync(join(tmpdir(), 'printops-discovery-cleanup-'));
  process.env['PRINTOPS_DB_PATH'] = join(dir, 'test.db');
  process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
  return dir;
}

function releaseTempSqlite(dir: string | undefined): void {
  closeDatabase({ save: false });
  delete process.env['PRINTOPS_DB_PATH'];
  delete process.env['SQL_WASM_PATH'];
  if (dir) rmSync(dir, { recursive: true, force: true });
}

for (const storage of ['memory', 'sqlite'] as const) {
  describe.sequential(`discovered printer cleanup (${storage})`, () => {
    let discovered: DiscoveredPrinterRepositoryPort;
    let runners: RunnerRepositoryPort;
    let dir: string | undefined;

    beforeEach(async () => {
      dir = undefined;
      if (storage === 'sqlite') {
        dir = useTempSqlite();
        await initDatabase();
        discovered = new SqliteDiscoveredPrinterRepository();
        runners = new SqliteRunnerRepository();
        return;
      }
      discovered = new InMemoryDiscoveredPrinterRepository();
      runners = new InMemoryRunnerRepository();
    });

    afterEach(() => {
      if (storage === 'sqlite') releaseTempSqlite(dir);
    });

    it('deleteByRunner removes exactly that runner\'s rows and reports the count', async () => {
      await discovered.upsert({ runnerId: 'r-a', localPrinterName: 'HP LaserJet Pro', connectionType: 'usb', isDefault: true, isShared: false });
      await discovered.upsert({ runnerId: 'r-a', localPrinterName: 'Zebra ZD420', connectionType: 'tcp_ip', isDefault: false, isShared: false });
      await discovered.upsert({ runnerId: 'r-b', localPrinterName: 'HP LaserJet Pro', connectionType: 'usb', isDefault: false, isShared: false });

      expect(await discovered.deleteByRunner('r-a')).toBe(2);
      expect(await discovered.findAll({ runnerId: 'r-a' })).toHaveLength(0);
      expect(await discovered.findAll({ runnerId: 'r-b' })).toHaveLength(1);
      // Idempotent: a second delete removes nothing and must not throw.
      expect(await discovered.deleteByRunner('r-a')).toBe(0);
    });

    it('deleteById removes one row and reports whether it existed', async () => {
      const created = await discovered.upsert({
        runnerId: 'r-a',
        localPrinterName: 'HP LaserJet Pro',
        connectionType: 'usb',
        isDefault: false,
        isShared: false,
      });

      expect(await discovered.deleteById(created.id)).toBe(true);
      expect(await discovered.findById(created.id)).toBeUndefined();
      expect(await discovered.deleteById(created.id)).toBe(false);
    });

    it('reconciles rows orphaned before this build, keeping live runners\' rows', async () => {
      await runners.create({ id: 'live-runner', name: 'live', hostname: 'host-live', supportedProtocols: [], metadata: {} });
      await discovered.upsert({ runnerId: 'live-runner', localPrinterName: 'HP LaserJet Pro', connectionType: 'usb', isDefault: false, isShared: false, computerName: 'host-live' });
      await discovered.upsert({ runnerId: 'deleted-runner', localPrinterName: 'Zebra ZD420', connectionType: 'tcp_ip', isDefault: false, isShared: false, computerName: 'host-gone' });
      await discovered.upsert({ runnerId: 'deleted-runner', localPrinterName: 'HP LaserJet Pro', connectionType: 'usb', isDefault: false, isShared: false, computerName: 'host-gone' });

      const result = await new ReconcileDiscoveredPrintersService(discovered, runners).execute();

      expect(result).toMatchObject({ scanned: 3, deleted: 2, orphanRunnerIds: ['deleted-runner'] });
      const remaining = await discovered.findAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.runnerId).toBe('live-runner');
    });

    it('collapses the row left by a re-registered runner onto the live runner', async () => {
      await runners.create({ id: 'old-runner', name: 'nurse', hostname: 'nurse-pc', supportedProtocols: [], metadata: {} });
      await runners.create({ id: 'new-runner', name: 'nurse', hostname: 'nurse-pc', supportedProtocols: [], metadata: {} });
      const sync = new SyncPrinterDiscoveryService(discovered, runners);

      await sync.execute('old-runner', [HP_ITEM]);
      // The operator deleted the old registration; the same host registers again with a new id.
      await runners.delete('old-runner');
      await sync.execute('new-runner', [HP_ITEM]);

      const rows = await discovered.findAll();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.runnerId).toBe('new-runner');
    });

    it('never merges the rows of two live runners that report the same printer', async () => {
      await runners.create({ id: 'r-live-1', name: 'one', hostname: 'nurse-pc', supportedProtocols: [], metadata: {} });
      await runners.create({ id: 'r-live-2', name: 'two', hostname: 'nurse-pc', supportedProtocols: [], metadata: {} });
      const sync = new SyncPrinterDiscoveryService(discovered, runners);

      await sync.execute('r-live-1', [HP_ITEM]);
      await sync.execute('r-live-2', [HP_ITEM]);

      expect(await discovered.findAll()).toHaveLength(2);
    });

    it('leaves a dead runner\'s row for a different host to the explicit reconcile pass', async () => {
      await runners.create({ id: 'old-runner', name: 'acct', hostname: 'pc-accounting', supportedProtocols: [], metadata: {} });
      await runners.create({ id: 'new-runner', name: 'nurse', hostname: 'nurse-pc', supportedProtocols: [], metadata: {} });
      const sync = new SyncPrinterDiscoveryService(discovered, runners);

      await sync.execute('old-runner', [{ ...HP_ITEM, computerName: 'pc-accounting' }]);
      await runners.delete('old-runner');
      await sync.execute('new-runner', [HP_ITEM]);

      // Different host identity: the sync must not guess, so both rows remain for now.
      expect(await discovered.findAll()).toHaveLength(2);

      const reconciled = await new ReconcileDiscoveredPrintersService(discovered, runners).execute();
      expect(reconciled.deleted).toBe(1);
      const remaining = await discovered.findAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.runnerId).toBe('new-runner');
    });
  });
}

describe('retention sweep reconciles orphaned discovered printers', () => {
  let dir: string | undefined;

  beforeEach(async () => {
    dir = useTempSqlite();
    await initDatabase();
  });

  afterEach(() => {
    releaseTempSqlite(dir);
    delete process.env['PRINTOPS_RETENTION_DAYS'];
    delete process.env['PRINTOPS_RETENTION_MAX_ROWS'];
  });

  function insertRunner(id: string): void {
    getDb().run(
      `INSERT INTO runners (id, name, hostname, status, supported_protocols, registered_at, metadata)
       VALUES (?, ?, 'host', 'online', '[]', '2026-01-01T00:00:00.000Z', '{}')`,
      [id, id],
    );
  }

  function insertDiscovered(id: string, runnerId: string, name: string, lastSeenAt = '2026-01-01T00:00:00.000Z'): void {
    getDb().run(
      `INSERT INTO discovered_printers
         (id, runner_id, local_printer_name, connection_type, is_default, is_shared, attributes, computer_name, os_name, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, 'usb', 0, 0, '{}', 'host', NULL, ?, ?)`,
      [id, runnerId, name, lastSeenAt, lastSeenAt],
    );
  }

  function remainingDiscoveredIds(): string[] {
    const stmt = getDb().prepare('SELECT id FROM discovered_printers ORDER BY id');
    const ids: string[] = [];
    while (stmt.step()) ids.push(String(stmt.getAsObject()['id']));
    stmt.free();
    return ids;
  }

  it('deletes rows whose runner is gone even when age and count pruning are disabled', () => {
    insertRunner('live-runner');
    insertDiscovered('keep', 'live-runner', 'HP LaserJet Pro');
    insertDiscovered('orphan-a', 'gone-runner', 'Zebra ZD420');
    insertDiscovered('orphan-b', 'gone-runner', 'HP LaserJet Pro');

    const result = pruneOldRecords(getDb(), { retentionDays: 0, maxRows: 0 });

    expect(result.discoveredPrintersDeleted).toBe(2);
    expect(remainingDiscoveredIds()).toEqual(['keep']);
  });

  it('keeps the rows of a registered but powered-off runner past the retention window', () => {
    // Discovery syncs every cycle while the runner process is up, but a registered runner
    // can be switched off for weeks. Only runner liveness may decide deletion, never age.
    insertRunner('idle-runner');
    insertDiscovered('idle-row', 'idle-runner', 'HP LaserJet Pro', '2000-01-01T00:00:00.000Z');

    const result = pruneOldRecords(getDb(), { retentionDays: 7, maxRows: 0 });

    expect(result.discoveredPrintersDeleted).toBe(0);
    expect(remainingDiscoveredIds()).toEqual(['idle-row']);
  });

  it('leaves a database with no discovered printers untouched', () => {
    insertRunner('live-runner');
    const result = pruneOldRecords(getDb(), { retentionDays: 7, maxRows: 0 });
    expect(result.discoveredPrintersDeleted).toBe(0);
  });
});

describe('GET /api/v1/discovered-printers after DELETE /runners/:id', () => {
  let app: FastifyInstance;
  let authorization: string;
  let originalDbMode: string | undefined;

  beforeEach(async () => {
    originalDbMode = process.env['DB_MODE'];
    process.env['DB_MODE'] = 'memory';
    process.env['PRINTOPS_DEV_SEED'] = 'true';
    const built = await buildApp();
    app = built.app;
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'sysadmin@printerops.local', password: 'Dev-password1!' },
    });
    authorization = `Bearer ${(login.json() as { token: string }).token}`;
  });

  afterEach(async () => {
    await app.close();
    if (originalDbMode === undefined) delete process.env['DB_MODE'];
    else process.env['DB_MODE'] = originalDbMode;
  });

  async function registerRunner(input: typeof RUNNER_A): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/runners/register',
      headers: { authorization },
      payload: input,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  async function syncDiscovery(runnerId: string, items: DiscoveryItem[]): Promise<void> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/runners/${runnerId}/printers/discovery`,
      headers: { authorization },
      payload: { items },
    });
    expect(res.statusCode).toBe(200);
  }

  async function listDiscovered(): Promise<Array<{ id: string; runnerId: string; localPrinterName: string }>> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/discovered-printers',
      headers: { authorization },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as Array<{ id: string; runnerId: string; localPrinterName: string }>;
  }

  it('no longer returns the deleted runner\'s printers', async () => {
    const staleRunner = await registerRunner(RUNNER_A);
    const liveRunner = await registerRunner(RUNNER_B);

    const staleItem: DiscoveryItem = {
      localPrinterName: 'Stale Label Printer',
      connectionType: 'tcp_ip',
      isDefault: false,
      isShared: false,
      computerName: 'retired-pc',
    };
    const liveItem: DiscoveryItem = {
      localPrinterName: 'Live Label Printer',
      connectionType: 'tcp_ip',
      isDefault: false,
      isShared: false,
      computerName: 'nurse-pc',
    };
    await syncDiscovery(staleRunner, [staleItem]);
    await syncDiscovery(liveRunner, [liveItem]);

    const before = await listDiscovered();
    expect(before.filter((printer) => printer.runnerId === staleRunner)).toHaveLength(1);
    expect(before.map((printer) => printer.localPrinterName)).toContain('Stale Label Printer');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/runners/${staleRunner}`,
      headers: { authorization },
    });
    expect(removed.statusCode).toBe(204);

    const after = await listDiscovered();
    expect(after.filter((printer) => printer.runnerId === staleRunner)).toHaveLength(0);
    expect(after.map((printer) => printer.localPrinterName)).not.toContain('Stale Label Printer');
    // The surviving runner's discovery data is untouched.
    expect(after.map((printer) => printer.localPrinterName)).toContain('Live Label Printer');

    const perRunner = await app.inject({
      method: 'GET',
      url: `/api/v1/runners/${staleRunner}/printers`,
      headers: { authorization },
    });
    expect(perRunner.statusCode).toBe(200);
    expect(perRunner.json()).toEqual([]);
  });
});
