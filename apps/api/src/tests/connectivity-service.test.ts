import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { AdapterRegistry, FakePrinterAdapter } from '@printerops/adapters';
import { PrinterConnectivityService } from '../services/printer-connectivity.service.js';

let printerRepo: InMemoryPrinterRepository;
let registry: AdapterRegistry;

function makeService() {
  return new PrinterConnectivityService(printerRepo, registry);
}

describe('PrinterConnectivityService', () => {
  beforeEach(async () => {
    printerRepo = new InMemoryPrinterRepository();
    registry = new AdapterRegistry();
  });

  it('reports printer as online when detected and status OK', async () => {
    registry.registerAdapter(new FakePrinterAdapter({ latencyMs: 0 }));
    const printer = await printerRepo.create({
      code: 'ONLINE_PRINTER',
      name: 'Online Printer',
      protocol: 'fake',
      connectionUri: 'fake://online',
      isActive: true,
      metadata: {},
    });

    const svc = makeService();
    const result = await svc.checkPrinter(printer.id);

    expect(result.detected).toBe(true);
    expect(result.statusCode).toBe('idle');
    expect(result.printerCode).toBe('ONLINE_PRINTER');
    expect(result.adapterUsed).toBe('FakePrinterAdapter');
    expect(result.error).toBeUndefined();
    expect(result.checkTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.tonerLevels).toBeDefined();
  });

  it('reports printer as offline when not detected', async () => {
    registry.registerAdapter(new FakePrinterAdapter({ latencyMs: 0, shouldBeOffline: true }));
    const printer = await printerRepo.create({
      code: 'OFFLINE_PRINTER',
      name: 'Offline Printer',
      protocol: 'fake',
      connectionUri: 'fake://offline',
      isActive: true,
      metadata: {},
    });

    const svc = makeService();
    const result = await svc.checkPrinter(printer.id);

    expect(result.detected).toBe(false);
    expect(result.statusCode).toBe('offline');
    expect(result.statusMessage).toContain('not detected');
    expect(result.tonerLevels).toBeUndefined();
  });

  it('reports error when status query fails after detection', async () => {
    registry.registerAdapter(new FakePrinterAdapter({
      latencyMs: 0,
      shouldBeOffline: false,
      shouldStatusFail: true,
    }));
    const printer = await printerRepo.create({
      code: 'STATUS_FAIL',
      name: 'Status Fail',
      protocol: 'fake',
      connectionUri: 'fake://statusfail',
      isActive: true,
      metadata: {},
    });

    const svc = makeService();
    const result = await svc.checkPrinter(printer.id);

    expect(result.detected).toBe(true);
    expect(result.statusCode).toBe('error');
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe('STATUS_FAILED');
  });

  it('reports NOT_FOUND for nonexistent printer', async () => {
    registry.registerAdapter(new FakePrinterAdapter({ latencyMs: 0 }));
    const svc = makeService();
    const result = await svc.checkPrinter('nonexistent-id');

    expect(result.detected).toBe(false);
    expect(result.statusCode).toBe('unknown');
    expect(result.errorCode).toBe('NOT_FOUND');
    expect(result.printerCode).toBe('unknown');
  });

  it('checkAll returns summary report for all printers', async () => {
    registry.registerAdapter(new FakePrinterAdapter({ latencyMs: 0 }));
    // Online printer
    await printerRepo.create({
      code: 'P1', name: 'Printer 1', protocol: 'fake', connectionUri: 'fake://p1', isActive: true, metadata: {},
    });

    // Create a separate adapter instance for offline
    const offlineReg = new AdapterRegistry();
    offlineReg.registerAdapter(new FakePrinterAdapter({ latencyMs: 0, shouldBeOffline: true }));
    const offlinePrinter = await printerRepo.create({
      code: 'P2', name: 'Printer 2', protocol: 'fake', connectionUri: 'fake://p2', isActive: true, metadata: {},
    });

    // Run checkAll with mixed adapters — use the registry that detects the online one
    const svc = makeService();
    const report = await svc.checkAll();

    expect(report.reportId).toBeDefined();
    expect(report.total).toBe(2);
    expect(report.results.length).toBe(2);
    expect(report.results.some((r) => r.detected)).toBe(true);
  });

  it('handles multiple custom status codes', async () => {
    registry.registerAdapter(new FakePrinterAdapter({ latencyMs: 0, statusCode: 'busy' }));
    const printer = await printerRepo.create({
      code: 'BUSY', name: 'Busy', protocol: 'fake', connectionUri: 'fake://busy', isActive: true, metadata: {},
    });

    const svc = makeService();
    const result = await svc.checkPrinter(printer.id);

    expect(result.detected).toBe(true);
    expect(result.statusCode).toBe('busy');
  });
});
