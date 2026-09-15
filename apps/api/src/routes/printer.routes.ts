import type { FastifyInstance } from 'fastify';
import type { CreatePrinterService } from '../services/create-printer.service.js';
import type { GetPrinterStatusService } from '../services/get-printer-status.service.js';
import { evaluatePrinterReadiness, type PrinterRepositoryPort } from '@printerops/domain';
import type { AdapterRegistry } from '@printerops/adapters';
import { NotFoundError } from '@printerops/shared';
import { requirePermission } from './v1/permission-guard.js';

export async function printerRoutes(
  app: FastifyInstance,
  deps: {
    printers: PrinterRepositoryPort;
    createPrinter: CreatePrinterService;
    getPrinterStatus: GetPrinterStatusService;
    registry: AdapterRegistry;
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
