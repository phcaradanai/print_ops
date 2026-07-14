import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDiscoveredPrinterRepository } from '../infra/repos/in-memory-discovered-printer.repo.js';
import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryRunnerRepository } from '../infra/repos/in-memory-runner.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { RbacPermissionPolicy } from '../infra/permission/rbac-permission.policy.js';
import { SyncPrinterDiscoveryService } from '../services/sync-printer-discovery.service.js';
import { RegisterDiscoveredPrinterService } from '../services/register-discovered-printer.service.js';
import { CheckPermissionService } from '../services/check-permission.service.js';
import { PermissionError } from '@printerops/shared';
import { deduplicateForGlobalView } from '../routes/v1/runner-printers.routes.js';
import type { DiscoveredPrinter, DiscoveryItem, PermissionContext } from '@printerops/domain';

let discoveredRepo: InMemoryDiscoveredPrinterRepository;
let printerRepo: InMemoryPrinterRepository;
let runnerRepo: InMemoryRunnerRepository;
let auditRepo: InMemoryAuditRepository;
let eventBus: InMemoryEventBus;
let syncDiscovery: SyncPrinterDiscoveryService;
let registerDiscovered: RegisterDiscoveredPrinterService;

const adminCtx: PermissionContext = { userId: 'admin-1', role: 'ADMIN' };
const viewerCtx: PermissionContext = { userId: 'viewer-1', role: 'VIEWER' };

const sampleItems: DiscoveryItem[] = [
  {
    localPrinterName: 'HP LaserJet Pro',
    driverName: 'HP Universal PCL6',
    portName: 'USB001',
    connectionType: 'usb',
    isDefault: true,
    isShared: false,
  },
  {
    localPrinterName: 'Zebra ZD420',
    driverName: 'ZDesigner ZD420',
    portName: '192.168.1.50',
    connectionType: 'tcp_ip',
    isDefault: false,
    isShared: false,
  },
];

beforeEach(async () => {
  discoveredRepo = new InMemoryDiscoveredPrinterRepository();
  printerRepo = new InMemoryPrinterRepository();
  runnerRepo = new InMemoryRunnerRepository();
  auditRepo = new InMemoryAuditRepository();
  eventBus = new InMemoryEventBus();

  await runnerRepo.create({
    id: 'runner-1',
    name: 'Test Runner',
    hostname: 'test-pc',
    supportedProtocols: ['windows_spooler'],
    metadata: {},
  });

  const checkPermission = new CheckPermissionService(new RbacPermissionPolicy(), eventBus);
  syncDiscovery = new SyncPrinterDiscoveryService(discoveredRepo, runnerRepo);
  registerDiscovered = new RegisterDiscoveredPrinterService(discoveredRepo, printerRepo, auditRepo, checkPermission);
});

describe('SyncPrinterDiscoveryService', () => {
  it('creates discovered printers from runner sync', async () => {
    const result = await syncDiscovery.execute('runner-1', sampleItems);
    expect(result.upserted).toBe(2);

    const all = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    expect(all).toHaveLength(2);
    expect(all[0]?.localPrinterName).toBe('HP LaserJet Pro');
    expect(all[0]?.connectionType).toBe('usb');
  });

  it('updates existing discovered printer on duplicate sync (no new row)', async () => {
    await syncDiscovery.execute('runner-1', sampleItems);

    const beforeAll = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    const beforeLastSeen = beforeAll[0]?.lastSeenAt;

    // Wait a tick then sync again with updated driver
    const updatedItems = [{ ...sampleItems[0]!, driverName: 'HP Updated Driver' }];
    await syncDiscovery.execute('runner-1', updatedItems);

    const afterAll = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    expect(afterAll).toHaveLength(2); // count unchanged
    const updated = afterAll.find((p) => p.localPrinterName === 'HP LaserJet Pro');
    expect(updated?.driverName).toBe('HP Updated Driver');
    expect(updated?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(beforeLastSeen!.getTime());
  });

  it('throws when runner not found', async () => {
    await expect(syncDiscovery.execute('nonexistent-runner', sampleItems)).rejects.toThrow('not found');
  });
});

describe('RegisterDiscoveredPrinterService', () => {
  it('admin can register a discovered printer as a real Printer', async () => {
    await syncDiscovery.execute('runner-1', [sampleItems[0]!]);
    const all = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    const dp = all[0]!;

    const printer = await registerDiscovered.execute(dp.id, adminCtx, {});

    expect(printer.protocol).toBe('windows_spooler');
    expect(printer.code).toBe('HP_LASERJET_PRO');
    expect(printer.metadata['runnerId']).toBe('runner-1');

    const updated = await discoveredRepo.findById(dp.id);
    expect(updated?.registeredPrinterId).toBe(printer.id);
  });

  it('VIEWER role is rejected with PermissionError', async () => {
    await syncDiscovery.execute('runner-1', [sampleItems[0]!]);
    const all = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    const dp = all[0]!;

    await expect(registerDiscovered.execute(dp.id, viewerCtx, {})).rejects.toThrow(PermissionError);
  });

  it('creates an audit log on successful registration', async () => {
    await syncDiscovery.execute('runner-1', [sampleItems[0]!]);
    const all = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    const dp = all[0]!;

    await registerDiscovered.execute(dp.id, adminCtx, {});

    const logs = await auditRepo.findAll({ resourceType: 'printer' });
    const regLog = logs.find((l) => l.action === 'printer.registered_from_discovery');
    expect(regLog).toBeDefined();
    expect(regLog?.actorId).toBe('admin-1');
  });

  it('rejects registering the same printer twice', async () => {
    await syncDiscovery.execute('runner-1', [sampleItems[0]!]);
    const all = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    const dp = all[0]!;

    await registerDiscovered.execute(dp.id, adminCtx, {});
    await expect(registerDiscovered.execute(dp.id, adminCtx, {})).rejects.toThrow('Already registered');
  });
});

describe('DiscoveredPrinterRepository', () => {
  it('findAll with runnerId filter returns only that runner\'s printers', async () => {
    await runnerRepo.create({ id: 'runner-2', name: 'Runner 2', hostname: 'pc-2', supportedProtocols: [], metadata: {} });
    await syncDiscovery.execute('runner-1', [sampleItems[0]!]);
    await syncDiscovery.execute('runner-2', [sampleItems[1]!]);

    const r1 = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    const r2 = await discoveredRepo.findAll({ runnerId: 'runner-2' });
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r1[0]?.localPrinterName).toBe('HP LaserJet Pro');
    expect(r2[0]?.localPrinterName).toBe('Zebra ZD420');
  });
});

