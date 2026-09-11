import type {
  PaperProfile,
  PaperProfileField,
  RenderTransformOverrides,
} from '@printerops/domain';
import { millimetersToIntegerDots, resolvePaperProfileGeometry } from '@printerops/domain';
import { millimetersToRoundedDots } from '@printerops/shared';

const CR = '\r';
const STX = '\x02';
const DEFAULT_BARCODE_WIDTH_MM = 26;
const DEFAULT_BARCODE_HEIGHT_MM = 8;
const SAFE_PADDING_MM = 1;
const MAX_DPL_COORDINATE = 9999;

/** DPL positions and barcode heights are expressed in tenths of a millimetre
 * after the format switches the printer to metric mode. Barcode module width
 * remains a native integer dot multiplier. */
function millimetersToDplUnits(millimeters: number): number {
  return Math.round(millimeters * 10);
}

function dotsToDplUnits(dots: number, dpi: number): number {
  return millimetersToDplUnits((dots * 25.4) / dpi);
}

const TOKEN_PATTERN = /\{\{\s*(?:(barcode|qrcode)\s*:\s*([a-zA-Z0-9_.-]+)(?:\s*:\s*[a-zA-Z0-9_-]+)?|([a-zA-Z0-9_.-]+))\s*\}\}/g;

export interface DatamaxDplRenderResult {
  dpl: string;
  warnings: string[];
}

export interface DatamaxDplFieldRecord {
  record: string;
  rowDots: number;
  columnDots: number;
}

function valueAt(payload: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, payload);
}

function pad(value: number, width: number): string {
  if (!Number.isInteger(value) || value < 0 || value > MAX_DPL_COORDINATE) {
    throw new RangeError(`DPL value ${value} must be an integer from 0 to ${MAX_DPL_COORDINATE}`);
  }
  return String(value).padStart(width, '0');
}

function normalizeQuarterTurn(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  if (normalized % 90 !== 0) {
    throw new RangeError('Datamax DPL native rendering supports rotation in 90-degree increments only');
  }
  return normalized;
}

function rotationCode(rotation: number): string {
  return ({ 0: '1', 90: '2', 180: '3', 270: '4' } as Record<number, string>)[rotation]!;
}

function dplData(value: string): string {
  // DPL uses CR as the format-record terminator. Native numeric Code 128 is
  // deliberately stricter than HTML substitution: there is no safe way to
  // let control bytes or a second record enter the printer command stream.
  if (!/^[0-9]+$/.test(value)) {
    throw new Error('Datamax native Code 128 requires a non-empty numeric value');
  }
  if (value.length > 240) {
    throw new Error('Datamax native Code 128 value is too long for a DPL field');
  }
  return `C${value}`;
}

function code128ModuleCount(value: string): number {
  // The DPL printer encodes a leading C as Code 128 subset C. Each encoded
  // symbol is 11 modules; the stop symbol is 13 modules. An odd final digit
  // causes the printer to switch to subset B for that digit.
  const pairs = Math.floor(value.length / 2);
  const dataSymbols = pairs + (value.length % 2 === 0 ? 0 : 2);
  const symbolCount = 1 + dataSymbols + 1; // start + data/switch symbols + checksum
  return symbolCount * 11 + 13;
}

function fitBarcodeWidth(
  requestedWidthDots: number,
  moduleCount: number,
): { narrowBarDots: number; actualWidthDots: number } {
  const narrowBarDots = Math.floor(requestedWidthDots / moduleCount);
  if (narrowBarDots < 1) {
    throw new RangeError(
      `Datamax Code 128 needs ${moduleCount} dots at minimum but the safe barcode box is ${requestedWidthDots} dots`,
    );
  }
  // DPL's narrow-bar field accepts 1..9 and A..O. The native path intentionally
  // stays in the numeric range so its geometry is obvious in diagnostics.
  if (narrowBarDots > 9) {
    throw new RangeError(`Datamax Code 128 narrow bar width ${narrowBarDots} exceeds the supported DPL numeric range`);
  }
  return { narrowBarDots, actualWidthDots: narrowBarDots * moduleCount };
}

interface DatamaxHriMetrics {
  heightDots: number;
  widthDots: number;
  spacingDots: number;
}

/**
 * Uppercase DPL barcode IDs print HRI with the printer's resident font 0.
 * I-4208's 203-DPI table is 7x5 dots with 1 dot of character spacing; scale
 * the same native metrics for profiles targeting another Datamax head.
 */
