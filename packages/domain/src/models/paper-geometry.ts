import type { PaperProfile, PaperProfileLayout } from './template.js';

const MILLIMETERS_PER_INCH = 25.4;
const FIT_EPSILON_MM = 1e-9;

export interface PaperCellOrigin {
  column: number;
  row: number;
  xMm: number;
  yMm: number;
  xDots: number;
  yDots: number;
}

export interface ResolvedPaperProfileGeometry {
  widthMm: number;
  heightMm: number;
  dpi: number;
  widthDots: number;
  heightDots: number;
  printableWidthMm: number;
  printableHeightMm: number;
  layout: PaperProfileLayout;
  cells: PaperCellOrigin[];
}

type GeometryInput = Pick<
  PaperProfile,
  'widthMm' | 'heightMm' | 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm' | 'gapMm' | 'dpi' | 'layout'
>;

function assertFinite(name: string, value: number, minimum: number, inclusive = true): void {
  if (!Number.isFinite(value) || (inclusive ? value < minimum : value <= minimum)) {
    throw new RangeError(`${name} must be a finite number ${inclusive ? 'at least' : 'greater than'} ${minimum}`);
  }
}

/** Convert millimetres once at the physical boundary, rounding to printer dots. */
export function millimetersToIntegerDots(millimeters: number, dpi: number): number {
  assertFinite('millimeters', millimeters, 0);
  assertFinite('dpi', dpi, 0, false);
  return Math.round((millimeters * dpi) / MILLIMETERS_PER_INCH);
}

export function resolvePaperProfileLayout(profile: GeometryInput): PaperProfileLayout {
  const printableWidthMm = profile.widthMm - profile.marginLeftMm - profile.marginRightMm;
  const printableHeightMm = profile.heightMm - profile.marginTopMm - profile.marginBottomMm;
  return profile.layout ?? {
    columns: 1,
    cellWidthMm: printableWidthMm,
    cellHeightMm: printableHeightMm,
    columnGapMm: 0,
    rowPitchMm: printableHeightMm + (profile.gapMm ?? 0),
  };
}

/** Resolve and validate media/cell geometry without talking to a printer. */
export function resolvePaperProfileGeometry(profile: GeometryInput): ResolvedPaperProfileGeometry {
  assertFinite('widthMm', profile.widthMm, 0, false);
  assertFinite('heightMm', profile.heightMm, 0, false);
  assertFinite('dpi', profile.dpi, 0, false);
  assertFinite('marginTopMm', profile.marginTopMm, 0);
  assertFinite('marginRightMm', profile.marginRightMm, 0);
  assertFinite('marginBottomMm', profile.marginBottomMm, 0);
  assertFinite('marginLeftMm', profile.marginLeftMm, 0);
  const printableWidthMm = profile.widthMm - profile.marginLeftMm - profile.marginRightMm;
  const printableHeightMm = profile.heightMm - profile.marginTopMm - profile.marginBottomMm;
  assertFinite('printableWidthMm', printableWidthMm, 0, false);
  assertFinite('printableHeightMm', printableHeightMm, 0, false);

  const layout = resolvePaperProfileLayout(profile);
  if (!Number.isInteger(layout.columns) || layout.columns < 1) {
    throw new RangeError('layout.columns must be an integer of at least 1');
  }
  assertFinite('layout.cellWidthMm', layout.cellWidthMm, 0, false);
  assertFinite('layout.cellHeightMm', layout.cellHeightMm, 0, false);
  assertFinite('layout.columnGapMm', layout.columnGapMm, 0);
  assertFinite('layout.rowPitchMm', layout.rowPitchMm, 0, false);
  if (layout.rowPitchMm + FIT_EPSILON_MM < layout.cellHeightMm) {
    throw new RangeError('layout.rowPitchMm must be at least layout.cellHeightMm');
  }
  const usedWidthMm = layout.columns * layout.cellWidthMm + (layout.columns - 1) * layout.columnGapMm;
  if (usedWidthMm > printableWidthMm + FIT_EPSILON_MM) {
    throw new RangeError('layout cells and column gaps must fit the printable width');
  }
  if (layout.cellHeightMm > printableHeightMm + FIT_EPSILON_MM) {
    throw new RangeError('layout.cellHeightMm must fit the printable height');
  }

  const cells = Array.from({ length: layout.columns }, (_, column) => {
    const xMm = profile.marginLeftMm + column * (layout.cellWidthMm + layout.columnGapMm);
    const yMm = profile.marginTopMm;
    return { column, row: 0, xMm, yMm, xDots: millimetersToIntegerDots(xMm, profile.dpi), yDots: millimetersToIntegerDots(yMm, profile.dpi) };
  });
  return {
    widthMm: profile.widthMm,
    heightMm: profile.heightMm,
    dpi: profile.dpi,
    widthDots: millimetersToIntegerDots(profile.widthMm, profile.dpi),
    heightDots: millimetersToIntegerDots(profile.heightMm, profile.dpi),
    printableWidthMm,
    printableHeightMm,
    layout: { ...layout },
    cells,
  };
}

/** Derive a row/column origin without accumulating earlier rounded values. */
export function derivePaperCellOrigin(profile: GeometryInput, column: number, row = 0): PaperCellOrigin {
  const geometry = resolvePaperProfileGeometry(profile);
  if (!Number.isInteger(column) || column < 0 || column >= geometry.layout.columns) {
    throw new RangeError(`column must be an integer from 0 to ${geometry.layout.columns - 1}`);
  }
  if (!Number.isInteger(row) || row < 0) throw new RangeError('row must be a non-negative integer');
  const xMm = profile.marginLeftMm + column * (geometry.layout.cellWidthMm + geometry.layout.columnGapMm);
  const yMm = profile.marginTopMm + row * geometry.layout.rowPitchMm;
  return { column, row, xMm, yMm, xDots: millimetersToIntegerDots(xMm, profile.dpi), yDots: millimetersToIntegerDots(yMm, profile.dpi) };
}

/** Serializable, adapter-agnostic job metadata snapshot. */
export function snapshotPaperProfileGeometry(profile: GeometryInput): ResolvedPaperProfileGeometry {
  return resolvePaperProfileGeometry(profile);
}

/**
 * Render one logical item for a repeated-label profile. The physical sheet
 * keeps the full profile geometry; the template renderer receives one cell so
 * its root box and barcode coordinates cannot spill into the neighbouring
 * columns.
 */
export function paperProfileForCell(profile: PaperProfile): PaperProfile {
  const geometry = resolvePaperProfileGeometry(profile);
  if (geometry.layout.columns <= 1) return profile;
  return {
    ...profile,
    widthMm: geometry.layout.cellWidthMm,
    heightMm: geometry.layout.cellHeightMm,
    marginTopMm: 0,
    marginRightMm: 0,
    marginBottomMm: 0,
    marginLeftMm: 0,
    gapMm: 0,
    layout: undefined,
  };
}
