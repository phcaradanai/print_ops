import type { FastifyInstance } from 'fastify';
import type { CreatePrinterService } from '../services/create-printer.service.js';
import type { GetPrinterStatusService } from '../services/get-printer-status.service.js';
import { evaluatePrinterReadiness, type PrinterRepositoryPort } from '@printerops/domain';
import type { AdapterRegistry, CupsPrinterAdapter } from '@printerops/adapters';
import { AppError, NotFoundError, ValidationError } from '@printerops/shared';
import {
  cupsAdminSettings,
  normalizeCupsAdminCredentials,
  normalizeCupsServer,
  type cupsServerSettings,
} from '../infra/cups-server-settings.js';
import { parseNetworkTargets } from '../services/network-printer-search.service.js';
import type { CupsProvisioningService, CupsQueueInput } from '../services/cups-provisioning.service.js';
import { requirePermission } from './v1/permission-guard.js';

/** Accept either explicit hosts or the CIDR/range input the scan form uses. */
function requestedHosts(body: { targets?: string; hosts?: string[] }): string[] {
  if (Array.isArray(body.hosts) && body.hosts.length > 0) return body.hosts;
  const targets = (body.targets ?? '').trim();
  if (!targets) throw new ValidationError('Enter IP addresses, a range or a host name to search');
  try {
    return parseNetworkTargets(targets);
  } catch (error) {
    // A single DNS name is a legitimate search target even though the IPv4
    // parser refuses it; anything else keeps the parser's message.
    if (/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(targets)) return [targets];
    throw error;
  }
}

