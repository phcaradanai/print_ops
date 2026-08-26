export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type PaperOrientation = 'portrait' | 'landscape';
export type DisplayUnit = 'mm' | 'cm' | 'px';
export type ImportPhase = 'select' | 'analyzing' | 'review' | 'importing' | 'success' | 'error';
export type ImportFitMode = 'contain' | 'cover' | 'stretch';
export type ImportFitModeLabel =
  | 'page.paperProfiles.importFitContain'
  | 'page.paperProfiles.importFitCover'
  | 'page.paperProfiles.importFitStretch';
export type DynamicFieldType = 'text' | 'barcode' | 'qrcode' | 'date' | 'number';
export type DynamicFieldBarcodeSymbology = 'code128' | 'code39' | 'ean13' | 'datamatrix';

export interface DynamicField {
  id: string;
  key: string;
  label: string;
  defaultValue: string;
  type: DynamicFieldType;
  barcodeSymbology?: DynamicFieldBarcodeSymbology;
  barcodeHeightMm?: number;
  qrSizeMm?: number;
  xMm: number;
  yMm: number;
  fontSize: number;
  bold: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
}

export interface PaperForm {
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  dpi: number;
  orientation: PaperOrientation;
  unit: 'mm' | 'inch';
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

export interface PaperProfile extends Omit<PaperForm, 'rotation' | 'flipHorizontal' | 'flipVertical'> {
  id: string;
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  fields: DynamicField[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PaperProfileUx {
  displayUnit: DisplayUnit;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontColor: string;
  bgColor: string;
  watermarkText: string;
  watermarkOpacity: number;
  dynamicFields: DynamicField[];
}

export interface VisualPaperGeometry {
  rotated: boolean;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  sourcePrintableWidthMm: number;
  sourcePrintableHeightMm: number;
  printableWidthMm: number;
  printableHeightMm: number;
}

export interface ImportAnalyzeResult {
  detectedMimeType: string;
  fileSizeBytes: number;
  sha256: string;
  pixelWidth: number;
  pixelHeight: number;
  detectedDpi: number | null;
  suggestedDpi: number;
  suggestedWidthMm: number;
  suggestedHeightMm: number;
  warnings: string[];
}

export interface ImportResult {
  profile: PaperProfile;
  artwork: { id: string; fitMode: ImportFitMode };
  duplicate: boolean;
}

export interface ArtworkData {
  dataBase64: string;
  mimeType: string;
  pixelWidth: number;
  pixelHeight: number;
  fitMode: ImportFitMode;
}

export interface ImportRequestBody {
  fileName: string;
  declaredMimeType: string;
  dataBase64: string;
  profile: PaperForm;
  fitMode: ImportFitMode;
}

export interface ValidationIssue {
  field: string;
  messageKey: string;
}
