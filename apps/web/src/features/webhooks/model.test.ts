import { describe, expect, it } from 'vitest';
import {
  EMPTY_WEBHOOK_FORM,
  buildImportCandidates,
  callbackTestPayload,
  clampPage,
  filterCallbackLog,
  filterEndpoints,
  genericIntakePayload,
  parsePayloadTemplate,
  validateWebhookForm,
} from './model.js';
import type { CallbackAttempt, Endpoint, Policy, WebhookEditorForm } from './types.js';

const policy: Policy = { id: 'policy-1', policyCode: 'LABEL', name: 'Label route' };

function validForm(patch: Partial<WebhookEditorForm> = {}): WebhookEditorForm {
  return {
    ...EMPTY_WEBHOOK_FORM,
    endpointCode: 'integration-labels',
    name: 'Integration labels',
    routePolicyId: policy.id,
    ...patch,
  };
}

function endpoint(patch: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'endpoint-1',
    endpointCode: 'labels',
    name: 'Label intake',
    sourceSystem: 'integration-service',
    authMode: 'API_KEY',
    enabled: true,
    routePolicyId: policy.id,
    callbackTransport: 'NONE',
    callbackOnPrintResult: false,
    ...patch,
  };
}

describe('webhook endpoint validation', () => {
  it('requires an endpoint code and rejects unsafe characters', () => {
    expect(validateWebhookForm(validForm({ endpointCode: '' }), [policy], false).endpointCode)
      .toBe('page.webhooks.validationEndpointCodeRequired');
    expect(validateWebhookForm(validForm({ endpointCode: 'bad code!' }), [policy], false).endpointCode)
      .toBe('page.webhooks.validationEndpointCodeFormat');
    expect(validateWebhookForm(validForm(), [policy], false).endpointCode).toBeUndefined();
  });

  it('requires a valid HTTP target only for HTTP-capable transports', () => {
    expect(validateWebhookForm(validForm({ callbackTransport: 'HTTP', callbackUrl: '' }), [policy], false).callbackUrl)
      .toBe('page.webhooks.validationHttpRequired');
    expect(validateWebhookForm(validForm({ callbackTransport: 'BOTH', callbackUrl: 'ftp://example.test' }), [policy], false).callbackUrl)
      .toBe('page.webhooks.validationHttpUrl');
    expect(validateWebhookForm(validForm({ callbackTransport: 'NATS' }), [policy], false).callbackUrl)
      .toBeUndefined();
  });

  it('requires a valid NATS subject only for NATS-capable transports', () => {
    expect(validateWebhookForm(validForm({ callbackTransport: 'NATS', callbackNatsSubject: '' }), [policy], false).callbackNatsSubject)
      .toBe('page.webhooks.validationNatsRequired');
    expect(validateWebhookForm(validForm({ callbackTransport: 'BOTH', callbackNatsSubject: 'bad subject' }), [policy], false).callbackNatsSubject)
      .toBe('page.webhooks.validationNatsSubject');
    expect(validateWebhookForm(validForm({ callbackTransport: 'HTTP', callbackUrl: 'https://example.test/callback' }), [policy], false).callbackNatsSubject)
      .toBeUndefined();
  });

  it('does not misrepresent a policy load failure as an empty selection', () => {
    expect(validateWebhookForm(validForm(), [], true).routePolicyId)
      .toBe('page.webhooks.validationPolicyUnavailable');
  });

  it('parses JSON objects and rejects malformed or array templates', () => {
    expect(parsePayloadTemplate('{"event":"$.event"}').value).toEqual({ event: '$.event' });
    expect(parsePayloadTemplate('[1,2,3]').error).toBe('page.webhooks.validationJsonObject');
    expect(parsePayloadTemplate('{bad').error).toContain('page.webhooks.validationJsonParse');
  });
});

describe('webhook endpoint filtering and pagination', () => {
  const rows = [
    endpoint(),
    endpoint({ id: 'endpoint-2', endpointCode: 'draft', name: 'Draft intake', enabled: false }),
    endpoint({ id: 'endpoint-3', endpointCode: 'plain', name: 'No callback', callbackTransport: 'NONE' }),
    endpoint({ id: 'endpoint-4', endpointCode: 'http', name: 'HTTP callback', callbackTransport: 'HTTP' }),
  ];

  it('uses one canonical status filter and searches identity fields', () => {
    expect(filterEndpoints(rows, '', 'draft').map((row) => row.endpointCode)).toEqual(['draft']);
    expect(filterEndpoints(rows, '', 'no_callback').map((row) => row.endpointCode)).toEqual(['labels', 'draft', 'plain']);
    expect(filterEndpoints(rows, 'http callback', 'all').map((row) => row.endpointCode)).toEqual(['http']);
  });

  it('clamps pages after filters or deletions reduce the result set', () => {
    expect(clampPage(9, 12, 10)).toBe(2);
    expect(clampPage(0, 0, 10)).toBe(1);
  });
});

describe('webhook import and callback evidence', () => {
  it('marks new, existing, and invalid import records independently', () => {
    const candidates = buildImportCandidates([
      { endpointCode: 'new-endpoint', name: 'New' },
      { endpointCode: 'labels', name: 'Existing' },
      { endpointCode: 'bad endpoint', name: '' },
    ], [endpoint()]);
    expect(candidates.map((candidate) => candidate.status)).toEqual(['new', 'existing', 'invalid']);
    expect(candidates[2]?.errors).toHaveLength(2);
  });

  it('filters delivery history without coupling it to endpoint loading', () => {
    const attempts: CallbackAttempt[] = [
      {
        id: 'a', endpointId: 'endpoint-1', endpointCode: 'labels', transport: 'HTTP', target: 'https://example.test',
        outcome: 'success', durationMs: 20, trigger: 'live', occurredAt: '2026-08-02T00:00:00Z',
      },
      {
        id: 'b', endpointId: 'endpoint-2', endpointCode: 'draft', transport: 'NATS', target: 'print.result',
        outcome: 'failed', errorMessage: 'no responder', durationMs: 30, trigger: 'test', occurredAt: '2026-08-02T00:01:00Z',
      },
    ];
    expect(filterCallbackLog(attempts, { failedOnly: true, transport: 'all', endpointId: '', trigger: 'all' }))
      .toEqual([attempts[1]]);
    expect(filterCallbackLog(attempts, { failedOnly: false, transport: 'NATS', endpointId: '', trigger: 'test' }))
      .toEqual([attempts[1]]);
  });

  it('uses generic integration guidance and a real terminal status', () => {
    expect(genericIntakePayload()).toEqual({
      request_id: 'REQ-1001',
      document_ref: 'DOC-1001',
      label_text: 'Sample label',
      barcode: 'ABC123',
    });
    expect(JSON.stringify(genericIntakePayload())).not.toMatch(/patient|medication|\bhn\b/i);
    expect(callbackTestPayload()).toMatchObject({ samplePayload: { status: 'SUCCESS' } });
  });
});