export async function printerRoutes(
  app: FastifyInstance,
  deps: {
    printers: PrinterRepositoryPort;
    createPrinter: CreatePrinterService;
    getPrinterStatus: GetPrinterStatusService;
    registry: AdapterRegistry;
    cups?: CupsPrinterAdapter;
    cupsSettings?: ReturnType<typeof cupsServerSettings>;
    cupsAdmin?: ReturnType<typeof cupsAdminSettings>;
    cupsProvisioning?: CupsProvisioningService;
  }
): Promise<void> {
  // Previously guarded only by `app.authenticate` (any logged-in user, incl.
  // VIEWER, could create printers or fire test prints). Match the v1 routes'
  // permission model.
  const read = { onRequest: [requirePermission('printer:read')] };
  const create = { onRequest: [requirePermission('printer:create')] };
  const control = { onRequest: [requirePermission('printer:control')] };
  const update = { onRequest: [requirePermission('printer:update')] };

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
    const [queues, printers, devices] = await Promise.all([
      deps.cups.listPrinters(),
      deps.printers.findAll(),
      deps.cups.listQueueDevices(),
    ]);
    const registered = new Set(printers.filter((printer) => printer.protocol === 'cups').map((printer) => printer.connectionUri));
    return queues.map((name) => ({
      name,
      registered: registered.has(`cups://${name}`),
      deviceUri: devices[name],
    }));
  });

  app.get('/printers/cups-admin', read, async () => {
    if (!deps.cupsAdmin) throw new NotFoundError('CUPS', 'local adapter');
    return deps.cupsAdmin.status();
  });

  // Credentials let PrintOps manage the station's CUPS spooler itself, so an
  // operator never has to run lpadmin on the host.
  app.put<{ Body: { user: string; password: string } }>('/printers/cups-admin', {
    onRequest: [requirePermission('printer:update')],
    schema: { body: {
      type: 'object', required: ['user', 'password'], properties: {
        user: { type: 'string', maxLength: 64 }, password: { type: 'string', maxLength: 256 },
      },
    } },
  }, async (req) => {
    if (!deps.cupsAdmin || !deps.cups) throw new NotFoundError('CUPS', 'local adapter');
    const credentials = normalizeCupsAdminCredentials(req.body);
    await deps.cupsAdmin.save(credentials);
    deps.cups.setAdminCredentials(credentials);
    return deps.cupsAdmin.status();
  });

  app.delete('/printers/cups-admin', update, async () => {
    if (!deps.cupsAdmin || !deps.cups) throw new NotFoundError('CUPS', 'local adapter');
    await deps.cupsAdmin.clear();
    deps.cups.setAdminCredentials(undefined);
    return deps.cupsAdmin.status();
  });

  /** Probe candidate hosts for IPP printers CUPS has never seen. */
  app.post<{ Body: { targets?: string; hosts?: string[] } }>('/printers/cups-scan', {
    onRequest: [requirePermission('printer:read')],
    schema: { body: {
      type: 'object', properties: {
        targets: { type: 'string', maxLength: 4096 },
        hosts: { type: 'array', maxItems: 256, items: { type: 'string', maxLength: 260 } },
      },
    } },
  }, async (req) => {
    if (!deps.cupsProvisioning) throw new NotFoundError('CUPS', 'local adapter');
    return deps.cupsProvisioning.scan(requestedHosts(req.body));
  });

  const adminCredentials = async (explicit?: { user?: string; password?: string }) => {
    if (explicit?.user && explicit.password) return normalizeCupsAdminCredentials(explicit);
    return deps.cupsAdmin ? deps.cupsAdmin.read() : undefined;
  };

  // Create the CUPS queue for a device and register it, in one call.
  app.post<{ Body: CupsQueueInput & { adminUser?: string; adminPassword?: string } }>('/printers/cups-queues', {
    onRequest: [requirePermission('printer:create')],
    schema: { body: {
      type: 'object', properties: {
        queue: { type: 'string', maxLength: 127 },
        host: { type: 'string', maxLength: 260 },
        deviceUri: { type: 'string', maxLength: 512 },
        info: { type: 'string', maxLength: 127 },
        location: { type: 'string', maxLength: 127 },
        adminUser: { type: 'string', maxLength: 64 },
        adminPassword: { type: 'string', maxLength: 256 },
      },
    } },
  }, async (req, reply) => {
    if (!deps.cupsProvisioning) throw new NotFoundError('CUPS', 'local adapter');
    const credentials = await adminCredentials({ user: req.body.adminUser, password: req.body.adminPassword });
    const result = await deps.cupsProvisioning.createQueue({
      queue: req.body.queue,
      host: req.body.host,
      deviceUri: req.body.deviceUri,
      info: req.body.info,
      location: req.body.location,
    }, (req.user as { sub: string }).sub, credentials);
    if (req.body.adminUser && req.body.adminPassword && deps.cupsAdmin && deps.cups) {
      const stored = normalizeCupsAdminCredentials(req.body);
      await deps.cupsAdmin.save(stored);
      deps.cups.setAdminCredentials(stored);
    }
    return reply.status(result.created ? 201 : 200).send(result);
  });

  // Register a queue that already exists in CUPS (created by a vendor tool).
  app.post<{ Params: { queue: string } }>('/printers/cups-queues/:queue', create, async (req, reply) => {
    const { queue } = req.params;
    if (!deps.cups) throw new NotFoundError('CUPS', 'local adapter');
    const actorId = (req.user as { sub: string }).sub;
    if (deps.cupsProvisioning) {
      const result = await deps.cupsProvisioning.registerQueue(queue, actorId);
      return reply.status(result.registered ? 201 : 200).send(result.printer);
    }
    if (!(await deps.cups.listPrinters()).includes(queue)) throw new NotFoundError('CUPS queue', queue);
    const connectionUri = `cups://${queue}`;
    const existing = (await deps.printers.findAll()).find(
      (printer) => printer.protocol === 'cups' && printer.connectionUri === connectionUri,
    );
    if (existing) return existing;
    return reply.status(201).send(await deps.createPrinter.execute(
      { code: `CUPS_${queue}`, name: queue, protocol: 'cups', connectionUri, metadata: {} },
      actorId,
    ));
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
    const result = await adapter.printTestPage(printer.connectionUri, printer.id);
    if (result.errorCode === 'PRINT_NOT_VERIFIABLE'
      && result.raw && typeof result.raw === 'object'
      && 'spoolerAccepted' in result.raw && result.raw.spoolerAccepted === true) {
      return reply.status(202).send(result);
    }
    // Command clients use HTTP status to decide whether the test was sent.
    // Preserve unverified delivery and preparation failures instead of reporting
    // a successful command merely because the adapter returned normally.
    if (!result.success) {
      return reply.status(result.errorCode === 'PAPER_PROFILE_REQUIRED' ? 422 : 502).send({
        ...result,
        error: result.errorCode ?? 'TEST_PRINT_FAILED',
        message: result.message ?? 'Test print failed',
      });
    }
    return result;
  });
}