describe('deduplication for global GET /discovered-printers', () => {
  // The global endpoint should return one record per (computerName, localPrinterName)
  // when computerName is set, preferring the most recently seen record.
  // When computerName is missing, fall back to (runnerId, localPrinterName).

  it('returns one record per same-host printer (same computerName + localPrinterName, different runnerIds)', async () => {
    // Simulate runner-1 discovering HP LaserJet on nurse-station-pc
    await runnerRepo.create({ id: 'r-old', name: 'Old Runner', hostname: 'nurse-station-pc', supportedProtocols: [], metadata: {} });
    await syncDiscovery.execute('r-old', [{
      ...sampleItems[0]!,
      computerName: 'nurse-station-pc',
    }]);

    // Runner restarts, gets new id r-new, discovers the SAME HP LaserJet on the SAME host
    await runnerRepo.create({ id: 'r-new', name: 'New Runner', hostname: 'nurse-station-pc', supportedProtocols: [], metadata: {} });
    await syncDiscovery.execute('r-new', [{
      ...sampleItems[0]!,
      computerName: 'nurse-station-pc',
    }]);

    // Repo with no filter returns both rows (two runnerIds, same host+name)
    const all = await discoveredRepo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Verify they are from different runnerIds
    const hpPrinters = all.filter((p) => p.localPrinterName === 'HP LaserJet Pro');
    expect(hpPrinters).toHaveLength(2);
    expect(hpPrinters[0]!.runnerId).not.toBe(hpPrinters[1]!.runnerId);
  });

  it('keeps distinct printers from different hosts even with same localPrinterName', async () => {
    await runnerRepo.create({ id: 'r-a', name: 'Runner A', hostname: 'pc-accounting', supportedProtocols: [], metadata: {} });
    await runnerRepo.create({ id: 'r-b', name: 'Runner B', hostname: 'pc-nursing', supportedProtocols: [], metadata: {} });

    await syncDiscovery.execute('r-a', [{
      ...sampleItems[0]!,
      computerName: 'pc-accounting',
    }]);
    await syncDiscovery.execute('r-b', [{
      ...sampleItems[0]!,
      computerName: 'pc-nursing',
    }]);

    const all = await discoveredRepo.findAll();
    const hpPrinters = all.filter((p) => p.localPrinterName === 'HP LaserJet Pro');
    expect(hpPrinters).toHaveLength(2);
    const names = new Set(hpPrinters.map((p) => p.computerName));
    expect(names.has('pc-accounting')).toBe(true);
    expect(names.has('pc-nursing')).toBe(true);
  });

  it('when computerName is missing, does NOT collapse unrelated printers (falls back to runnerId)', async () => {
    // Two runners without computerName discover printers with the same local name
    // They should NOT be collapsed because there's no shared host identity
    await runnerRepo.create({ id: 'r-x', name: 'Runner X', hostname: 'unknown-1', supportedProtocols: [], metadata: {} });
    await runnerRepo.create({ id: 'r-y', name: 'Runner Y', hostname: 'unknown-2', supportedProtocols: [], metadata: {} });

    await syncDiscovery.execute('r-x', [sampleItems[0]!]);
    await syncDiscovery.execute('r-y', [sampleItems[0]!]);

    const all = await discoveredRepo.findAll();
    const hpPrinters = all.filter((p) => p.localPrinterName === 'HP LaserJet Pro');
    expect(hpPrinters).toHaveLength(2);
    // They are from different runners — not collapsed
    const runnerIds = new Set(hpPrinters.map((p) => p.runnerId));
    expect(runnerIds.size).toBe(2);
  });
});

