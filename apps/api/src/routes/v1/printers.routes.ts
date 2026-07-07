import type { FastifyInstance } from 'fastify';
import type { PrinterRepositoryPort, ServiceAccount } from '@printerops/domain';
import type { GetPrinterStatusService } from '../../services/get-printer-status.service.js';

type ReqWithServiceAccount = { serviceAccount: ServiceAccount };

export async function v1PrinterRoutes(
  app: FastifyInstance,
  deps: {
    printers: PrinterRepositoryPort;
    getPrinterStatus: GetPrinterStatusService;
    apiKeyHook: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
): Promise<void> {
  const guard = { onRequest: [deps.apiKeyHook] };

  // GET /api/v1/printers — list active printers
  app.get('/printers', guard, async (_req, reply) => {
    const printers = await deps.printers.findAll();
    return reply.send(
      printers
        .filter((p) => p.isActive)
        .map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          location: p.location,
          protocol: p.protocol,
          isActive: p.isActive,
          allowedTemplates: p.allowedTemplates,
          maxCopiesPerJob: p.maxCopiesPerJob,
        }))
    );
  });

  // GET /api/v1/printers/:id/status
  app.get('/printers/:id/status', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = await deps.getPrinterStatus.execute(id);
    return reply.send(status);
  });
}
