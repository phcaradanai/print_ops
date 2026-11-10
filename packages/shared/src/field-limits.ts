import {
  mapPrintablePointToVisual,
  resolveRenderTransformFrame,
  transformedRectBounds,
  type PaperGeometry,
  type RenderTransform,
} from './rendering.js';

/**
 * Where a field's printed content box lands, shared by the dashboard editor
 * (apps/web) and the API so both flag exactly the same fields.
 *
 * A field prints as one content box: an explicit rectangle for barcode/QR
 * codes, one line of text for text/date/number. The box is anchored at
 * (xMm, yMm) in printable coordinates, mapped into the visual coordinate
 * system and carried through the paper's rotation/flip; the four transformed
 * corners are what must stay inside the transform frame.
 */
export interface FieldContentBox {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  align: 'left' | 'center' | 'right';
}

/** Frame-relative bounds of the content box, in millimetres. */
export interface FieldContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Largest content box that still prints at this anchor, rotation and flips. */
export interface FieldContentLimits {
  maxWidthMm: number;
  maxHeightMm: number;
}

/**
 * How far outside the paper a numeric comparison may land before it counts as
 * outside: float error from the transform, not a real overlap.
 */
export const FIELD_BOUNDS_EPSILON_MM = 0.0001;

/** Limits are quoted to a tenth of a millimetre, rounded down so they hold. */
const LIMIT_RESOLUTION_MM = 0.1;
const BISECTION_TOLERANCE_MM = LIMIT_RESOLUTION_MM / 10;

export function fieldContentBounds(
  geometry: PaperGeometry,
  transform: RenderTransform,
  box: FieldContentBox,
): FieldContentBounds {
  const frame = resolveRenderTransformFrame(geometry.widthMm, geometry.heightMm, transform);
  const point = mapPrintablePointToVisual(box.xMm, box.yMm, geometry);
  const anchorX = geometry.marginLeftMm + point.xMm;
  const anchorY = geometry.marginTopMm + point.yMm;
  const left = box.align === 'center' ? anchorX - box.widthMm / 2
    : box.align === 'right' ? anchorX - box.widthMm
      : anchorX;
  const bounds = transformedRectBounds(
    left,
    anchorY,
    box.widthMm,
    box.heightMm,
    geometry.widthMm,
    geometry.heightMm,
    transform,
  );
  return {
    minX: bounds.minX + frame.offsetX,
    minY: bounds.minY + frame.offsetY,
    maxX: bounds.maxX + frame.offsetX,
    maxY: bounds.maxY + frame.offsetY,
  };
}

/**
 * Whether a content box prints inside the paper. Paper dimensions that are not
 * finite cannot be judged here — the profile-level rules own that failure — so
 * they count as fitting rather than reporting every field at once.
 */
export function fieldContentFitsPaper(
  geometry: PaperGeometry,
  transform: RenderTransform,
  box: FieldContentBox,
  epsilon: number = FIELD_BOUNDS_EPSILON_MM,
): boolean {
  const frame = resolveRenderTransformFrame(geometry.widthMm, geometry.heightMm, transform);
  if (![geometry.widthMm, geometry.heightMm, frame.width, frame.height].every(Number.isFinite)) {
    return true;
  }
  const bounds = fieldContentBounds(geometry, transform, box);
  return bounds.minX >= -epsilon
    && bounds.minY >= -epsilon
    && bounds.maxX <= frame.width + epsilon
    && bounds.maxY <= frame.height + epsilon;
}

/**
 * Widest and tallest box the paper accepts with the other side held at the
 * field's current value. A rotated frame couples the two: at 90° a wider box
 * grows in the paper's height direction instead of its width, so the height
 * has to stay fixed while the width is searched.
 */
export function maxFieldContentMm(
  geometry: PaperGeometry,
  transform: RenderTransform,
  box: FieldContentBox,
): FieldContentLimits {
  const ceilingMm = fittingCeilingMm(geometry, transform);
  return {
    maxWidthMm: largestFittingMm(ceilingMm, (candidateMm) =>
      fieldContentFitsPaper(geometry, transform, { ...box, widthMm: candidateMm })),
    maxHeightMm: largestFittingMm(ceilingMm, (candidateMm) =>
      fieldContentFitsPaper(geometry, transform, { ...box, heightMm: candidateMm })),
  };
}

/**
 * Largest aspect-preserving box the paper accepts at this anchor, which is the
 * honest answer for a symbol that must stay square or stay a readable barcode:
 * both sides scale together, so the pair is the widest and tallest code that
 * still prints, at the ratio the field is configured with.
 */
export function maxFieldSymbolSizeMm(
  geometry: PaperGeometry,
  transform: RenderTransform,
  box: FieldContentBox,
): FieldContentLimits {
  const longestSideMm = Math.max(box.widthMm, box.heightMm);
  if (!Number.isFinite(longestSideMm) || longestSideMm <= 0) {
    return { maxWidthMm: 0, maxHeightMm: 0 };
  }
  const scale = (candidateMm: number) => candidateMm / longestSideMm;
  const sideLimitMm = largestFittingMm(fittingCeilingMm(geometry, transform), (candidateMm) =>
    fieldContentFitsPaper(geometry, transform, {
      ...box,
      widthMm: box.widthMm * scale(candidateMm),
      heightMm: box.heightMm * scale(candidateMm),
    }));
  const shorterSideMm = floorToLimitResolution(sideLimitMm * Math.min(box.widthMm, box.heightMm) / longestSideMm);
  return box.widthMm >= box.heightMm
    ? { maxWidthMm: sideLimitMm, maxHeightMm: shorterSideMm }
    : { maxWidthMm: shorterSideMm, maxHeightMm: sideLimitMm };
}

/**
 * No box side longer than this can fit, whatever the rotation: one of |cos|,
 * |sin| is at least 1/√2, so that side alone already spans the wider frame
 * axis. It bounds the search, so the bisection never has to test for overflow.
 */
function fittingCeilingMm(geometry: PaperGeometry, transform: RenderTransform): number {
  const frame = resolveRenderTransformFrame(geometry.widthMm, geometry.heightMm, transform);
  const longestFrameMm = Math.max(frame.width, frame.height);
  return Number.isFinite(longestFrameMm) ? Math.SQRT2 * longestFrameMm : 0;
}

/**
 * Bisect the largest size that still fits, for a predicate that only ever
 * shrinks with size: it holds at 0 and, by `ceilingMm`, fails at the top.
 */
function largestFittingMm(ceilingMm: number, fits: (candidateMm: number) => boolean): number {
  if (!Number.isFinite(ceilingMm) || ceilingMm <= 0 || !fits(0)) return 0;
  let low = 0;
  let high = ceilingMm;
  while (high - low > BISECTION_TOLERANCE_MM) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  // The search stops a tolerance below the boundary, so round up when that
  // tenth still fits — a field flush with the paper edge reads 97.0, not 96.9 —
  // and round down when it does not, so a quoted limit never overflows.
  const roundedMm = Math.ceil(low * 10) / 10;
  return fits(roundedMm) ? roundedMm : floorToLimitResolution(low);
}

/** Round down so a quoted limit never names a size that itself overflows. */
function floorToLimitResolution(valueMm: number): number {
  if (!Number.isFinite(valueMm) || valueMm <= 0) return 0;
  return Math.floor(valueMm * 10) / 10;
}
