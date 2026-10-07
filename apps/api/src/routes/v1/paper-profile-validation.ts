import type { PaperProfile } from '@printerops/domain';
import {
  fieldContentFitsPaper,
  getOrientedPaperGeometry,
  maxFieldSymbolSizeMm,
  qrQuietZoneUpperBoundMm,
  resolveRenderTransform,
  type FieldContentBox,
} from '@printerops/shared';

export interface PaperProfileIssue {
  field: string;
  message: string;
}

/** The numeric/geometry subset every stored profile must satisfy. Mirrors the
 * dashboard editor's client-side rules (apps/web/src/features/paper-profiles/
 * model/validation.ts) so a direct API caller cannot store a profile the
 * editor itself would refuse — the print chain (template rendering, physical
 * previews, the WebView2 helper's page geometry) consumes these values as
 * trusted physical dimensions. */
type PaperProfileGeometry = Pick<
  PaperProfile,
  | 'widthMm'
  | 'heightMm'
  | 'dpi'
  | 'marginTopMm'
  | 'marginRightMm'
  | 'marginBottomMm'
  | 'marginLeftMm'
>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkGeometry(profile: PaperProfileGeometry): PaperProfileIssue[] {
  const issues: PaperProfileIssue[] = [];
  const positive: Array<[keyof PaperProfileGeometry, string]> = [
    ['widthMm', 'widthMm must be a finite number greater than zero'],
    ['heightMm', 'heightMm must be a finite number greater than zero'],
    ['dpi', 'dpi must be a finite number greater than zero'],
  ];
  for (const [field, message] of positive) {
    if (!isFiniteNumber(profile[field]) || profile[field] <= 0) {
      issues.push({ field, message });
    }
  }
  const nonNegative: Array<keyof PaperProfileGeometry> = [
    'marginTopMm',
    'marginRightMm',
    'marginBottomMm',
    'marginLeftMm',
  ];
  for (const field of nonNegative) {
    if (!isFiniteNumber(profile[field]) || profile[field] < 0) {
      issues.push({ field, message: `${field} must be a finite number of at least zero` });
    }
  }
  if (issues.length > 0) return issues;

  if (profile.marginLeftMm + profile.marginRightMm >= profile.widthMm) {
    issues.push({
      field: 'margins',
      message: 'Left and right margins must leave a printable width greater than zero',
    });
  }
  if (profile.marginTopMm + profile.marginBottomMm >= profile.heightMm) {
    issues.push({
      field: 'margins',
      message: 'Top and bottom margins must leave a printable height greater than zero',
    });
  }
  return issues;
}

function checkTransformFields(body: Record<string, unknown>): PaperProfileIssue[] {
  const issues: PaperProfileIssue[] = [];
  if (
    'rotation' in body &&
    (typeof body['rotation'] !== 'number' || !Number.isFinite(body['rotation']) ||
      body['rotation'] < 0 || body['rotation'] >= 360)
  ) {
    issues.push({ field: 'rotation', message: 'rotation must be a finite number from 0 to less than 360' });
  }
  for (const field of ['flipHorizontal', 'flipVertical']) {
    if (field in body && typeof body[field] !== 'boolean') {
      issues.push({ field, message: `${field} must be a boolean` });
    }
  }
  return issues;
}
function checkGapMm(body: Record<string, unknown>): PaperProfileIssue[] {
  const value = body['gapMm'];
  if (value !== undefined && (!isFiniteNumber(value) || value < 0)) {
    return [{ field: 'gapMm', message: 'gapMm must be a finite number of at least zero' }];
  }
  return [];
}

