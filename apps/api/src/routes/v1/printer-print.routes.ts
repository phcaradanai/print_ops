import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceAccount, JobPriority } from '@printerops/domain';
import { AppError } from '@printerops/shared';
import type { DynamicPrintService } from '../../services/dynamic-print.service.js';

type ReqWithServiceAccount = { serviceAccount: ServiceAccount };

/**
 * Dynamic print endpoint: POST /api/v1/printer/:code_template/:code_profile
 *
 * The template code and paper-profile code travel in the path so external
 * callers can drive PrintOps with a configurable base path such as
 * `api/v1/printer/{{code_template}}/{{code_profile}}`. The printer is resolved
 * from the (template + profile) binding and the job is created through the same
 * AcceptExternalJobService used by POST /api/v1/print-jobs.
 */
export async function v1PrinterPrintRoutes(
  app: FastifyInstance,
  deps: {
    dynamicPrint: DynamicPrintService;
    apiKeyHook: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  },
): Promise<void> {
  app.post(
    '/printer/:code_template/:code_profile',
    { onRequest: [deps.apiKeyHook] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const sa = (req as unknown as ReqWithServiceAccount).serviceAccount;
      const { code_template, code_profile } = req.params as {
        code_template: string;
        code_profile: string;
      };
      const body = (req.body ?? {}) as {
        request_id?: string;
        source_system?: string;
        source_reference?: string;
        printer_code?: string;
        payload?: Record<string, unknown>;
        copies?: number;
        priority?: JobPriority;
        metadata?: Record<string, unknown>;
      };

      if (!body.request_id) {
        return reply.status(400).send({ error: 'request_id is required' });
      }

      try {
        // The service-account printer allowlist is enforced inside submit()
        // against the RESOLVED printer, covering both the explicit printer_code
        // and the binding-resolved cases.
        const result = await deps.dynamicPrint.submit(
          {
            request_id: body.request_id,
            source_system: body.source_system ?? sa.sourceSystem,
            source_reference: body.source_reference,
            code_template,
            code_profile,
            printer_code: body.printer_code,
            payload: body.payload ?? {},
            copies: body.copies,
            priority: body.priority,
            metadata: body.metadata,
          },
          sa.id,
          { allowedPrinterCodes: sa.allowedPrinterCodes },
        );
        const status = result.duplicate ? 200 : 201;
        return reply.status(status).send(result);
      } catch (err: unknown) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.code, message: err.message });
        }
        const message = err instanceof Error ? err.message : 'Internal server error';
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message });
      }
    },
  );
}