function datamaxHriMetrics(dpi: number): DatamaxHriMetrics {
  const scale = dpi / 203;
  return {
    heightDots: Math.max(1, Math.round(7 * scale)),
    widthDots: Math.max(1, Math.round(5 * scale)),
    spacingDots: Math.max(1, Math.round(scale)),
  };
}

function datamaxHriWidthDots(value: string, dpi: number): number {
  const metrics = datamaxHriMetrics(dpi);
  return Math.max(
    metrics.widthDots,
    value.length * metrics.widthDots + Math.max(0, value.length - 1) * metrics.spacingDots,
  );
}
function fieldKeys(content: string, profile: PaperProfile): string[] {
  const keys: string[] = [];
  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const key = match[2] ?? match[3];
    if (key && !keys.includes(key)) keys.push(key);
  }
  if (keys.length > 0) return keys;
  return (profile.fields ?? []).map((field) => field.key.trim()).filter(Boolean);
}

function fieldForKey(profile: PaperProfile, key: string): PaperProfileField | undefined {
  return profile.fields.find((field) => field.key === key);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rotateBox(
  xDots: number,
  yDots: number,
  widthDots: number,
  heightDots: number,
  cellWidthDots: number,
  cellHeightDots: number,
  rotation: number,
): { xDots: number; yDots: number; widthDots: number; heightDots: number } {
  switch (rotation) {
    case 90:
      return {
        xDots: cellWidthDots - yDots - heightDots,
        yDots: xDots,
        widthDots: heightDots,
        heightDots: widthDots,
      };
    case 180:
      return {
        xDots: cellWidthDots - xDots - widthDots,
        yDots: cellHeightDots - yDots - heightDots,
        widthDots,
        heightDots,
      };
    case 270:
      return {
        xDots: yDots,
        yDots: cellHeightDots - xDots - widthDots,
        widthDots: heightDots,
        heightDots: widthDots,
      };
    default:
      return { xDots, yDots, widthDots, heightDots };
  }
}


function dplPivotForRotatedBox(
  rotation: number,
  rotatedX: number,
  rotatedTop: number,
  rotatedWidth: number,
  rotatedHeight: number,
  cellHeightDots: number,
): { rowDots: number; columnDots: number } {
  // DPL coordinates use a lower-left home position and rotate around the
  // object's lower-left pivot. Convert the final top-origin footprint back to
  // that pivot instead of treating row as the top of the rotated box.
  const targetTopRowDots = cellHeightDots - rotatedTop;
  const targetBottomRowDots = targetTopRowDots - rotatedHeight;
  switch (rotation) {
    case 90: // pivot is the final top-left corner
      return { rowDots: targetTopRowDots, columnDots: rotatedX };
    case 180:
      return { rowDots: targetTopRowDots, columnDots: rotatedX + rotatedWidth };
    case 270: // pivot is the final bottom-right corner
      return { rowDots: targetBottomRowDots, columnDots: rotatedX + rotatedWidth };
    default:
      return { rowDots: targetBottomRowDots, columnDots: rotatedX };
  }
}

function barcodeRecord(
  field: PaperProfileField,
  value: string,
  profile: PaperProfile,
  renderOptions: RenderTransformOverrides = {},
): DatamaxDplFieldRecord {
  if (field.type !== 'barcode') {
    throw new Error(`Datamax native renderer supports barcode fields only; '${field.key}' is ${field.type}`);
  }
  if (field.barcodeSymbology && field.barcodeSymbology !== 'code128') {
    throw new Error(`Datamax native renderer supports Code 128 only; '${field.key}' requests ${field.barcodeSymbology}`);
  }

  const geometry = resolvePaperProfileGeometry(profile);
  const cellWidthDots = millimetersToRoundedDots(geometry.widthMm, profile.dpi);
  const cellHeightDots = millimetersToRoundedDots(geometry.heightMm, profile.dpi);
  const safeDots = Math.max(1, millimetersToRoundedDots(SAFE_PADDING_MM, profile.dpi));
  const requestedWidthDots = millimetersToRoundedDots(field.barcodeWidthMm ?? DEFAULT_BARCODE_WIDTH_MM, profile.dpi);
  const requestedHeightDots = millimetersToRoundedDots(field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM, profile.dpi);
  const availableWidthDots = cellWidthDots - safeDots * 2;
  const availableHeightDots = cellHeightDots - safeDots * 2;
  if (availableWidthDots <= 0 || availableHeightDots <= 0) {
    throw new RangeError(`Datamax cell ${cellWidthDots}x${cellHeightDots} dots has no usable safe area`);
  }

  const boxWidthDots = Math.min(requestedWidthDots, availableWidthDots);
  const boxHeightDots = Math.min(requestedHeightDots, availableHeightDots);
  const hriMetrics = datamaxHriMetrics(profile.dpi);
  const hriHeightDots = hriMetrics.heightDots + 1;
  const hriWidthDots = datamaxHriWidthDots(value, profile.dpi);
  const barsHeightDots = boxHeightDots - hriHeightDots;
  if (barsHeightDots < 1) {
    throw new RangeError(`Datamax cell ${cellWidthDots}x${cellHeightDots} dots has no safe area for barcode HRI`);
  }
  // barcodeHeightMm is the configured complete barcode/HRI footprint. Reserve
  // the measured native HRI inside that box so existing field sizing remains
  // stable while the complete block is centered and cannot clip.
  const { narrowBarDots, actualWidthDots } = fitBarcodeWidth(boxWidthDots, code128ModuleCount(value));
  const blockWidthDots = Math.max(actualWidthDots, hriWidthDots);
  const blockHeightDots = boxHeightDots;
  if (blockWidthDots > availableWidthDots) {
    throw new RangeError(
      `Datamax barcode block width ${blockWidthDots} dots does not fit the cell safe area ${availableWidthDots} dots`,
    );
  }

  const contentRotation = normalizeQuarterTurn(
    (profile.rotation ?? 0) + (renderOptions.rotate ?? 0),
  );
  const anchorX = millimetersToIntegerDots(field.xMm, profile.dpi);
  const anchorY = millimetersToIntegerDots(field.yMm, profile.dpi);
  const rotated = contentRotation === 90 || contentRotation === 270;
  const rotatedBlockWidthDots = rotated ? blockHeightDots : blockWidthDots;
  const rotatedBlockHeightDots = rotated ? blockWidthDots : blockHeightDots;
  const footprint = field.align === 'center'
    ? {
        xDots: Math.floor((cellWidthDots - rotatedBlockWidthDots) / 2),
        yDots: Math.floor((cellHeightDots - rotatedBlockHeightDots) / 2),
        widthDots: rotatedBlockWidthDots,
        heightDots: rotatedBlockHeightDots,
      }
    : rotateBox(
        field.align === 'right'
          ? clamp(anchorX - blockWidthDots, safeDots, cellWidthDots - safeDots - blockWidthDots)
          : clamp(anchorX, safeDots, cellWidthDots - safeDots - blockWidthDots),
        clamp(anchorY, safeDots, cellHeightDots - safeDots - blockHeightDots),
        blockWidthDots,
        blockHeightDots,
        cellWidthDots,
        cellHeightDots,
        contentRotation,
      );
  const safeRight = cellWidthDots - safeDots;
  const safeBottom = cellHeightDots - safeDots;
  if (
    footprint.xDots < safeDots ||
    footprint.yDots < safeDots ||
    footprint.xDots + footprint.widthDots > safeRight ||
    footprint.yDots + footprint.heightDots > safeBottom
  ) {
    throw new RangeError(
      `Datamax barcode footprint ${footprint.widthDots}x${footprint.heightDots} dots does not fit the rotated cell safe area ${safeRight - safeDots}x${safeBottom - safeDots}`,
    );
  }
  const pivot = dplPivotForRotatedBox(
    contentRotation,
    footprint.xDots,
    footprint.yDots,
    footprint.widthDots,
    footprint.heightDots,
    cellHeightDots,
  );
  const heightUnits = millimetersToDplUnits((barsHeightDots * 25.4) / profile.dpi);
  const rowUnits = dotsToDplUnits(pivot.rowDots, profile.dpi);
  const columnUnits = dotsToDplUnits(pivot.columnDots, profile.dpi);
  const record = `${rotationCode(contentRotation)}E2${narrowBarDots}${pad(heightUnits, 3)}${pad(rowUnits, 4)}${pad(columnUnits, 4)}${dplData(value)}${CR}`;
  return { record, rowDots: footprint.yDots, columnDots: footprint.xDots };
}

function renderTextField(
  field: PaperProfileField,
  value: string,
  profile: PaperProfile,
): DatamaxDplFieldRecord {
  const geometry = resolvePaperProfileGeometry(profile);
  const widthDots = millimetersToRoundedDots(geometry.widthMm, profile.dpi);
  const heightDots = millimetersToRoundedDots(geometry.heightMm, profile.dpi);
  const safeDots = Math.max(1, millimetersToRoundedDots(SAFE_PADDING_MM, profile.dpi));
  const x = clamp(millimetersToIntegerDots(field.xMm, profile.dpi), safeDots, widthDots - safeDots);
  const y = clamp(millimetersToIntegerDots(field.yMm, profile.dpi), safeDots, heightDots - safeDots);
  const font = field.bold ? '2' : '1';
  const escaped = value.replace(/[\x00-\x1f\x7f\r\n]/g, ' ');
  const record = `1${font}11000${pad(y, 4)}${pad(x, 4)}${escaped}${CR}`;
  return { record, rowDots: y, columnDots: x };
}

/** Render a profile-bound Datamax label using native DPL primitives. */
export function renderDatamaxDpl(
  templateContent: string,
  payload: Record<string, unknown>,
  profile: PaperProfile,
  renderOptions: RenderTransformOverrides = {},
): DatamaxDplRenderResult {
  const warnings: string[] = [];
  const geometry = resolvePaperProfileGeometry(profile);
  if (geometry.layout.columns !== 1) {
    throw new RangeError('Datamax native renderer expects a single cell profile; compose 3-up rows at the media layer');
  }
  const keys = fieldKeys(templateContent, profile);
  const records: string[] = [];
  for (const key of keys) {
    const field = fieldForKey(profile, key);
    if (!field) {
      warnings.push(`Missing paper-profile field: ${key}`);
      continue;
    }
    const raw = valueAt(payload, key);
    if (raw == null || raw === '') {
      warnings.push(`Missing field: ${key}`);
      continue;
    }
    const value = String(raw);
    if (field.type === 'barcode') {
      records.push(barcodeRecord(field, value, profile, renderOptions).record);
    } else if (field.type === 'text' || field.type === 'number' || field.type === 'date') {
      records.push(renderTextField(field, value, profile).record);
    } else {
      throw new Error(`Datamax native renderer does not support ${field.type} field '${key}'`);
    }
  }
  if (records.length === 0) warnings.push('No printable fields resolved for Datamax native output');
  return {
    dpl: `${STX}L${CR}m${CR}D11${CR}${records.join('')}Q0001${CR}E${CR}`,
    warnings,
  };
}

/** Extract our field records and shift them by a physical cell origin. */
export function offsetDatamaxDplFields(dpl: string, xDots: number, yDots: number, dpi = 203): string {
  if (!Number.isInteger(xDots) || !Number.isInteger(yDots)) {
    throw new RangeError('Datamax DPL offsets must be integer dots');
  }
  const xUnits = dotsToDplUnits(xDots, dpi);
  const yUnits = dotsToDplUnits(yDots, dpi);
  const lines = dpl.split(CR);
  const shifted = lines.map((line) => {
    if (!/^[1-4]E\d\d\d{3}\d{4}\d{4}C\d+$/.test(line)) return line;
    const row = Number(line.slice(7, 11)) + yUnits;
    const column = Number(line.slice(11, 15)) + xUnits;
    return `${line.slice(0, 7)}${pad(row, 4)}${pad(column, 4)}${line.slice(15)}`;
  });
  return shifted.join(CR);
}

/** Combine one-cell native DPL labels into consecutive 3-up feed rows. */
export function composeDatamaxDplRows(
  labels: string[],
  profile: PaperProfile,
): string {
  const geometry = resolvePaperProfileGeometry(profile);
  const columns = geometry.layout.columns;
  if (columns <= 1) return labels.join('');
  const rows: string[] = [];
  for (let row = 0; row < labels.length; row += columns) {
    const fields: string[] = [];
    for (let column = 0; column < columns; column += 1) {
      const label = labels[row + column];
      if (!label) continue;
      const cell = geometry.cells[column]!;
      const shifted = offsetDatamaxDplFields(label, cell.xDots, 0, profile.dpi);
      const body = shifted
        .replace(/^\x02L\r(?:m\r)?D11\r/, '')
        .replace(/Q0001\rE\r$/, '');
      fields.push(body);
    }
    rows.push(`${STX}L${CR}m${CR}D11${CR}${fields.join('')}Q0001${CR}E${CR}`);
  }
  return rows.join('');
}

/** True when a payload is a complete native DPL stream. */
export function isDatamaxDplPayload(payload: string): boolean {
  return payload.includes(`${STX}L${CR}`) && payload.includes(`${CR}E${CR}`);
}