function checkLayout(
  body: Record<string, unknown>,
  profile: PaperProfileGeometry,
): PaperProfileIssue[] {
  if (!('layout' in body) || body['layout'] === undefined) return [];
  const raw = body['layout'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [{ field: 'layout', message: 'layout must be an object' }];
  }
  const layout = raw as Record<string, unknown>;
  const issues: PaperProfileIssue[] = [];
  const columns = layout['columns'];
  if (!Number.isInteger(columns) || (columns as number) < 1 || (columns as number) > 50) {
    issues.push({ field: 'layout.columns', message: 'layout.columns must be a whole number from 1 to 50' });
  }
  const positive: Array<[string, string]> = [
    ['cellWidthMm', 'layout.cellWidthMm must be a finite number greater than zero'],
    ['cellHeightMm', 'layout.cellHeightMm must be a finite number greater than zero'],
    ['rowPitchMm', 'layout.rowPitchMm must be a finite number greater than zero'],
  ];
  for (const [field, message] of positive) {
    if (!isFiniteNumber(layout[field]) || (layout[field] as number) <= 0) {
      issues.push({ field: `layout.${field}`, message });
    }
  }
  if (!isFiniteNumber(layout['columnGapMm']) || (layout['columnGapMm'] as number) < 0) {
    issues.push({
      field: 'layout.columnGapMm',
      message: 'layout.columnGapMm must be a finite number of at least zero',
    });
  }
  if (issues.length > 0) return issues;

  const columnCount = columns as number;
  const cellWidthMm = layout['cellWidthMm'] as number;
  const cellHeightMm = layout['cellHeightMm'] as number;
  const columnGapMm = layout['columnGapMm'] as number;
  const rowPitchMm = layout['rowPitchMm'] as number;
  const printableWidthMm = profile.widthMm - profile.marginLeftMm - profile.marginRightMm;
  const printableHeightMm = profile.heightMm - profile.marginTopMm - profile.marginBottomMm;
  const usedWidthMm = columnCount * cellWidthMm + (columnCount - 1) * columnGapMm;
  if (usedWidthMm > printableWidthMm + 1e-9) {
    issues.push({
      field: 'layout',
      message: 'layout cells and column gaps must fit the printable width',
    });
  }
  if (cellHeightMm > printableHeightMm + 1e-9) {
    issues.push({
      field: 'layout.cellHeightMm',
      message: 'layout.cellHeightMm must fit the printable height',
    });
  }
  if (rowPitchMm + 1e-9 < cellHeightMm) {
    issues.push({
      field: 'layout.rowPitchMm',
      message: 'layout.rowPitchMm must be at least layout.cellHeightMm',
    });
  }
  return issues;
}

