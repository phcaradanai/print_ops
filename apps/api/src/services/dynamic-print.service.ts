import type { JobPriority } from '@printerops/domain';
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
  ) {}

  /**
   * @param opts.allowedPrinterCodes when non-empty, the RESOLVED printer must be
   *   in this allowlist or a 403 is thrown. Pass the service account's list on
   *   authenticated transports (HTTP); omit on trusted internal transports.
   */
  async submit(
    req: DynamicPrintRequest,
    actorId: string,
    opts?: { allowedPrinterCodes?: string[] },
  ): Promise<ExternalPrintJobResponse> {
    if (!req.request_id) throw new ValidationError('request_id is required');
    if (!req.source_system) throw new ValidationError('source_system is required');

    let printerCode = req.printer_code?.trim();
    if (!printerCode) {
      const resolved = await this.resolver.resolve(req.code_template, req.code_profile);
      printerCode = resolved.printerCode;
    }

    // Enforce the service-account printer allowlist against the RESOLVED printer.
    // Without this a caller restricted to one printer could reach any printer by
    // omitting printer_code and sending a template/profile that binds elsewhere.
    const allowed = opts?.allowedPrinterCodes;
    if (allowed && allowed.length > 0 && !allowed.includes(printerCode)) {
      throw new AppError('FORBIDDEN', `printer_code '${printerCode}' not allowed for this service account`, 403);
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
    );
  }
}
