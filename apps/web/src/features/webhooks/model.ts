import { DEFAULT_CALLBACK_TEMPLATE } from './callbackTemplate.js';
import type {
  CallbackAttempt,
  CallbackLogFilters,
  CallbackTransportResult,
  Endpoint,
  EndpointStatusFilter,
  ImportCandidate,
  Policy,
  WebhookEditorForm,
  WebhookValidationErrors,
} from './types.js';

export const SOURCE_SYSTEM_PRESETS = [
  'integration-service',
  'integration-bridge',
  'print-orchestrator',
  'erp-connector',
  'document-service',
] as const;

export const EMPTY_WEBHOOK_FORM: WebhookEditorForm = {
  endpointCode: '',
  name: '',
  sourceSystem: 'integration-service',
  authMode: 'NONE',
  routePolicyId: '',
  callbackTransport: 'NONE',
  callbackUrl: '',
  callbackNatsSubject: '',
  callbackPayloadTemplate: DEFAULT_CALLBACK_TEMPLATE,
  callbackOnPrintResult: false,
};

const ENDPOINT_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/i;
const NATS_TOKEN_PATTERN = /^[A-Za-z0-9_*>-]+(?:\.[A-Za-z0-9_*>-]+)*$/;

export function endpointToForm(endpoint: Endpoint): WebhookEditorForm {
  return {
    endpointCode: endpoint.endpointCode,
    name: endpoint.name,
    sourceSystem: endpoint.sourceSystem || 'integration-service',
    authMode: endpoint.authMode || 'NONE',
    routePolicyId: endpoint.routePolicyId || '',
    callbackTransport: endpoint.callbackTransport || 'NONE',
    callbackUrl: endpoint.callbackUrl ?? '',
    callbackNatsSubject: endpoint.callbackNatsSubject ?? '',
    callbackPayloadTemplate: endpoint.callbackPayloadTemplate
      ? JSON.stringify(endpoint.callbackPayloadTemplate, null, 2)
      : DEFAULT_CALLBACK_TEMPLATE,
    callbackOnPrintResult: Boolean(endpoint.callbackOnPrintResult),
  };
}

export function parsePayloadTemplate(value: string): {
  value?: Record<string, unknown>;
  error?: string;
} {
  if (!value.trim()) return { value: undefined };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'page.webhooks.validationJsonObject' };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      error: error instanceof Error
        ? `page.webhooks.validationJsonParse|${error.message}`
        : 'page.webhooks.validationJsonParse',
    };
  }
}

export function validateWebhookForm(
  form: WebhookEditorForm,
  policies: Policy[],
  policyLoadFailed: boolean,
): WebhookValidationErrors {
  const errors: WebhookValidationErrors = {};

  if (!form.endpointCode.trim()) {
    errors.endpointCode = 'page.webhooks.validationEndpointCodeRequired';
  } else if (!ENDPOINT_CODE_PATTERN.test(form.endpointCode.trim())) {
    errors.endpointCode = 'page.webhooks.validationEndpointCodeFormat';
  }

  if (!form.name.trim()) errors.name = 'page.webhooks.validationNameRequired';
  if (!form.sourceSystem.trim()) errors.sourceSystem = 'page.webhooks.validationSourceRequired';
  if (!['NONE', 'API_KEY'].includes(form.authMode)) {
    errors.authMode = 'page.webhooks.validationAuthMode';
  }

  if (policyLoadFailed) {
    errors.routePolicyId = 'page.webhooks.validationPolicyUnavailable';
  } else if (!form.routePolicyId) {
    errors.routePolicyId = 'page.webhooks.validationPolicyRequired';
  } else if (!policies.some((policy) => policy.id === form.routePolicyId)) {
    errors.routePolicyId = 'page.webhooks.validationPolicyUnknown';
  }

  if (form.callbackTransport === 'HTTP' || form.callbackTransport === 'BOTH') {
    if (!form.callbackUrl.trim()) {
      errors.callbackUrl = 'page.webhooks.validationHttpRequired';
    } else {
      try {
        const url = new URL(form.callbackUrl.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          errors.callbackUrl = 'page.webhooks.validationHttpUrl';
        }
      } catch {
        errors.callbackUrl = 'page.webhooks.validationHttpUrl';
      }
    }
  }

  if (form.callbackTransport === 'NATS' || form.callbackTransport === 'BOTH') {
    if (!form.callbackNatsSubject.trim()) {
      errors.callbackNatsSubject = 'page.webhooks.validationNatsRequired';
    } else if (!NATS_TOKEN_PATTERN.test(form.callbackNatsSubject.trim())) {
      errors.callbackNatsSubject = 'page.webhooks.validationNatsSubject';
    }
  }

  const payload = parsePayloadTemplate(form.callbackPayloadTemplate);
  if (payload.error) errors.callbackPayloadTemplate = payload.error;

  return errors;
}