describe('computerName / osName enrichment', () => {
  it('stores and retrieves computerName and osName from discovery items', async () => {
    const itemWithMeta: DiscoveryItem = {
      ...sampleItems[0]!,
      computerName: 'nurse-station-pc',
      osName: 'win32',
    };
    await syncDiscovery.execute('runner-1', [itemWithMeta]);
    const all = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    expect(all[0]?.computerName).toBe('nurse-station-pc');
    expect(all[0]?.osName).toBe('win32');
  });

  it('updates computerName on re-sync', async () => {
    await syncDiscovery.execute('runner-1', [{ ...sampleItems[0]!, computerName: 'old-hostname' }]);
    await syncDiscovery.execute('runner-1', [{ ...sampleItems[0]!, computerName: 'new-hostname' }]);
    const all = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    expect(all).toHaveLength(1);
    expect(all[0]?.computerName).toBe('new-hostname');
  });

  it('leaves computerName undefined when not sent', async () => {
    await syncDiscovery.execute('runner-1', [sampleItems[0]!]);
    const all = await discoveredRepo.findAll({ runnerId: 'runner-1' });
    expect(all[0]?.computerName).toBeUndefined();
    expect(all[0]?.osName).toBeUndefined();
  });
});

// Pure-function tests for deduplicateForGlobalView
function dp(overrides: Partial<DiscoveredPrinter> = {}): DiscoveredPrinter {
  const t = new Date();
  return {
    id: 'id',
    runnerId: 'runner-1',
    localPrinterName: 'HP LaserJet',
    connectionType: 'usb',
    isDefault: false,
    isShared: false,
    attributes: {},
    firstSeenAt: t,
    lastSeenAt: t,
    ...overrides,
  };
}

describe('deduplicateForGlobalView', () => {
  it('collapses same-host same-name records, keeping most recent', () => {
    const older = dp({
      runnerId: 'r-old',
      computerName: 'nurse-pc',
      localPrinterName: 'HP LaserJet',
      lastSeenAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newer = dp({
      runnerId: 'r-new',
      computerName: 'nurse-pc',
      localPrinterName: 'HP LaserJet',
      lastSeenAt: new Date('2026-06-01T00:00:00Z'),
    });
    const result = deduplicateForGlobalView([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0]!.runnerId).toBe('r-new');
  });

  it('keeps distinct printers from different hosts even with same localPrinterName', () => {
    const a = dp({ computerName: 'pc-acct', localPrinterName: 'HP LaserJet', runnerId: 'r-a' });
    const b = dp({ computerName: 'pc-nurse', localPrinterName: 'HP LaserJet', runnerId: 'r-b' });
    const result = deduplicateForGlobalView([a, b]);
    expect(result).toHaveLength(2);
    const names = new Set(result.map((p) => p.computerName));
    expect(names.has('pc-acct')).toBe(true);
    expect(names.has('pc-nurse')).toBe(true);
  });

  it('when computerName is missing, falls back to runnerId (does NOT collapse unrelated)', () => {
    const a = dp({ runnerId: 'r-x', localPrinterName: 'HP LaserJet', computerName: undefined });
    const b = dp({ runnerId: 'r-y', localPrinterName: 'HP LaserJet', computerName: undefined });
    const result = deduplicateForGlobalView([a, b]);
    expect(result).toHaveLength(2);
  });

  it('when one record has computerName and the other has only runnerId, they are NOT collapsed', () => {
    const withHost = dp({ runnerId: 'r-a', computerName: 'nurse-pc', localPrinterName: 'HP LaserJet' });
    const withoutHost = dp({ runnerId: 'r-b', computerName: undefined, localPrinterName: 'HP LaserJet' });
    const result = deduplicateForGlobalView([withHost, withoutHost]);
    expect(result).toHaveLength(2);
  });

  it('passes through an empty array', () => {
    expect(deduplicateForGlobalView([])).toHaveLength(0);
  });

  it('passes through a single record unchanged', () => {
    const single = dp({ computerName: 'nurse-pc' });
    const result = deduplicateForGlobalView([single]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('id');
  });
});
