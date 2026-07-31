import type { WebhookEndpointRepositoryPort } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import type { WebhookCallbackService } from './webhook-callback.service.js';
import { findDefaultCallbackEndpoint } from './callback-intent.service.js';

export interface IntakeRejectedOutcome {
  endpointCode?: string;
  sourceSystem?: string;
  requestId?: string;
  sourceReference?: string;
  intakeTransport: 'API' | 'NATS';
  stage: string;
  errorCode: string;
  errorMessage: string;
  intakePayload: Record<string, unknown>;
}

/**
 * Sends the final outcome for an identifiable command that failed before a
 * print job could be created. Accepted jobs use the durable terminal callback
 * dispatcher instead, so one command produces one final outcome notification.
 */
export class IntakeOutcomeCallbackService {
  constructor(
    private readonly endpoints: WebhookEndpointRepositoryPort,
    private readonly callbacks: WebhookCallbackService,
  ) {}

  async notifyRejected(outcome: IntakeRejectedOutcome): Promise<boolean> {
    if (!outcome.sourceSystem) return false;
    const endpointCode = outcome.endpointCode?.trim();
    const endpoint = endpointCode
      ? await this.endpoints.findByCode(endpointCode)
      : await findDefaultCallbackEndpoint(this.endpoints, outcome.sourceSystem);
    if (!endpoint || !endpoint.enabled || endpoint.sourceSystem !== outcome.sourceSystem) {
      return false;
    }
    if ((endpoint.callbackTransport ?? 'NONE') === 'NONE') return false;

    const payload = {
      version: 1,
      event_id: generateId(),
      event_type: 'print.job.rejected',
      occurred_at: new Date().toISOString(),
      request_id: outcome.requestId ?? null,
      job_id: null,
      source_system: outcome.sourceSystem,
      source_reference: outcome.sourceReference ?? null,
      print_status: 'REJECTED',
      intake_transport: outcome.intakeTransport,
      failure_stage: outcome.stage,
      error: {
        code: outcome.errorCode,
        message: outcome.errorMessage,
      },
    };

    await this.callbacks.send({
      endpoint,
      intakePayload: outcome.intakePayload,
      result: {
        request_id: outcome.requestId,
        status: 'REJECTED',
      },
      payloadOverride: payload,
    });
    return true;
  }
}