export function buildEndpointPayload(
  form: WebhookEditorForm,
  enabled: boolean,
): Record<string, unknown> {
  const parsed = parsePayloadTemplate(form.callbackPayloadTemplate);
  return {
    endpointCode: form.endpointCode.trim(),
    name: form.name.trim(),
    sourceSystem: form.sourceSystem.trim() || 'integration-service',
    authMode: form.authMode,
    routePolicyId: form.routePolicyId,
    enabled,
    callbackTransport: form.callbackTransport,
    callbackUrl:
      form.callbackTransport === 'HTTP' || form.callbackTransport === 'BOTH'
        ? form.callbackUrl.trim()
        : undefined,
    callbackNatsSubject:
      form.callbackTransport === 'NATS' || form.callbackTransport === 'BOTH'
        ? form.callbackNatsSubject.trim()
        : undefined,
    callbackPayloadTemplate: parsed.value,
    callbackOnPrintResult: form.callbackOnPrintResult,
  };
}

export function filterEndpoints(
  endpoints: Endpoint[],
  query: string,
  status: EndpointStatusFilter,
): Endpoint[] {
  const normalized = query.trim().toLocaleLowerCase();
  return endpoints.filter((endpoint) => {
    if (status === 'enabled' && !endpoint.enabled) return false;
    if (status === 'draft' && endpoint.enabled) return false;
    if (status === 'no_callback' && endpoint.callbackTransport !== 'NONE') return false;
    if (!normalized) return true;
    return [endpoint.endpointCode, endpoint.name, endpoint.sourceSystem]
      .some((value) => (value ?? '').toLocaleLowerCase().includes(normalized));
  });
}

export function clampPage(page: number, totalItems: number, pageSize: number): number {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return Math.min(Math.max(1, page), totalPages);
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = clampPage(page, items.length, pageSize);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function formatWebhookDate(value: string | Date | undefined, locale: 'en' | 'th'): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function callbackTestPayload(): Record<string, unknown> {
  return {
    samplePayload: {
      event: 'PRINT_RESULT',
      request_id: 'REQ-1001',
      document_ref: 'DOC-1001',
      printer_id: 'PRN-001',
      job_id: 'JOB-1001',
      status: 'SUCCESS',
      occurred_at: new Date().toISOString(),
    },
  };
}

export function describeTransportResult(
  label: string,
  result: CallbackTransportResult | undefined,
  translate: (key: string) => string,
): string | null {
  if (!result) return null;
  if (!result.attempted) {
    return `${label}: ${translate('page.webhooks.outcomeSkipped')}${result.error ? ` — ${result.error}` : ''}`;
  }
  if (result.success) {
    const status = result.httpStatus ? ` ${result.httpStatus}` : '';
    return `${label}: ${translate('page.webhooks.deliveryDelivered')} (${status.trim() || translate('page.webhooks.outcomeSuccess')}, ${result.durationMs} ms)`;
  }
  const status = result.httpStatus ? ` (${result.httpStatus})` : '';
  return `${label}: ${translate('page.webhooks.outcomeFailed')}${status}${result.error ? ` — ${result.error}` : ''}`;
}

export function buildImportCandidates(
  items: Partial<Endpoint>[],
  existing: Endpoint[],
): ImportCandidate[] {
  return items.map((endpoint) => {
    const endpointCode = typeof endpoint.endpointCode === 'string' ? endpoint.endpointCode.trim() : '';
    const errors: string[] = [];
    if (!endpointCode) errors.push('page.webhooks.validationEndpointCodeRequired');
    else if (!ENDPOINT_CODE_PATTERN.test(endpointCode)) errors.push('page.webhooks.validationEndpointCodeFormat');
    if (!endpoint.name || !String(endpoint.name).trim()) errors.push('page.webhooks.validationNameRequired');
    const status: ImportCandidate['status'] = errors.length > 0
      ? 'invalid'
      : existing.some((item) => item.endpointCode === endpointCode)
        ? 'existing'
        : 'new';
    return { endpoint, endpointCode: endpointCode || '—', status, errors };
  });
}

export function filterCallbackLog(
  attempts: CallbackAttempt[],
  filters: CallbackLogFilters,
): CallbackAttempt[] {
  return attempts.filter((attempt) => {
    if (filters.failedOnly && attempt.outcome === 'success') return false;
    if (filters.transport !== 'all' && attempt.transport !== filters.transport) return false;
    if (filters.endpointId && attempt.endpointId !== filters.endpointId) return false;
    if (filters.trigger !== 'all' && attempt.trigger !== filters.trigger) return false;
    return true;
  });
}

export function genericIntakePayload(): Record<string, string> {
  return {
    request_id: 'REQ-1001',
    document_ref: 'DOC-1001',
    label_text: 'Sample label',
    barcode: 'ABC123',
  };
}

export function intakeUrl(origin: string, endpointCode: string): string {
  return `${origin}/v1/intake/${endpointCode}`;
}

export function curlExample(origin: string, endpointCode: string): string {
  const url = intakeUrl(origin, endpointCode);
  return `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(genericIntakePayload(), null, 2)}'`;
}
