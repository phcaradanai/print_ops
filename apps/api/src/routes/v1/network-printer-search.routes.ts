import type { FastifyInstance } from 'fastify';
import type { NetworkPrinterSearch } from '@printerops/domain';
import type { NetworkPrinterSearchService } from '../../services/network-printer-search.service.js';
import { AppError } from '@printerops/shared';
import { actor, requirePermission } from './permission-guard.js';

function publicSearch(search: NetworkPrinterSearch | undefined) {
  if (!search) return null;
  const { claimToken: _claimToken, ...safe } = search;
  return safe;
}

export async function v1NetworkPrinterSearchRoutes(app: FastifyInstance, deps: { searches: NetworkPrinterSearchService }) {
  const manage = { onRequest: [requirePermission('printer:create')] };
  const read = { onRequest: [requirePermission('printer:read')] };
  const runner = { onRequest: [requirePermission('runner:manage')] };
  const base = '/runners/:runnerId/printer-searches';
  // Keep errors local: this route also runs in small integration-test apps.
  const respond = async (work: () => Promise<unknown>, reply: import('fastify').FastifyReply, status = 200) => {
    try { return reply.status(status).send(await work()); }
    catch (error) {
      if (error instanceof AppError) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      throw error;
    }
  };
  app.post<{ Params: { runnerId: string }; Body: { targets?: unknown } }>(base, manage, (req, reply) =>
    respond(async () => publicSearch(await deps.searches.start(req.params.runnerId, req.body?.targets, actor(req))), reply, 202));
  app.get<{ Params: { runnerId: string } }>(`${base}/latest`, read, (req, reply) =>
    respond(async () => publicSearch(await deps.searches.latest(req.params.runnerId)), reply));
  app.post<{ Params: { runnerId: string } }>(`${base}/claim`, runner, (req, reply) =>
    respond(async () => (await deps.searches.claim(req.params.runnerId)) ?? null, reply));
  app.post<{ Params: { runnerId: string; id: string }; Body: { claimToken?: unknown; addresses?: unknown; incomplete?: unknown } }>(`${base}/:id/results`, runner, (req, reply) =>
    respond(async () => publicSearch(await deps.searches.finish(req.params.runnerId, req.params.id, req.body?.claimToken, req.body?.addresses, req.body?.incomplete)), reply));
  app.get<{ Params: { id: string } }>('/printer-searches/:id', read, (req, reply) =>
    respond(async () => publicSearch(await deps.searches.get(req.params.id)), reply));
}
