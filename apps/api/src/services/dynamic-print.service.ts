import type { JobPriority, IntakeAttemptRepositoryPort, IntakeSource } from '@printerops/domain';
import { AppError, ValidationError } from '@printerops/shared';
import type { AcceptExternalJobService, ExternalPrintJobResponse } from './accept-external-job.service.js';
import type { ResolvePrinterBindingService } from './resolve-printer-binding.service.js';

/**
 * DynamicPrintRequest is the transport-neutral input for the dynamic print
 * flow. The printer is resolved from (code_template + code_profile); an
 * explicit printer_code is honoured when provided (skips binding resolution).
 */
export interface DynamicPrintRequest {
  request_id: string;
  source_system: string;
  source_reference?: string;
  code_template: string;
  code_profile: string;
  printer_code?: string;
  payload?: Record<string, unknown>;
  copies?: number;
  priority?: JobPriority;
  metadata?: Record<string, unknown>;
}

/**
 * DynamicPrintService is the single entry point shared by the dynamic HTTP
 * endpoint and the NATS print-intake consumer. Both resolve the printer the
 * same way and funnel into AcceptExternalJobService so idempotency, trace, and
 * audit are identical regardless of transport.
 */
export class DynamicPrintService {
  constructor(
    private readonly resolver: ResolvePrinterBindingService,
    private readonly acceptExternalJob: AcceptExternalJobService,
    private readonly intakeLog?: IntakeAttemptRepositoryPort,
  ) {}

  /**
   * @param opts.allowedPrinterCodes when non-empty, the RESOLVED printer must be
   *   in this allowlist or a 403 is thrown. Pass the service account's list on
   *   authenticated transports (HTTP); omit on trusted internal transports.
   * @param opts.source which transport this call came in on ('nats' or 'api'),
   *   used only to label the intake-attempt log; defaults to 'api'.
   */
  async submit(
    req: DynamicPrintRequest,
    actorId: string,
    opts?: { allowedPrinterCodes?: string[]; source?: IntakeSource },
  ): Promise<ExternalPrintJobResponse> {
    const source: IntakeSource = opts?.source ?? 'api';
    const reject = (reason: string, error: AppError): never => {
      void this.intakeLog?.record({
        source,
        outcome: 'rejected',
        reason,
        requestId: req.request_id,
        sourceSystem: req.source_system,
        sourceReference: req.source_reference,
        codeTemplate: req.code_template,
        codeProfile: req.code_profile,
        printerCode: req.printer_code,
      });
      throw error;
    };

    if (!req.request_id) {
      reject('request_id is required', new ValidationError('request_id is required'));
    }
    if (!req.source_system) {
      reject('source_system is required', new ValidationError('source_system is required'));
    }

    let printerCode = req.printer_code?.trim();
    if (!printerCode) {
      try {
        const resolved = await this.resolver.resolve(req.code_template, req.code_profile);
        printerCode = resolved.printerCode;
      } catch (err) {
        void this.intakeLog?.record({
          source,
          outcome: 'rejected',
          reason: err instanceof Error ? err.message : String(err),
          requestId: req.request_id,
          sourceSystem: req.source_system,
          sourceReference: req.source_reference,
          codeTemplate: req.code_template,
          codeProfile: req.code_profile,
        });
        throw err;
      }
    }

    // Enforce the service-account printer allowlist against the RESOLVED printer.
    // Without this a caller restricted to one printer could reach any printer by
    // omitting printer_code and sending a template/profile that binds elsewhere.
    const allowed = opts?.allowedPrinterCodes;
    if (allowed && allowed.length > 0 && !allowed.includes(printerCode)) {
      const reason = `printer_code '${printerCode}' not allowed for this service account`;
      reject(reason, new AppError('FORBIDDEN', reason, 403));
    }

    return this.acceptExternalJob.execute(
      {
        request_id: req.request_id,
        source_system: req.source_system,
        source_reference: req.source_reference,
        printer_code: printerCode,
        template_code: req.code_template,
        payload: req.payload ?? {},
        copies: req.copies,
        priority: req.priority,
        metadata: {
          ...(req.metadata ?? {}),
          code_profile: req.code_profile,
        },
      },
      actorId,
      source,
    );
  }
}
