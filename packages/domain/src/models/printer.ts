export type PrinterProtocol =
  | 'ipp'
  | 'snmp'
  | 'cups'
  | 'windows_spooler'
  | 'raw_tcp_9100'
  | 'fake';

export type PrinterStatusCode =
  | 'online'
  | 'offline'
  | 'error'
  | 'busy'
  | 'idle'
  | 'unknown';

export interface PrinterCapability {
  colorSupported: boolean;
  duplexSupported: boolean;
  maxPageWidth: number;
  maxPageHeight: number;
  supportedMediaTypes: string[];
  supportedResolutions: string[];
  maxCopies: number;
}

export interface PrinterStatus {
  printerId: string;
  code: PrinterStatusCode;
  message?: string;
  tonerLevels?: Record<string, number>;
  paperLevels?: Record<string, number>;
  checkedAt: Date;
}

export interface Printer {
  id: string;
  code: string;
  name: string;
  location?: string;
  protocol: PrinterProtocol;
  connectionUri: string;
  capabilities?: PrinterCapability;
  status?: PrinterStatus;
  allowedTemplates?: string[];
  maxCopiesPerJob?: number;
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrintCommand {
  jobId: string;
  printerId: string;
  traceId: string;
  connectionUri?: string;
  documentUrl?: string;
  documentBase64?: string;
  renderedPrintPayload?: string;
  mimeType: string;
  copies: number;
  duplex: boolean;
  colorMode: 'color' | 'monochrome' | 'auto';
  mediaType?: string;
  resolution?: string;
  metadata: Record<string, unknown>;
}

export type CreatePrinterInput = Omit<Printer, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'code' | 'isActive'> & {
  code?: string;
  isActive?: boolean;
};
