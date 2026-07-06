export type PrinterProtocol = 'ipp' | 'snmp' | 'cups' | 'windows_spooler' | 'fake';

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
  name: string;
  location?: string;
  protocol: PrinterProtocol;
  connectionUri: string;
  capabilities?: PrinterCapability;
  status?: PrinterStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrintCommand {
  jobId: string;
  printerId: string;
  traceId: string;
  documentUrl?: string;
  documentBase64?: string;
  mimeType: string;
  copies: number;
  duplex: boolean;
  colorMode: 'color' | 'monochrome' | 'auto';
  mediaType?: string;
  resolution?: string;
  metadata: Record<string, unknown>;
}

export type CreatePrinterInput = Omit<Printer, 'id' | 'createdAt' | 'updatedAt' | 'status'>;
