export interface Endpoint {
  id: string;
  endpointCode: string;
  name: string;
  sourceSystem: string;
  authMode: string;
  enabled: boolean;
  routePolicyId: string;
  callbackTransport: 'NONE' | 'HTTP' | 'NATS' | 'BOTH';
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
