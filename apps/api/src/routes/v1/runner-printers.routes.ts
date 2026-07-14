import type { FastifyInstance } from 'fastify';
import type { DiscoveredPrinter, DiscoveredPrinterRepositoryPort, DiscoveryItem } from '@printerops/domain';
import type { SyncPrinterDiscoveryService } from '../../services/sync-printer-discovery.service.js';
import type { RegisterDiscoveredPrinterService } from '../../services/register-discovered-printer.service.js';

/**
 * Deduplicate discovered printers for the global (all-runners) view.
 *
 * When computerName is available, the identity is (computerName, localPrinterName) —
 * the same physical printer on the same host, even if seen by different runner
 * incarnations. When computerName is missing, fall back to (runnerId,
 * localPrinterName) so unrelated printers are not collapsed.
 *
 * Among duplicates the most recently seen record (lastSeenAt) wins.
 */
export function deduplicateForGlobalView(printers: DiscoveredPrinter[]): DiscoveredPrinter[] {
  const seen = new Map<string, DiscoveredPrinter>();
  for (const p of printers) {
    const hostKey = p.computerName ?? p.runnerId;
    const key = `${hostKey}::${p.localPrinterName}`;
    const existing = seen.get(key);
    if (!existing || p.lastSeenAt > existing.lastSeenAt) {
      seen.set(key, p);
    }
  }
  return Array.from(seen.values());
}

export async function v1RunnerPrinterRoutes(
  app: FastifyInstance,
  deps: {
    discoveredPrinters: DiscoveredPrinterRepositoryPort;
    syncDiscovery: SyncPrinterDiscoveryService;
    registerDiscovered: RegisterDiscoveredPrinterService;
  }
): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  // POST /api/v1/runners/:runnerId/printers/discovery — runner syncs its discovered printers
  app.post('/runners/:runnerId/printers/discovery', auth, async (req, reply) => {
    const { runnerId } = req.params as { runnerId: string };
    const body = req.body as { items: DiscoveryItem[] };
    if (!Array.isArray(body?.items)) {
      return reply.status(400).send({ error: 'items array required' });
    }
    try {
      const result = await deps.syncDiscovery.execute(runnerId, body.items);
      return reply.status(200).send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'sync failed';
      return reply.status(404).send({ error: msg });
    }
  });

  // POST /api/v1/runners/:runnerId/printers/discover — request immediate discovery (runner picks up on next cycle)
  app.post('/runners/:runnerId/printers/discover', auth, async (req, reply) => {
    const { runnerId } = req.params as { runnerId: string };
    const printers = await deps.discoveredPrinters.findAll({ runnerId });
    return reply.status(202).send({ queued: true, runnerId, knownPrinters: printers.length });
  });

  // GET /api/v1/runners/:runnerId/printers — list discovered printers for a runner
  app.get('/runners/:runnerId/printers', auth, async (req, reply) => {
    const { runnerId } = req.params as { runnerId: string };
    const printers = await deps.discoveredPrinters.findAll({ runnerId });
    return reply.send(printers);
  });

  // GET /api/v1/discovered-printers — list all discovered printers (all runners), deduplicated
  app.get('/discovered-printers', auth, async (_req, reply) => {
    const printers = await deps.discoveredPrinters.findAll();
    return reply.send(deduplicateForGlobalView(printers));
  });

  // POST /api/v1/discovered-printers/:id/register — admin/owner registers as real Printer
  app.post('/discovered-printers/:id/register', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { printerCode?: string; location?: string } | undefined;
    const jwt = req.user as { sub: string; role: string };

    try {
      const printer = await deps.registerDiscovered.execute(
        id,
        { userId: jwt.sub, role: jwt.role as import('@printerops/domain').Role },
        { printerCode: body?.printerCode, location: body?.location }
      );
      return reply.status(201).send(printer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'registration failed';
      const status =
        msg.includes('not found') ? 404 :
        msg.includes('permission') || msg.includes('Permission') ? 403 : 400;
      return reply.status(status).send({ error: msg });
    }
  });
}
