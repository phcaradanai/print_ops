import { BarcodeSymbology } from '../../../lib/barcode.js';

export interface Template {
  id: string;
  templateCode: string;
  name: string;
  engine: string;
  status: string;
  version: number;
  content: string;
  paperProfileId?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaperProfileField {
  key: string;
  label?: string;
  defaultValue?: string;
  type?: 'text' | 'barcode' | 'qrcode' | 'date' | 'number';
  barcodeSymbology?: BarcodeSymbology;
  barcodeHeightMm?: number;
  qrSizeMm?: number;
}

export interface PaperProfileOption {
  id: string;
  code: string;
  name: string;
  /** Already present on every `/v1/paper-profiles` response; kept optional
   *  here since this DTO predates needing them, so older callers that build
   *  one by hand don't have to supply them. */
  widthMm?: number;
  heightMm?: number;
  marginTopMm?: number;
  marginRightMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  orientation?: 'portrait' | 'landscape';
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  fields: PaperProfileField[];
}

export interface PreviewResponse {
  renderedPreview: string;
  renderedPrintPayload: string;
  warnings: string[];
  renderTimeMs: number;
}

export type SampleMode = 'default' | 'profile' | 'empty';

export interface TemplateExportEntry {
  templateCode: string;
  name: string;
  engine: string;
  content: string;
  status?: string;
  paperProfileCode?: string;
}

export interface TemplateExportFile {
  kind: 'printops.templates';
  version: 1;
  exportedAt: string;
  templates: TemplateExportEntry[];
}
