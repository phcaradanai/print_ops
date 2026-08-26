import type {
  JobPriority,
  IntakeAttemptRepositoryPort,
  IntakeSource,
  PrintTemplateRepositoryPort,
  WebhookEndpointRepositoryPort,
} from '@printerops/domain';
import { CALLBACK_INTENT_METADATA_KEY } from '@printerops/domain';
import { AppError, ValidationError } from '@printerops/shared';
import type { WebhookEndpoint } from '@printerops/domain';
import type { AcceptExternalJobService, ExternalPrintJobResponse } from './accept-external-job.service.js';
import type { ResolvePrinterBindingService } from './resolve-printer-binding.service.js';
import {
  resolveCallbackEndpoint,
  wantsAcceptanceCallback,
  type ResolvedCallbackEndpoint,
} from './callback-intent.service.js';
import type { WebhookCallbackService, WebhookCallbackLogger } from './webhook-callback.service.js';

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
  rotate?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
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
  private callbacks: WebhookCallbackService | undefined;
  private callbackLogger: WebhookCallbackLogger = {
    info: (obj, msg) => console.info(msg, obj),
    warn: (obj, msg) => console.warn(msg, obj),
    error: (obj, msg) => console.error(msg, obj),
  };

  constructor(
    private readonly resolver: ResolvePrinterBindingService,
    private readonly acceptExternalJob: AcceptExternalJobService,
    private readonly intakeLog?: IntakeAttemptRepositoryPort,
    private readonly endpoints?: WebhookEndpointRepositoryPort,
    private readonly templates?: PrintTemplateRepositoryPort,
    callbacks?: WebhookCallbackService,
    callbackLogger?: WebhookCallbackLogger,
  ) {
    this.callbacks = callbacks;
    if (callbackLogger) this.callbackLogger = callbackLogger;
  }

  /** Late-bind the callback service once the NATS publisher exists, mirroring
   *  DynamicIntakeService — the consumer that needs it starts after the HTTP
   *  wiring that creates it. */
  setCallbackService(service: WebhookCallbackService): void {
    this.callbacks = service;
  }

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

    const resolvedEndpoint = await this.resolveCallbackEndpoint(req, reject);

    const response = await this.acceptExternalJob.execute(
      {
        request_id: req.request_id,
        source_system: req.source_system,
        source_reference: req.source_reference,
        printer_code: printerCode,
        template_code: req.code_template,
        payload: req.payload ?? {},
        copies: req.copies,
        priority: req.priority,
        rotate: req.rotate,
        flipHorizontal: req.flipHorizontal,
        flipVertical: req.flipVertical,
        endpoint_code: req.endpoint_code,
        metadata: {
          ...(req.metadata ?? {}),
          code_profile: req.code_profile,
          ...(resolvedEndpoint ? { [CALLBACK_INTENT_METADATA_KEY]: resolvedEndpoint.intent } : {}),
        },
      },
      actorId,
      source,
    );

    // Until now `endpoint_code` on this path bought a terminal callback and
    // nothing else: NATS-submitted and /printer/:template/:profile jobs could
    // never receive an acceptance notification at all, whatever the endpoint
    // was configured for.
    if (resolvedEndpoint) {
      this.fireAcceptanceCallback(resolvedEndpoint.endpoint, req, printerCode, response);
    }

    return response;
  }

  /**
   * Fires the ACCEPTANCE notification for a job submitted through this path.
   *
   * Gating comes from the shared helper, deliberately: this entry point must
   * not develop its own reading of `callbackOnPrintResult`.
   */
  private fireAcceptanceCallback(
    endpoint: WebhookEndpoint,
    req: DynamicPrintRequest,
    printerCode: string,
    response: ExternalPrintJobResponse,
  ): void {
    if (!this.callbacks) return;
    if (!wantsAcceptanceCallback(endpoint, response.duplicate)) return;

    // Built here rather than reusing ExternalPrintJobResponse, which carries
    // neither resolved_printer_code nor resolved_template_code. `$$.field` must
    // mean the same thing regardless of which entry point the traffic came
    // through, and that public response shape is returned to HTTP callers of
    // /print-jobs and /printer/:tpl/:profile — widening it is a separate change.
    const result: Record<string, unknown> = {
      accepted: true,
      print_job_id: response.print_job_id,
      job_id: response.print_job_id,
      request_id: response.request_id,
      trace_id: response.trace_id,
      source_system: req.source_system,
      created_at: response.accepted_at?.toISOString() ?? null,
      // The job is queued the moment it is accepted — report the same instant
      // the terminal callback reports (job.queuedAt), so a template resolving
      // $$.queued_at / $$.occurred_at sees ONE consistent value across rounds.
      queued_at: response.queued_at?.toISOString() ?? null,
      resolved_printer_code: printerCode,
      resolved_template_code: req.code_template,
      status: response.status,
      duplicate: response.duplicate,
    };

    void this.callbacks
      .send({ endpoint, intakePayload: req.payload ?? {}, result })
      .catch((err: unknown) => {
        this.callbackLogger.error(
          { endpointId: endpoint.id, error: err instanceof Error ? err.message : String(err) },
          'acceptance callback send failed',
        );
      });
  }

  /**
   * Resolve `endpoint_code` into the validated endpoint plus the immutable
   * callback intent stored with the job, logging the rejection to the intake
   * log so an operator can see WHY a NATS message was dead-lettered rather
   * than printed.
   */
  private async resolveCallbackEndpoint(
    req: DynamicPrintRequest,
    reject: (reason: string, error: AppError) => never,
  ): Promise<ResolvedCallbackEndpoint | undefined> {
    try {
      return await resolveCallbackEndpoint(
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