function checkFields(body: Record<string, unknown>): PaperProfileIssue[] {
  const rawFields = body['fields'];
  if (rawFields === undefined) return [];
  if (!Array.isArray(rawFields)) return [{ field: 'fields', message: 'fields must be an array' }];

  const widthMm = body['widthMm'];
  const heightMm = body['heightMm'];
  const marginTopMm = body['marginTopMm'];
  const marginRightMm = body['marginRightMm'];
  const marginBottomMm = body['marginBottomMm'];
  const marginLeftMm = body['marginLeftMm'];
  if (!isFiniteNumber(widthMm) || !isFiniteNumber(heightMm) ||
    !isFiniteNumber(marginTopMm) || !isFiniteNumber(marginRightMm) ||
    !isFiniteNumber(marginBottomMm) || !isFiniteNumber(marginLeftMm)) return [];

  const orientation = body['orientation'] === 'landscape'
    ? 'landscape'
    : body['orientation'] === 'portrait'
      ? 'portrait'
      : widthMm > heightMm ? 'landscape' : 'portrait';
  const geometry = getOrientedPaperGeometry({
    widthMm,
    heightMm,
    marginTopMm,
    marginRightMm,
    marginBottomMm,
    marginLeftMm,
    orientation,
  });
  const transform = resolveRenderTransform({
    rotation: isFiniteNumber(body['rotation']) ? body['rotation'] : 0,
    flipHorizontal: typeof body['flipHorizontal'] === 'boolean' ? body['flipHorizontal'] : false,
    flipVertical: typeof body['flipVertical'] === 'boolean' ? body['flipVertical'] : false,
  });
  const issues: PaperProfileIssue[] = [];

  rawFields.forEach((rawField, index) => {
    if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) {
      issues.push({ field: `fields.${index}`, message: 'field must be an object' });
      return;
    }
    const field = rawField as Record<string, unknown>;
    const fieldId = typeof field['id'] === 'string' && field['id'].trim() ? field['id'] : String(index);
    const type = String(field['type'] ?? '');
    const xMm = field['xMm'];
    const yMm = field['yMm'];
    if (!isFiniteNumber(xMm) || !isFiniteNumber(yMm)) {
      issues.push({ field: `fields.${fieldId}.position`, message: 'field position must be finite numbers' });
      return;
    }

    const size = fieldSizeMm(field, type);
    if (!size) {
      issues.push({ field: `fields.${fieldId}.size`, message: fieldSizeRule(type) });
      return;
    }
    const box: FieldContentBox = {
      xMm,
      yMm,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      align: field['align'] === 'center' ? 'center' : field['align'] === 'right' ? 'right' : 'left',
    };
    if (!fieldContentFitsPaper(geometry, transform, { ...box, widthMm: 0, heightMm: 0 })) {
      issues.push({
        field: `fields.${fieldId}`,
        message: `field anchor at X ${xMm.toFixed(1)} mm / Y ${yMm.toFixed(1)} mm is outside the transformed paper boundary`,
      });
      return;
    }
    // A text-like field prints one line of whatever the job payload carries, so
    // its stored size says nothing about the paper: only barcode and QR symbols
    // carry a physical size the paper must accept.
    if (type !== 'barcode' && type !== 'qrcode') return;
    if (fieldContentFitsPaper(geometry, transform, box)) return;
    const limits = maxFieldSymbolSizeMm(geometry, transform, box);
    issues.push({
      field: `fields.${fieldId}`,
      message: `field of ${box.widthMm.toFixed(1)} × ${box.heightMm.toFixed(1)} mm extends beyond the transformed paper boundary; `
        + `at most ${limits.maxWidthMm} × ${limits.maxHeightMm} mm fits at this anchor after rotation`,
    });
  });
  return issues;
}

/** The numeric rule the explicit content size of a field must satisfy. */
function fieldSizeRule(type: string): string {
  if (type === 'qrcode') return 'qrSizeMm must be a finite number greater than zero';
  if (type === 'barcode') return 'barcodeWidthMm and barcodeHeightMm must be finite numbers greater than zero';
  return 'fontSize must be a finite number greater than zero';
}

/** Printed content box of a field: the symbol's physical size, or a degenerate
 * box for text-like fields, whose printed width only exists at print time. */
function fieldSizeMm(field: Record<string, unknown>, type: string): { widthMm: number; heightMm: number } | undefined {
  if (type === 'qrcode') {
    const sizeMm = field['qrSizeMm'] ?? 20;
    if (!isFiniteNumber(sizeMm) || sizeMm <= 0) return undefined;
    const quietZoneMm = qrQuietZoneUpperBoundMm(sizeMm);
    return { widthMm: sizeMm + quietZoneMm * 2, heightMm: sizeMm + quietZoneMm * 2 };
  }
  if (type === 'barcode') {
    const widthMm = field['barcodeWidthMm'] ?? 28;
    const heightMm = field['barcodeHeightMm'] ?? 12;
    return isFiniteNumber(widthMm) && widthMm > 0 && isFiniteNumber(heightMm) && heightMm > 0
      ? { widthMm, heightMm }
      : undefined;
  }
  const fontSize = field['fontSize'];
  return isFiniteNumber(fontSize) && fontSize > 0 ? { widthMm: 0, heightMm: 0 } : undefined;
}

