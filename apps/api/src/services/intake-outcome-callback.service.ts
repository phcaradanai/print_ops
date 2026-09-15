import type { WebhookEndpointRepositoryPort } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import type { WebhookCallbackService } from './webhook-callback.service.js';
import { findDefaultCallbackEndpoint } from './callback-intent.service.js';
import { buildCallbackEnvelope } from './callback-payload.js';

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

    const payload = buildCallbackEnvelope({
      eventId: generateId(),
      eventType: 'print.job.rejected',
      occurredAt: new Date().toISOString(),
      requestId: outcome.requestId ?? null,
      jobId: null,
      sourceSystem: outcome.sourceSystem,
      status: 'REJECTED',
      error: {
        code: outcome.errorCode,
        message: outcome.errorMessage,
      },
      extra: {
        source_reference: outcome.sourceReference ?? null,
        intake_transport: outcome.intakeTransport,
        failure_stage: outcome.stage,
      },
    });

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
