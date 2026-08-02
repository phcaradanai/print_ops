export type CallbackTransport = 'NONE' | 'HTTP' | 'NATS' | 'BOTH';
export type EndpointStatusFilter = 'all' | 'enabled' | 'draft' | 'no_callback';
export type WebhookView = 'endpoints' | 'editor' | 'history';
export type FeedbackTone = 'success' | 'error' | 'info' | 'warning';

export interface Endpoint {
  id: string;
  endpointCode: string;
  name: string;
  sourceSystem: string;
  authMode: string;
  enabled: boolean;
  routePolicyId: string;
  callbackTransport: CallbackTransport;
  callbackUrl?: string;
  callbackNatsSubject?: string;
  callbackPayloadTemplate?: Record<string, unknown>;
  callbackOnPrintResult: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface Policy {
  id: string;
  policyCode: string;
  name: string;
  payloadMapping?: Record<string, string>;
}

export interface CallbackTransportResult {
  attempted: boolean;
  success: boolean;
  target?: string;
  httpStatus?: number;
  error?: string;
  durationMs: number;
}

export interface CallbackTestResponse {
  ok: boolean;
  id: string;
  transport: string;
  delivery: { http?: CallbackTransportResult; nats?: CallbackTransportResult };
}

export interface CallbackAttempt {
  id: string;
  endpointId: string;
  endpointCode: string;
  transport: 'HTTP' | 'NATS';
  target: string;
  outcome: 'success' | 'failed' | 'skipped';
  httpStatus?: number;
  errorMessage?: string;
  durationMs: number;
  trigger: 'live' | 'test';
  occurredAt: string;
}

export interface WebhookEditorForm {
  endpointCode: string;
  name: string;
  sourceSystem: string;
  authMode: string;
  routePolicyId: string;
  callbackTransport: CallbackTransport;
  callbackUrl: string;
  callbackNatsSubject: string;
  callbackPayloadTemplate: string;
  callbackOnPrintResult: boolean;
}

export type WebhookField =
  | 'endpointCode'
  | 'name'
  | 'sourceSystem'
  | 'authMode'
  | 'routePolicyId'
  | 'callbackUrl'
  | 'callbackNatsSubject'
  | 'callbackPayloadTemplate';

export type WebhookValidationErrors = Partial<Record<WebhookField, string>>;

export interface FeedbackMessage {
  id: number;
  tone: FeedbackTone;
  text: string;
  persistent?: boolean;
  details?: string[];
  logEntryId?: string;
}

export interface ImportCandidate {
  endpoint: Partial<Endpoint>;
  endpointCode: string;
  status: 'new' | 'existing' | 'invalid';
  errors: string[];
}

export interface ImportFailure {
  endpointCode: string;
  reason: string;
}

export interface ImportResult {
  success: number;
  skipped: number;
  failed: ImportFailure[];
  total: number;
}

export interface BatchDeleteResult {
  deletedIds: string[];
  failed: Array<{ id: string; endpointCode: string; reason: string }>;
}

export interface CallbackLogFilters {
  failedOnly: boolean;
  transport: 'all' | 'HTTP' | 'NATS';
  endpointId: string;
  trigger: 'all' | 'live' | 'test';
}