/** Validates a complete profile body for creation. */
export function validatePaperProfileCreate(body: Record<string, unknown>): PaperProfileIssue[] {
  const issues: PaperProfileIssue[] = [];
  if (typeof body['code'] !== 'string' || !body['code'].trim()) {
    issues.push({ field: 'code', message: 'code is required' });
  }
  if (typeof body['name'] !== 'string' || !body['name'].trim()) {
    issues.push({ field: 'name', message: 'name is required' });
  }
  if (body['orientation'] !== undefined && body['orientation'] !== 'portrait' && body['orientation'] !== 'landscape') {
    issues.push({ field: 'orientation', message: "orientation must be 'portrait' or 'landscape'" });
  }
  if (body['unit'] !== undefined && body['unit'] !== 'mm' && body['unit'] !== 'inch') {
    issues.push({ field: 'unit', message: "unit must be 'mm' or 'inch'" });
  }
  issues.push(...checkTransformFields(body));
  issues.push(...checkGapMm(body));
  issues.push(...checkGeometry(body as unknown as PaperProfileGeometry));
  if (issues.length === 0) {
    issues.push(...checkLayout(body, body as unknown as PaperProfileGeometry));
    issues.push(...checkFields(body));
  }
  return issues;
}

/** Validates a partial update by checking the merged result — a patch that
 * only touches margins can still make an existing profile unprintable. */
export function validatePaperProfileUpdate(
  current: PaperProfile,
  patch: Record<string, unknown>,
): PaperProfileIssue[] {
  const issues: PaperProfileIssue[] = [];
  if ('code' in patch && (typeof patch['code'] !== 'string' || !patch['code'].trim())) {
    issues.push({ field: 'code', message: 'code cannot be empty' });
  }
  if ('name' in patch && (typeof patch['name'] !== 'string' || !patch['name'].trim())) {
    issues.push({ field: 'name', message: 'name cannot be empty' });
  }
  if ('orientation' in patch && patch['orientation'] !== 'portrait' && patch['orientation'] !== 'landscape') {
    issues.push({ field: 'orientation', message: "orientation must be 'portrait' or 'landscape'" });
  }
  if ('unit' in patch && patch['unit'] !== 'mm' && patch['unit'] !== 'inch') {
    issues.push({ field: 'unit', message: "unit must be 'mm' or 'inch'" });
  }
  issues.push(...checkTransformFields(patch));
  issues.push(...checkGapMm(patch));
  const merged: PaperProfileGeometry = {
    widthMm: current.widthMm,
    heightMm: current.heightMm,
    dpi: current.dpi,
    marginTopMm: current.marginTopMm,
    marginRightMm: current.marginRightMm,
    marginBottomMm: current.marginBottomMm,
    marginLeftMm: current.marginLeftMm,
    ...(Object.fromEntries(
      Object.entries(patch).filter(([key]) =>
        ['widthMm', 'heightMm', 'dpi', 'marginTopMm', 'marginRightMm', 'marginBottomMm', 'marginLeftMm'].includes(key),
      ),
    ) as Partial<PaperProfileGeometry>),
  };
  issues.push(...checkGeometry(merged));
  if (issues.length === 0) {
    const layoutBody: Record<string, unknown> = {
      layout: 'layout' in patch ? patch['layout'] : current.layout,
    };
    issues.push(...checkLayout(layoutBody, merged));
    issues.push(...checkFields({
      ...current,
      ...patch,
      fields: 'fields' in patch ? patch['fields'] : current.fields,
      ...merged,
    }));
  }
  return issues;
}

/** Coerces an import row's numeric field: absent/empty keeps the legacy
 * default, but a present value that is not a valid number is an error rather
 * than being silently replaced. */
export function coerceImportNumber(
  value: unknown,
  fallback: number,
): { value: number } | { invalid: true } {
  if (value === undefined || value === null || value === '') return { value: fallback };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return { invalid: true };
  return { value: parsed };
}
