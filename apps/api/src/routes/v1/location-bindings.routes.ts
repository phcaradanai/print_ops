import type { FastifyInstance } from 'fastify';
import type { CreateLocationPrinterBindingInput, LocationPrinterBindingRepositoryPort } from '@printerops/domain';
import { requirePermission } from './permission-guard.js';
import type { LocationPrinterService } from '../../services/location-printer.service.js';

/** CRUD for location → printer IP bindings (`location_code` print routing). */
export async function v1LocationBindingRoutes(
  app: FastifyInstance,
  deps: { bindings: LocationPrinterBindingRepositoryPort; locations: LocationPrinterService },
): Promise<void> {
  type Body = Partial<CreateLocationPrinterBindingInput>;

  app.get('/location-bindings', { onRequest: [requirePermission('printer:read')] }, async () => {
    const bindings = await deps.bindings.findAll();
    // Show which registered printer each IP resolves to right now, so a typo'd IP is visible.
    return Promise.all(bindings.map(async (b) => ({
      ...b,
      resolvedPrinterCode: (await deps.locations.findPrinterByIp(b.printerIp))?.code ?? null,
    })));
  });

  app.get('/location-bindings/printer-options', { onRequest: [requirePermission('printer:read')] }, async () =>
    deps.locations.printerOptions());

  app.post('/location-bindings', { onRequest: [requirePermission('printer:update')] }, async (req, reply) =>
    reply.status(201).send(await deps.locations.create((req.body ?? {}) as Body)));

  app.put('/location-bindings/:id', { onRequest: [requirePermission('printer:update')] }, async (req) => {
    const { id } = req.params as { id: string };
    return deps.locations.update(id, (req.body ?? {}) as Body);
  });

  app.delete('/location-bindings/:id', { onRequest: [requirePermission('printer:update')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deps.locations.delete(id);
    return reply.status(204).send();
  });
}
