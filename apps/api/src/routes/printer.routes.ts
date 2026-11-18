import type { FastifyInstance } from 'fastify';
import type { CreatePrinterService } from '../services/create-printer.service.js';
import type { GetPrinterStatusService } from '../services/get-printer-status.service.js';
import { evaluatePrinterReadiness, type PrinterRepositoryPort } from '@printerops/domain';
import type { AdapterRegistry, CupsPrinterAdapter } from '@printerops/adapters';
import { AppError, ConflictError, NotFoundError } from '@printerops/shared';
import { normalizeCupsServer, type cupsServerSettings } from '../infra/cups-server-settings.js';
import { requirePermission } from './v1/permission-guard.js';

export async function printerRoutes(
  app: FastifyInstance,
  deps: {
    printers: PrinterRepositoryPort;
    createPrinter: CreatePrinterService;
    getPrinterStatus: GetPrinterStatusService;
    registry: AdapterRegistry;
    cups?: CupsPrinterAdapter;
    cupsSettings?: ReturnType<typeof cupsServerSettings>;
  }
): Promise<void> {
  // Previously guarded only by `app.authenticate` (any logged-in user, incl.
  // VIEWER, could create printers or fire test prints). Match the v1 routes'
  // permission model.
  const read = { onRequest: [requirePermission('printer:read')] };
  const create = { onRequest: [requirePermission('printer:create')] };
  const control = { onRequest: [requirePermission('printer:control')] };

  app.get('/printers', read, async () => {
    return deps.printers.findAll();
  });

  app.post('/printers', create, async (req, reply) => {
    const actor = (req.user as { sub: string }).sub;
    const printer = await deps.createPrinter.execute(req.body as Parameters<typeof deps.createPrinter.execute>[0], actor);
    return reply.status(201).send(printer);
  });

  app.get('/printers/cups-server', read, async () => {
    if (!deps.cups) throw new NotFoundError('CUPS', 'local adapter');
    return { server: deps.cups.getServer() };
  });

  app.put<{ Body: { server: string } }>('/printers/cups-server', {
    onRequest: [requirePermission('printer:update')],
    schema: { body: {
      type: 'object', required: ['server'], properties: { server: { type: 'string', maxLength: 260 } },
    } },
  }, async (req) => {
    if (!deps.cups || !deps.cupsSettings) throw new NotFoundError('CUPS', 'local adapter');
    const server = normalizeCupsServer(req.body.server);
    try {
      await deps.cups.assertServerReachable(server);
    } catch {
      throw new AppError('CUPS_UNREACHABLE', `Cannot connect to CUPS at ${server}`, 422);
    }
    await deps.cupsSettings.save(server);
    deps.cups.setServer(server);
    return { server };
  });

  app.get('/printers/cups-queues', read, async () => {
    if (!deps.cups) throw new NotFoundError('CUPS', 'local adapter');
    const [queues, printers] = await Promise.all([deps.cups.listPrinters(), deps.printers.findAll()]);
    const registered = new Set(printers.filter((printer) => printer.protocol === 'cups').map((printer) => printer.connectionUri));
    return queues.map((name) => ({ name, registered: registered.has(`cups://${name}`) }));
  });

  app.post<{ Params: { queue: string } }>('/printers/cups-queues/:queue', create, async (req, reply) => {
    const { queue } = req.params;
    if (!deps.cups || !(await deps.cups.listPrinters()).includes(queue)) {
      throw new NotFoundError('CUPS queue', queue);
    }
    const connectionUri = `cups://${queue}`;
    const existing = (await deps.printers.findAll()).find(
      (printer) => printer.protocol === 'cups' && printer.connectionUri === connectionUri,
    );
    if (existing) return existing;

    const code = `CUPS_${queue}`;
    try {
      const printer = await deps.createPrinter.execute(
        { code, name: queue, protocol: 'cups', connectionUri, metadata: {} },
        (req.user as { sub: string }).sub,
      );
      return reply.status(201).send(printer);
    } catch (error) {
      const registered = await deps.printers.findByCode(code);
      if (registered?.protocol === 'cups' && registered.connectionUri === connectionUri) return registered;
      if (registered) throw new ConflictError(`Printer code ${code} is already in use`);
      throw error;
    }
  });

  app.get('/printers/:id', read, async (req, reply) => {
    const { id } = req.params as { id: string };
    const printer = await deps.printers.findById(id);
    if (!printer) return reply.status(404).send({ error: 'Printer not found' });
    return printer;
  });

  app.get('/printers/:id/status', read, async (req) => {
    const { id } = req.params as { id: string };
    return deps.getPrinterStatus.execute(id);
  });

  app.post('/printers/:id/test-print', control, async (req, reply) => {
    const { id } = req.params as { id: string };
    const printer = await deps.printers.findById(id);
    if (!printer) throw new NotFoundError('Printer', id);

    // Keep the server-side physical-output gate aligned with the UI. Windows
    // USB queues may report UNKNOWN while WorkOffline=false; the shared policy
    // permits that with a warning, but still rejects explicit Offline, Error,
    // and Paused evidence. Adapter/device verification remains unchanged.
    const status = await deps.getPrinterStatus.execute(id);
    const readiness = evaluatePrinterReadiness({
      detected: status.detected,
      statusCode: status.code,
      rawStatus: status.rawStatus,
      rawState: status.rawState,
      workOffline: status.workOffline,
    });
    if (!readiness.ready) {
      return reply.status(409).send({
        error: 'PRINTER_NOT_READY',
        message: `Printer is not ready: ${readiness.blockedBy ?? 'explicit printer fault'}`,
        status,
      });
    }

    const adapter = deps.registry.getAdapterForPrinter(printer);
    return adapter.printTestPage(printer.connectionUri, printer.id);
  });
}
