import type {
  JobPriority,
  IntakeAttemptRepositoryPort,
  IntakeSource,
  JobCallbackIntent,
  PrintTemplateRepositoryPort,
  WebhookEndpointRepositoryPort,
} from '@printerops/domain';
import { CALLBACK_INTENT_METADATA_KEY } from '@printerops/domain';
import { AppError, ValidationError } from '@printerops/shared';
import type { AcceptExternalJobService, ExternalPrintJobResponse } from './accept-external-job.service.js';
import type { ResolvePrinterBindingService } from './resolve-printer-binding.service.js';
import { resolveEndpointCallbackIntent } from './callback-intent.service.js';

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
  /**
   * Optional reference to a WebhookEndpoint whose callback configuration should
   * receive this job's terminal print result.
   *
   * OPTIONAL on purpose — this is the backward-compatible extension point for
   * the NATS envelope and the dynamic HTTP body. Existing senders that do not
   * want callbacks omit it and are completely unaffected. Before this field the
   * NATS intake path carried no callback reference at all, so NATS-originated
   * prints could never report a result anywhere.
   */
  endpoint_code?: string;
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
    private readonly endpoints?: WebhookEndpointRepositoryPort,
    private readonly templates?: PrintTemplateRepositoryPort,
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

    // An explicitly supplied `printer_code` skips binding resolution, and with
    // it the only place `code_template` was ever checked — so a request naming
    // a template that does not exist printed anyway, unrendered. An explicitly
    // provided template that cannot be found is a client error, not something
    // to silently ignore: the caller asked for a specific document.
    if (req.code_template && this.templates) {
      const template = await this.templates.findByCode(req.code_template);
      if (!template || template.status !== 'PUBLISHED') {
        const reason = `template_code '${req.code_template}' does not exist or is not published`;
        reject(
          reason,
          new AppError('TEMPLATE_NOT_FOUND', 'The requested print template does not exist.', 422),
        );
      }
    }

    const callbackIntent = await this.resolveCallbackIntent(req, reject);

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
          ...(callbackIntent ? { [CALLBACK_INTENT_METADATA_KEY]: callbackIntent } : {}),
        },
      },
      actorId,
      source,
    );
  }

  /**
   * Resolve `endpoint_code` into the immutable callback intent stored with the
   * job, logging the rejection to the intake log so an operator can see WHY a
   * NATS message was dead-lettered rather than printed.
   */
  private async resolveCallbackIntent(
    req: DynamicPrintRequest,
    reject: (reason: string, error: AppError) => never,
  ): Promise<JobCallbackIntent | undefined> {
    try {
      return await resolveEndpointCallbackIntent(
        this.endpoints,
        req.endpoint_code,
        req.source_system,
        req.payload ?? {},
      );
    } catch (err) {
      if (err instanceof AppError) reject(err.message, err);
      throw err;
    }
  }
}
