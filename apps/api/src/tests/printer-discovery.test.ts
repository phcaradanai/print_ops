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
import type { DiscoveryItem, PermissionContext } from '@printerops/domain';

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
