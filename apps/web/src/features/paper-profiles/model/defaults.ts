import type { DisplayUnit, PaperForm, PaperProfileUx } from './types.js';

export const DEFAULT_BARCODE_HEIGHT_MM = 12;
/** A conservative one-column width for the common 3-up label stock. Operators
 * can override this per field when the physical cell is different. */
export const DEFAULT_BARCODE_WIDTH_MM = 28;
export const DEFAULT_QR_SIZE_MM = 20;

export const PAPER_PRESETS = [
  { label: 'A4 (210 × 297 mm)', widthMm: 210, heightMm: 297, dpi: 300 },
  { label: 'A5 (148 × 210 mm)', widthMm: 148, heightMm: 210, dpi: 300 },
  { label: 'Letter (216 × 279 mm)', widthMm: 216, heightMm: 279, dpi: 300 },
  { label: 'Label 100 × 50 mm', widthMm: 100, heightMm: 50, dpi: 203 },
  { label: 'Label 80 × 50 mm', widthMm: 80, heightMm: 50, dpi: 203 },
  { label: 'Label 60 × 40 mm', widthMm: 60, heightMm: 40, dpi: 203 },
  { label: 'Label 40 × 30 mm', widthMm: 40, heightMm: 30, dpi: 203 },
  { label: 'Receipt 80 × 297 mm', widthMm: 80, heightMm: 297, dpi: 203 },
] as const;

export const DPI_OPTIONS = [203, 300, 600] as const;
export const DISPLAY_UNITS: DisplayUnit[] = ['mm', 'cm', 'px'];
export const FONT_LIST = [
  'system-ui, sans-serif',
  'ui-monospace, monospace',
  'Arial, sans-serif',
  '"Courier New", monospace',
  '"Times New Roman", serif',
  '"Segoe UI", sans-serif',
  'Tahoma, sans-serif',
  'Verdana, sans-serif',
];

export const DEFAULT_FORM: PaperForm = {
  code: '',
  name: '',
  widthMm: 100,
  gapMm: 0,
  heightMm: 50,
  marginTopMm: 2,
  marginRightMm: 2,
  marginBottomMm: 2,
  marginLeftMm: 2,
  dpi: 203,
  orientation: 'landscape',
  unit: 'mm',
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  layout: undefined,
};

export const DEFAULT_UX: PaperProfileUx = {
  displayUnit: 'mm',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  fontWeight: 'normal',
  fontColor: '#000000',
  bgColor: '#ffffff',
  watermarkText: '',
  watermarkOpacity: 15,
  dynamicFields: [],
};
