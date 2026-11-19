import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, CupsPrinterAdapter, FakePrinterAdapter } from '@printerops/adapters';
import type { PrinterAdapterResult } from '@printerops/domain';
import { printerRoutes } from '../routes/printer.routes.js';
import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { CreatePrinterService } from '../services/create-printer.service.js';
import { GetPrinterStatusService } from '../services/get-printer-status.service.js';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function requestTestPrint(adapter: CupsPrinterAdapter | FakePrinterAdapter) {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'printer-test-print-test-secret' });
  const printers = new InMemoryPrinterRepository();
  const printer = await printers.create({
    name: 'Test printer', protocol: adapter.protocol,
    connectionUri: adapter.protocol === 'cups' ? 'cups://epsonTM-L100' : 'fake://test',
    metadata: {},
  });
  const registry = new AdapterRegistry();
  registry.registerAdapter(adapter);
  await printerRoutes(app, {
    printers, registry,
    createPrinter: new CreatePrinterService(printers, new InMemoryEventBus(), new InMemoryAuditRepository()),
    getPrinterStatus: new GetPrinterStatusService(printers, registry),
  });
  return app.inject({
    method: 'POST', url: `/printers/${printer.id}/test-print`,
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'operator', role: 'ADMIN' })}` },
  });
}

describe('printer detail test print HTTP outcome', () => {
  it('accepts a CUPS test with queue defaults while preserving unverified physical delivery', async () => {
    const response = await requestTestPrint(new CupsPrinterAdapter({
      run: async (file, args) => {
        if (file === 'lp') return 'request id is epsonTM-L100-42 (1 file(s))';
        if (file === 'ipptool') return 'job-id (integer) = 42';
        return args[0] === '-v'
          ? 'device for epsonTM-L100: socket://192.0.2.1:9100'
          : 'printer epsonTM-L100 is idle. enabled since Thu 19 Nov 2026';
      },
    }));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      success: false, errorCode: 'PRINT_NOT_VERIFIABLE', jobId: 'epsonTM-L100-42',
      raw: { spoolerAccepted: true, physicalDeliveryConfirmed: false },
    });
  });

  it.each([
    { errorCode: 'PRINT_NOT_VERIFIABLE', jobId: 'queue-42', message: 'Delivery unverified; do not auto-reprint' },
    { errorCode: 'FAKE_ERROR', message: 'Printer rejected the page' },
    { message: 'Test page failed without an adapter error code' },
  ])('returns an HTTP failure for $message', async (failure) => {
    class TestAdapter extends FakePrinterAdapter {
      override async printTestPage(): Promise<PrinterAdapterResult> {
        return { success: false, ...failure };
      }
    }
    const response = await requestTestPrint(new TestAdapter());
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      ...failure, success: false, error: failure.errorCode ?? 'TEST_PRINT_FAILED',
    });
  });

  it('keeps a successful adapter result successful', async () => {
    const response = await requestTestPrint(new FakePrinterAdapter());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true });
  });
});
