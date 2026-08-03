import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceAccount, JobPriority, IntakeAttemptRepositoryPort } from '@printerops/domain';
import { AppError } from '@printerops/shared';
import type { DynamicPrintService } from '../../services/dynamic-print.service.js';
import type { IntakeOutcomeCallbackService } from '../../services/intake-outcome-callback.service.js';

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
    intakeLog?: IntakeAttemptRepositoryPort;
    intakeCallbacks?: IntakeOutcomeCallbackService;
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
        /** Optional webhook endpoint whose callback config receives this job's
         *  terminal print result. Omitting it keeps the previous behaviour
         *  (no result callback) exactly. */
        endpoint_code?: string;
      };

      if (!body.request_id) {
        void deps.intakeLog?.record({
          source: 'api',
          outcome: 'rejected',
          reason: 'request_id is required',
          sourceSystem: body.source_system ?? sa.sourceSystem,
          sourceReference: body.source_reference,
          codeTemplate: code_template,
          codeProfile: code_profile,
          printerCode: body.printer_code,
        });
        await deps.intakeCallbacks?.notifyRejected({
          endpointCode: body.endpoint_code,
          sourceSystem: body.source_system ?? sa.sourceSystem,
          sourceReference: body.source_reference,
          intakeTransport: 'API',
          stage: 'VALIDATION',
          errorCode: 'VALIDATION_ERROR',
          errorMessage: 'request_id is required',
          intakePayload: body.payload ?? {},
        }).catch(() => false);
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
            endpoint_code: body.endpoint_code,
          },
          sa.id,
          { allowedPrinterCodes: sa.allowedPrinterCodes },
        );
        const status = result.duplicate ? 200 : 201;
        return reply.status(status).send(result);
      } catch (err: unknown) {
        const errorCode = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
        const errorMessage = err instanceof Error ? err.message : 'Internal server error';
        await deps.intakeCallbacks?.notifyRejected({
          endpointCode: body.endpoint_code,
          sourceSystem: body.source_system ?? sa.sourceSystem,
          requestId: body.request_id,
          sourceReference: body.source_reference,
          intakeTransport: 'API',
          stage: 'INTAKE',
          errorCode,
          errorMessage,
          intakePayload: body.payload ?? {},
        }).catch(() => false);
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.code, message: err.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: errorMessage });
      }
    },
  );
}
