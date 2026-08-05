export type TemplateEngine =
  | 'RAW_TEXT'
  | 'ZPL'
  | 'TSPL'
  | 'EPL'
  | 'HTML'
  | 'PDF_LIKE_PREVIEW'
  | 'JSON_LAYOUT';

export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'DISABLED' | 'ARCHIVED';
export type Orientation = 'portrait' | 'landscape';
export type PaperUnit = 'mm' | 'inch';
export type WebhookAuthMode = 'NONE' | 'API_KEY';

export interface PrintTemplate {
  id: string;
  templateCode: string;
  name: string;
  description?: string;
  engine: TemplateEngine;
  content: string;
  version: number;
  status: TemplateStatus;
  paperProfileId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePrintTemplateInput = Omit<
  PrintTemplate,
  'id' | 'version' | 'status' | 'createdAt' | 'updatedAt' | 'updatedBy'
> & {
  status?: TemplateStatus;
  version?: number;
  updatedBy?: string;
};

export type PaperProfileFieldType = 'text' | 'barcode' | 'qrcode' | 'date' | 'number';

/** 1D symbologies supported for a 'barcode' field. Ignored for 'qrcode' fields
 * (QR is always its own symbology). Defaults to 'code128' when unset. */
export type BarcodeSymbology = 'code128' | 'code39' | 'ean13' | 'datamatrix';

/**
 * A named print position on a paper profile — set up visually in the paper
 * profile editor, referenced as {{key}} by the profile's companion template.
 */
export interface PaperProfileField {
  id: string;
  key: string;
  label: string;
  defaultValue: string;
  type: PaperProfileFieldType;
  /** Only meaningful when type === 'barcode'. */
  barcodeSymbology?: BarcodeSymbology;
  /** Only meaningful when type === 'barcode'. Bar height in mm. Defaults to 12mm when unset. */
  barcodeHeightMm?: number;
  /** Only meaningful when type === 'qrcode'. Side length in mm. Defaults to 20mm when unset. */
  qrSizeMm?: number;
  xMm: number;
  yMm: number;
  fontSize: number;
  bold: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
}

export interface PaperProfile {
  id: string;
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  dpi: number;
  orientation: Orientation;
  unit: PaperUnit;
  fields: PaperProfileField[];
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePaperProfileInput = Omit<PaperProfile, 'id' | 'createdAt' | 'updatedAt' | 'fields'> & {
  fields?: PaperProfileField[];
};

export interface PrinterTemplateBinding {
  id: string;
  printerCode: string;
  templateCode: string;
  paperProfileId: string;
  isDefault: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePrinterTemplateBindingInput = Omit<PrinterTemplateBinding, 'id' | 'createdAt' | 'updatedAt'>;

export interface MatchRule {
  field: string;
  op: 'eq';
  value: string | number | boolean;
}

export interface WebhookRoutePolicy {
  id: string;
  policyCode: string;
  name: string;
  matchRules: { when: MatchRule[] };
  printerMapping: Record<string, unknown>;
  templateMapping: Record<string, unknown>;
  payloadMapping: Record<string, string>;
  priorityMapping?: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateWebhookRoutePolicyInput = Omit<WebhookRoutePolicy, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * The fields PrintOps itself contributes to an acceptance callback — the shape
 * of the intake response, which is the only `result` ever handed to a
 * templatable callback. A `callbackPayloadTemplate` reaches these with the
 * `$$.field` namespace; `$.field` stays reserved for the caller's own intake
 * payload. Terminal result callbacks resolve the same template against the v2
 * envelope (so `$$.status` carries the real final status).
 *
 * Shared so the API resolves and the Webhooks page offers exactly the same
 * seven keys — a UI that advertises a field the resolver cannot supply is how
 * the fabricated `$.event` / `$.printerId` list happened in the first place.
 */
export const ACCEPTANCE_CALLBACK_SYSTEM_FIELDS = [
  'print_job_id',
  'job_id',
  'request_id',
  'trace_id',
  'source_system',
  'created_at',
  'queued_at',
  'resolved_printer_code',
  'resolved_template_code',
  'status',
  'duplicate',
] as const;

export type AcceptanceCallbackSystemField = (typeof ACCEPTANCE_CALLBACK_SYSTEM_FIELDS)[number];

/**
 * Every key of the unified v2 callback envelope (see
 * apps/api/src/services/callback-payload.ts). These are the keys a receiver
 * sees in ANY status; the acceptance-template resolver can supply them all,
 * including the ones that are not direct intake-response fields
 * (`event_type`, `occurred_at`, `timeline.*`, `delivery.*`, …).
 *
 * Shared so the Webhooks page offers the complete v2 vocabulary as
 * `$$.field` tokens instead of only the raw intake-response subset.
 */
export const CALLBACK_ENVELOPE_SYSTEM_FIELDS = [
  'version',
  'event_type',
  'occurred_at',
  'request_id',
  'job_id',
  'source_system',
  'status',
  'data_quality',
  'missing_fields',
  'render_warnings',
  'printer_code',
  'runner_id',
  'trace_id',
  'duplicate',
  'error',
  'timeline.accepted_at',
  'timeline.queued_at',
  'timeline.started_at',
  'timeline.terminal_at',
  'delivery.transports',
  'delivery.nats_mode',
] as const;

export type CallbackEnvelopeSystemField = (typeof CALLBACK_ENVELOPE_SYSTEM_FIELDS)[number];

export interface WebhookEndpoint {
  id: string;
  endpointCode: string;
  name: string;
  sourceSystem: string;
  authMode: WebhookAuthMode;
  apiKey?: string;
  enabled: boolean;
  routePolicyId: string;
  /**
   * How PrintOps notifies the caller after the job is created (and, optionally,
   * after the print result is known). Supports BOTH an HTTP callback (POST to a
   * URL) and a NATS reply on a subject — the same endpoint can fan out to
   * either or both transports independently.
   */
  callbackTransport?: 'NONE' | 'HTTP' | 'NATS' | 'BOTH';
  /** HTTP callback target. May be a literal URL or a `$.field` path into the intake payload (dynamic per request). */
  callbackUrl?: string;
  /** NATS reply subject template. May be a literal subject or a `$.field` path into the intake payload. */
  callbackNatsSubject?: string;
  /**
   * Optional JSON payload template sent to the ACCEPTANCE callback. Keys map to
   * literal values; `$.field` resolves from the ORIGINAL intake payload (so the
   * caller gets back what they sent) and `$$.field` resolves from the intake
   * response PrintOps produced (see ACCEPTANCE_CALLBACK_SYSTEM_FIELDS), so a
   * custom template can carry both instead of trading one for the other. When
   * empty, a default envelope `{ request_id, print_job_id, status, trace_id,
   * duplicate }` is used.
   */
  callbackPayloadTemplate?: Record<string, unknown>;
  /** Send the callback only after the print result (success/failure) is known, instead of immediately after job creation. Defaults to false. */
  callbackOnPrintResult?: boolean;
  /** Environment-backed secret reference. The secret itself is never stored. */
  callbackSigningSecretRef?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateWebhookEndpointInput = Omit<WebhookEndpoint, 'id' | 'createdAt' | 'updatedAt'>;

export interface TemplatePreview {
  templateCode: string;
  paperProfile: PaperProfile;
  samplePayload: Record<string, unknown>;
  renderedPreview: string;
  renderedPrintPayload: string;
  warnings: string[];
  renderTimeMs: number;
}
