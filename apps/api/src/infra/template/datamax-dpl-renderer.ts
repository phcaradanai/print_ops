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
const HRI_HEIGHT_MM = 2;
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
  const symbolCount = value.length % 2 === 0
    ? 1 + pairs + 1 // start C + pairs + checksum
    : 1 + pairs + 1 + 1; // start C + pairs + switch/data + checksum
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


function sourceBoxForRotatedBox(
  rotatedX: number,
  rotatedY: number,
  rotatedWidth: number,
  rotatedHeight: number,
  cellWidthDots: number,
  cellHeightDots: number,
  rotation: number,
): { xDots: number; yDots: number; widthDots: number; heightDots: number } {
  switch (rotation) {
    case 90:
      return {
        xDots: rotatedY,
        yDots: cellWidthDots - rotatedX - rotatedWidth,
        widthDots: rotatedHeight,
        heightDots: rotatedWidth,
      };
    case 180:
      return {
        xDots: cellWidthDots - rotatedX - rotatedWidth,
        yDots: cellHeightDots - rotatedY - rotatedHeight,
        widthDots: rotatedWidth,
        heightDots: rotatedHeight,
      };
    case 270:
      return {
        xDots: cellHeightDots - rotatedY - rotatedHeight,
        yDots: rotatedX,
        widthDots: rotatedHeight,
        heightDots: rotatedWidth,
      };
    default:
      return { xDots: rotatedX, yDots: rotatedY, widthDots: rotatedWidth, heightDots: rotatedHeight };
  }
}

function dplPivotForRotatedBox(
  rotation: number,
  rotatedX: number,
  rotatedTop: number,
  rotatedWidth: number,
  rotatedHeight: number,
  cellHeightDots: number,
  sourceWidthDots: number,
  sourceHeightDots: number,
): { rowDots: number; columnDots: number } {
  const targetBottomDots = cellHeightDots - rotatedTop - rotatedHeight;
  switch (rotation) {
    case 90:
      return { rowDots: targetBottomDots, columnDots: rotatedX + sourceHeightDots };
    case 180:
      return { rowDots: targetBottomDots + sourceHeightDots, columnDots: rotatedX + sourceWidthDots };
    case 270:
      return { rowDots: targetBottomDots + sourceWidthDots, columnDots: rotatedX };
    default:
      return { rowDots: targetBottomDots, columnDots: rotatedX };
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
  const barsHeightDots = Math.max(1, boxHeightDots - millimetersToRoundedDots(HRI_HEIGHT_MM, profile.dpi));
  const { narrowBarDots, actualWidthDots } = fitBarcodeWidth(boxWidthDots, code128ModuleCount(value));

  const contentRotation = normalizeQuarterTurn(
    (profile.rotation ?? 0) + (renderOptions.rotate ?? 0),
  );
  const anchorX = millimetersToIntegerDots(field.xMm, profile.dpi);
  const anchorY = millimetersToIntegerDots(field.yMm, profile.dpi);
  const rotatedBoxWidth = contentRotation === 90 || contentRotation === 270 ? boxHeightDots : boxWidthDots;
  const rotatedBoxHeight = contentRotation === 90 || contentRotation === 270 ? boxWidthDots : boxHeightDots;
  const centeredSourceBox = sourceBoxForRotatedBox(
    Math.floor((cellWidthDots - rotatedBoxWidth) / 2),
    Math.floor((cellHeightDots - rotatedBoxHeight) / 2),
    rotatedBoxWidth,
    rotatedBoxHeight,
    cellWidthDots,
    cellHeightDots,
    contentRotation,
  );
  const alignedX = field.align === 'right' ? anchorX - boxWidthDots : anchorX;
  const localX = field.align === 'center'
    ? centeredSourceBox.xDots
    : clamp(alignedX, safeDots, cellWidthDots - safeDots - boxWidthDots);
  const localY = field.align === 'center'
    ? centeredSourceBox.yDots
    : clamp(anchorY, safeDots, cellHeightDots - safeDots - boxHeightDots);
  const symbolHeightDots = barsHeightDots + millimetersToRoundedDots(HRI_HEIGHT_MM, profile.dpi);
  const symbolX = localX + Math.floor((boxWidthDots - actualWidthDots) / 2);
  const symbolY = localY + Math.floor((boxHeightDots - symbolHeightDots) / 2);
  const symbol = rotateBox(
    symbolX,
    symbolY,
    actualWidthDots,
    symbolHeightDots,
    cellWidthDots,
    cellHeightDots,
    contentRotation,
  );
  const safeRight = cellWidthDots - safeDots;
  const safeBottom = cellHeightDots - safeDots;
  if (
    symbol.xDots < safeDots ||
    symbol.yDots < safeDots ||
    symbol.xDots + symbol.widthDots > safeRight ||
    symbol.yDots + symbol.heightDots > safeBottom
  ) {
    throw new RangeError(
      `Datamax barcode footprint ${symbol.widthDots}x${symbol.heightDots} dots does not fit the rotated cell safe area ${safeRight - safeDots}x${safeBottom - safeDots}`,
    );
  }
  const pivot = dplPivotForRotatedBox(
    contentRotation,
    symbol.xDots,
    symbol.yDots,
    symbol.widthDots,
    symbol.heightDots,
    cellHeightDots,
    actualWidthDots,
    symbolHeightDots,
  );
  const heightUnits = millimetersToDplUnits((barsHeightDots * 25.4) / profile.dpi);
  const rowUnits = dotsToDplUnits(pivot.rowDots, profile.dpi);
  const columnUnits = dotsToDplUnits(pivot.columnDots, profile.dpi);
  const record = `${rotationCode(contentRotation)}E2${narrowBarDots}${pad(heightUnits, 3)}${pad(rowUnits, 4)}${pad(columnUnits, 4)}${dplData(value)}${CR}`;
  return { record, rowDots: symbol.yDots, columnDots: symbol.xDots };
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
