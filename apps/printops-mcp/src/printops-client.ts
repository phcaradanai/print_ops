import type { PrintOpsMcpConfig } from './config.js';

export type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PrinterSummary {
  id: string;
  code: string;
  name: string;
  location: string | null;
  protocol: string;
  isActive: boolean;
  allowedTemplates: string[];
  maxCopiesPerJob: number | null;
}

export interface SandboxBatchScenario {
  label: string;
  samplePayload: Record<string, string>;
  testPrint: {
    printerCode: string;
  };
}

export interface SandboxBatchRequest {
  templateCode: string;
  paperProfileId: string;
  scenarios: SandboxBatchScenario[];
}

export class PrintOpsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`PrintOps API ${status}: ${message}`);
    this.name = 'PrintOpsApiError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function errorMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    for (const key of ['message', 'error', 'detail']) {
      const candidate = body[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().slice(0, 500);
      }
    }
  }

  if (typeof body === 'string' && body.trim()) {
    return body.trim().slice(0, 500);
  }

  return fallback;
}

function extractList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!isRecord(body)) return [];
  for (const key of ['printers', 'data', 'items']) {
    if (Array.isArray(body[key])) return body[key];
  }
  return [];
}

function normalizePrinter(value: unknown): PrinterSummary | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const code = stringValue(value.code);
  const name = stringValue(value.name);
  const protocol = stringValue(value.protocol);
  if (!id || !code || !name || !protocol) return null;

  return {
    id,
    code,
    name,
    location: stringValue(value.location),
    protocol,
    isActive: booleanValue(value.isActive),
    allowedTemplates: arrayValue(value.allowedTemplates).filter(
      (template): template is string => typeof template === 'string',
    ),
    maxCopiesPerJob: numberValue(value.maxCopiesPerJob),
  };
}

export class PrintOpsApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImplementation;

  constructor(
    private readonly config: PrintOpsMcpConfig,
    fetchImpl: FetchImplementation = fetch,
  ) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  async listPrinters(): Promise<PrinterSummary[]> {
    const body = await this.request('/api/v1/printers', 'apiKey');
    return extractList(body)
      .map(normalizePrinter)
      .filter((printer): printer is PrinterSummary => printer !== null);
  }

  async getPrinterStatus(printerId: string): Promise<unknown> {
    return this.request(`/api/v1/printers/${encodeURIComponent(printerId)}/status`, 'apiKey');
  }

  async getPrintJob(jobId: string): Promise<unknown> {
    return this.request(`/api/v1/print-jobs/${encodeURIComponent(jobId)}`, 'apiKey');
  }

  async runSandboxBatch(request: SandboxBatchRequest): Promise<unknown> {
    return this.request('/api/v1/sandbox/run-batch', 'jwt', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  private async request(
    path: string,
    auth: 'apiKey' | 'jwt',
    init: RequestInit = {},
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    if (auth === 'apiKey') {
      if (!this.config.apiKey) {
        throw new Error(
          'PRINTOPS_API_KEY is not configured; read-only printer and job tools are unavailable',
        );
      }
      headers.set('x-api-key', this.config.apiKey);
    } else {
      if (!this.config.jwt) {
        throw new Error(
          'PRINTOPS_JWT is not configured; the consolidated sandbox batch cannot be submitted',
        );
      }
      headers.set('authorization', `Bearer ${this.config.jwt}`);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network request failed';
      throw new Error(`PrintOps API connection failed: ${message.slice(0, 300)}`);
    }

    const text = await response.text();
    let body: unknown = undefined;
    if (text.trim()) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      throw new PrintOpsApiError(response.status, errorMessage(body, response.statusText));
    }

    return body;
  }
}
