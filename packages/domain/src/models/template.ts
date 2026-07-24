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
   * Optional JSON payload template sent to the callback. Keys map to literal
   * values, `$.field` references resolve from the ORIGINAL intake payload
   * (so the caller gets back what they sent). When empty, a default envelope
   * `{ request_id, print_job_id, status, trace_id, duplicate }` is used.
   */
  callbackPayloadTemplate?: Record<string, unknown>;
  /** Send the callback only after the print result (success/failure) is known, instead of immediately after job creation. Defaults to false. */
  callbackOnPrintResult?: boolean;
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
