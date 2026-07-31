import { describe, expect, it, vi } from 'vitest';
import { InMemoryWebhookEndpointRepository } from '../infra/repos/in-memory-webhook.repo.js';
import { IntakeOutcomeCallbackService } from '../services/intake-outcome-callback.service.js';
import { WebhookCallbackService } from '../services/webhook-callback.service.js';

const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe('IntakeOutcomeCallbackService', () => {
  it('publishes a canonical rejection to every configured transport', async () => {
    const endpoints = new InMemoryWebhookEndpointRepository();
    await endpoints.create({
      endpointCode: 'hook',
      name: 'Result hook',
      sourceSystem: 'medisync',
      authMode: 'NONE',
      enabled: true,
      routePolicyId: '',
      callbackTransport: 'BOTH',
      callbackUrl: 'https://receiver.example/results',
      callbackNatsSubject: 'results.status',
      callbackPayloadTemplate: { legacy: '$.label' },
      callbackOnPrintResult: true,
    });
    const http = vi.fn().mockResolvedValue(undefined);
    const nats = vi.fn();
    const service = new IntakeOutcomeCallbackService(
      endpoints,
      new WebhookCallbackService(logger, http, nats),
    );

    expect(await service.notifyRejected({
      endpointCode: 'hook',
      sourceSystem: 'medisync',
      requestId: 'REQ-1',
      intakeTransport: 'NATS',
      stage: 'VALIDATION',
      errorCode: 'TEMPLATE_NOT_FOUND',
      errorMessage: 'missing template',
      intakePayload: { label: 'patient label' },
    })).toBe(true);

    const expected = expect.objectContaining({
      event_type: 'print.job.rejected',
      request_id: 'REQ-1',
      print_status: 'REJECTED',
      failure_stage: 'VALIDATION',
      error: { code: 'TEMPLATE_NOT_FOUND', message: 'missing template' },
    });
    expect(http).toHaveBeenCalledWith('https://receiver.example/results', expected);
    expect(nats).toHaveBeenCalledWith('results.status', expected);
  });

  it('does not let one source trigger another source system callback', async () => {
    const endpoints = new InMemoryWebhookEndpointRepository();
    await endpoints.create({
      endpointCode: 'hook',
      name: 'Result hook',
      sourceSystem: 'owner-system',
      authMode: 'NONE',
      enabled: true,
      routePolicyId: '',
      callbackTransport: 'NATS',
      callbackNatsSubject: 'results.status',
      callbackOnPrintResult: true,
    });
    const nats = vi.fn();
    const service = new IntakeOutcomeCallbackService(
      endpoints,
      new WebhookCallbackService(logger, async () => {}, nats),
    );

    expect(await service.notifyRejected({
      endpointCode: 'hook',
      sourceSystem: 'attacker-system',
      requestId: 'REQ-X',
      intakeTransport: 'API',
      stage: 'VALIDATION',
      errorCode: 'FORBIDDEN',
      errorMessage: 'forbidden',
      intakePayload: {},
    })).toBe(false);
    expect(nats).not.toHaveBeenCalled();
  });
});
