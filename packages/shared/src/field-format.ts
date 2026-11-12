/**
 * Print-time formatting of a profile field's value, shared by the API (applied
 * to the job payload before any engine renders it) and the editor canvas.
 */
export interface FieldFormat {
  type: string;
  prefix?: string;
  suffix?: string;
  /** number fields: fixed decimal places. */
  decimals?: number;
  /** number fields: group thousands with ",". */
  thousands?: boolean;
  /** date fields: tokens DD MM YYYY YY BBBB (Buddhist year) BB HH mm ss. */
  dateFormat?: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function formatDate(raw: string, pattern: string): string {
  // Read the written components instead of new Date(): no timezone shift between server and canvas.
  const m = ISO_DATE.exec(raw.trim());
  if (!m) return raw;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const be = String(Number(y) + 543);
  const parts: Record<string, string> = {
    YYYY: y!, YY: y!.slice(2), BBBB: be, BB: be.slice(2), MM: mo!, DD: d!, HH: h, mm: mi, ss: s,
  };
  return pattern.replace(/YYYY|BBBB|YY|BB|MM|DD|HH|mm|ss/g, (token) => parts[token]!);
}

function formatNumber(raw: string, decimals?: number, thousands?: boolean): string {
  const n = Number(raw.replace(/,/g, '').trim());
  if (raw.trim() === '' || !Number.isFinite(n)) return raw;
  const fixed = decimals == null ? String(n) : n.toFixed(decimals);
  if (!thousands) return fixed;
  const [int, frac] = fixed.split('.');
  return int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac != null ? `.${frac}` : '');
}

export function hasFieldFormat(field: FieldFormat): boolean {
  if (field.type === 'barcode' || field.type === 'qrcode' || isStaticFieldType(field.type)) return false;
  return Boolean(field.prefix || field.suffix || field.dateFormat || field.decimals != null || field.thousands);
}

/** Barcode/QR values are never touched: changing them changes what scans. */
export function formatFieldValue(field: FieldFormat, raw: string): string {
  if (!hasFieldFormat(field)) return raw;
  let value = raw;
  if (field.type === 'date' && field.dateFormat) value = formatDate(value, field.dateFormat);
  if (field.type === 'number') value = formatNumber(value, field.decimals, field.thousands);
  return `${field.prefix ?? ''}${value}${field.suffix ?? ''}`;
}

/** shape (box/line) and image (logo) print the same on every label: no payload value. */
export function isStaticFieldType(type: string): boolean {
  return type === 'shape' || type === 'image';
}

export const DEFAULT_STATIC_BOX_MM = { widthMm: 20, heightMm: 10, borderMm: 0.3 } as const;

/** Printed box of a shape/image field, in mm. */
export function staticBoxMm(field: { boxWidthMm?: number; boxHeightMm?: number }): { widthMm: number; heightMm: number } {
  return {
    widthMm: field.boxWidthMm ?? DEFAULT_STATIC_BOX_MM.widthMm,
    heightMm: field.boxHeightMm ?? DEFAULT_STATIC_BOX_MM.heightMm,
  };
}

/** Only raster logos: an SVG data URI could carry script into the print HTML. */
export const IMAGE_DATA_URI_PATTERN = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
export const MAX_IMAGE_DATA_URI_CHARS = 350_000;
