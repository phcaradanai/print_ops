export type PaperOrientation = 'portrait' | 'landscape';

export interface PaperGeometryInput {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  orientation: PaperOrientation;
}

export function getOrientedPaperGeometry(input: PaperGeometryInput) {
  const natural = input.widthMm > input.heightMm ? 'landscape' : 'portrait';
  const rotated = natural !== input.orientation;
  const marginTopMm = rotated ? input.marginLeftMm : input.marginTopMm;
  const marginRightMm = rotated ? input.marginTopMm : input.marginRightMm;
  const marginBottomMm = rotated ? input.marginRightMm : input.marginBottomMm;
  const marginLeftMm = rotated ? input.marginBottomMm : input.marginLeftMm;
  const widthMm = rotated ? input.heightMm : input.widthMm;
  const heightMm = rotated ? input.widthMm : input.heightMm;
  const sourcePrintableWidthMm = Math.max(0, input.widthMm - input.marginLeftMm - input.marginRightMm);
  const sourcePrintableHeightMm = Math.max(0, input.heightMm - input.marginTopMm - input.marginBottomMm);
  return {
    rotated,
    widthMm,
    heightMm,
    marginTopMm,
    marginRightMm,
    marginBottomMm,
    marginLeftMm,
    sourcePrintableWidthMm,
    sourcePrintableHeightMm,
    printableWidthMm: Math.max(0, widthMm - marginLeftMm - marginRightMm),
    printableHeightMm: Math.max(0, heightMm - marginTopMm - marginBottomMm),
  };
}

export interface RenderTransform {
  /** Clockwise degrees in the screen/print coordinate system, [0, 360). */
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export interface RenderTransformOverrides {
  /** Per-job override. `undefined` means use the profile value. */
  rotate?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

export interface RenderTransformProfile {
  rotation?: number;
  /** Compatibility alias for imported/older profile data. */
  rotate?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

export interface RenderTransformBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * The normalized output frame for a transformed rectangle.
 *
 * The source rectangle is always transformed around its own center. The
 * offsets translate the resulting bounds back to a positive, top-left origin
 * without changing scale or silently cropping the corners.
 */
export interface RenderTransformFrame extends RenderTransformBounds {
  sourceWidth: number;
  sourceHeight: number;
  offsetX: number;
  offsetY: number;
}

export const IDENTITY_RENDER_TRANSFORM: RenderTransform = Object.freeze({
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
});

export const PRINT_TRANSFORM_METADATA_KEY = '_printTransform';

export function normalizeRotation(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = numeric % 360;
  return normalized < 0 ? normalized + 360 : normalized === 0 ? 0 : normalized;
}

export function isValidRotation(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360;
}

export function resolveRenderTransform(
  profile: RenderTransformProfile = {},
  overrides: RenderTransformOverrides = {},
): RenderTransform {
  return {
    rotation: normalizeRotation(overrides.rotate ?? profile.rotation ?? profile.rotate ?? 0),
    flipHorizontal: overrides.flipHorizontal ?? Boolean(profile.flipHorizontal),
    flipVertical: overrides.flipVertical ?? Boolean(profile.flipVertical),
  };
}

export function renderTransformCss(transform: RenderTransform): string {
  const rotation = formatCssNumber(normalizeRotation(transform.rotation));
  const horizontal = transform.flipHorizontal ? -1 : 1;
  const vertical = transform.flipVertical ? -1 : 1;
  if (rotation === '0' && horizontal === 1 && vertical === 1) return 'none';
  // CSS applies the scale functions before rotate, yielding R * S. The point
  // helpers below intentionally use the same order.
  return `rotate(${rotation}deg) scaleX(${horizontal}) scaleY(${vertical})`;
}

export function transformPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  transform: RenderTransform,
) {
  const cx = width / 2;
  const cy = height / 2;
  let dx = x - cx;
  let dy = y - cy;
  if (transform.flipHorizontal) dx = -dx;
  if (transform.flipVertical) dy = -dy;
  const radians = normalizeRotation(transform.rotation) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: cx + cos * dx - sin * dy,
    y: cy + sin * dx + cos * dy,
  };
}

export function inverseTransformPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  transform: RenderTransform,
) {
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const radians = normalizeRotation(transform.rotation) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let sourceX = cos * dx + sin * dy;
  let sourceY = -sin * dx + cos * dy;
  if (transform.flipHorizontal) sourceX = -sourceX;
  if (transform.flipVertical) sourceY = -sourceY;
  return { x: cx + sourceX, y: cy + sourceY };
}
export function inverseTransformVector(
  x: number,
  y: number,
  transform: RenderTransform,
) {
  const radians = normalizeRotation(transform.rotation) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let sourceX = cos * x + sin * y;
  let sourceY = -sin * x + cos * y;
  if (transform.flipHorizontal) sourceX = -sourceX;
  if (transform.flipVertical) sourceY = -sourceY;
  return { x: sourceX, y: sourceY };
}


export function transformedBounds(width: number, height: number, transform: RenderTransform) {
  const points = [
    transformPoint(0, 0, width, height, transform),
    transformPoint(width, 0, width, height, transform),
    transformPoint(width, height, width, height, transform),
    transformPoint(0, height, width, height, transform),
  ];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function resolveRenderTransformFrame(
  width: number,
  height: number,
  transform: RenderTransform,
): RenderTransformFrame {
  const bounds = transformedBounds(width, height, transform);
  const minX = stabilizeTransformNumber(bounds.minX);
  const minY = stabilizeTransformNumber(bounds.minY);
  const maxX = stabilizeTransformNumber(bounds.maxX);
  const maxY = stabilizeTransformNumber(bounds.maxY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: stabilizeTransformNumber(maxX - minX),
    height: stabilizeTransformNumber(maxY - minY),
    sourceWidth: width,
    sourceHeight: height,
    offsetX: -minX,
    offsetY: -minY,
  };
}

function stabilizeTransformNumber(value: number): number {
  if (Math.abs(value) < 1e-10) return 0;
  const nearestInteger = Math.round(value);
  return Math.abs(value - nearestInteger) < 1e-10 ? nearestInteger : value;
}

export function mapPrintablePointToVisual(
  xMm: number,
  yMm: number,
  geometry: Pick<ReturnType<typeof getOrientedPaperGeometry>, 'rotated' | 'sourcePrintableHeightMm'>,
) {
  if (!geometry.rotated) return { xMm, yMm };
  return { xMm: geometry.sourcePrintableHeightMm - yMm, yMm: xMm };
}

export function mapVisualPointToPrintable(
  xMm: number,
  yMm: number,
  geometry: Pick<ReturnType<typeof getOrientedPaperGeometry>, 'rotated' | 'sourcePrintableHeightMm'>,
) {
  if (!geometry.rotated) return { xMm, yMm };
  return { xMm: yMm, yMm: geometry.sourcePrintableHeightMm - xMm };
}

export function transformedRectBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  transform: RenderTransform,
): RenderTransformBounds {
  const points = [
    transformPoint(x, y, sourceWidth, sourceHeight, transform),
    transformPoint(x + width, y, sourceWidth, sourceHeight, transform),
    transformPoint(x + width, y + height, sourceWidth, sourceHeight, transform),
    transformPoint(x, y + height, sourceWidth, sourceHeight, transform),
  ];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Conservative per-side QR quiet-zone allowance. The smallest QR symbol is
 * version 1 (21 modules), so four quiet-zone modules can never exceed this
 * ratio of the configured dark-symbol side. Callers use it for validation;
 * renderers can still use the exact module count for the final output.
 */
export function qrQuietZoneUpperBoundMm(symbolSizeMm: number): number {
  if (!Number.isFinite(symbolSizeMm) || symbolSizeMm <= 0) return 0;
  return (symbolSizeMm * 4) / 21;
}

export function wrapHtmlWithRenderTransform(
  html: string,
  widthMm: number,
  heightMm: number,
  transform: RenderTransform,
): string {
  if (renderTransformCss(transform) === 'none') return html;
  const frame = resolveRenderTransformFrame(widthMm, heightMm, transform);
  const width = formatCssNumber(widthMm);
  const height = formatCssNumber(heightMm);
  const frameWidth = formatCssNumber(frame.width);
  const frameHeight = formatCssNumber(frame.height);
  const offsetX = formatCssNumber(frame.offsetX);
  const offsetY = formatCssNumber(frame.offsetY);
  const frameStyle = `position:relative;width:${frameWidth}mm;height:${frameHeight}mm;overflow:hidden;box-sizing:border-box;`;
  const layerStyle = `position:absolute;left:${offsetX}mm;top:${offsetY}mm;width:${width}mm;height:${height}mm;overflow:visible;box-sizing:border-box;transform-origin:50% 50%;transform:${renderTransformCss(transform)};`;
  return `<div data-printops-transform-frame="true" style="${frameStyle}"><div data-printops-transform-layer="true" style="${layerStyle}">${html}</div></div>`;
}

export function readRenderTransformOverrides(
  metadata: Record<string, unknown> | undefined,
): RenderTransformOverrides {
  const value = metadata?.[PRINT_TRANSFORM_METADATA_KEY];
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  return {
    ...(isValidRotation(source.rotate) ? { rotate: source.rotate } : {}),
    ...(typeof source.flipHorizontal === 'boolean' ? { flipHorizontal: source.flipHorizontal } : {}),
    ...(typeof source.flipVertical === 'boolean' ? { flipVertical: source.flipVertical } : {}),
  };
}

export function withRenderTransformOverrides(
  metadata: Record<string, unknown> | undefined,
  overrides: RenderTransformOverrides,
): Record<string, unknown> {
  const hasOverride = overrides.rotate !== undefined
    || overrides.flipHorizontal !== undefined
    || overrides.flipVertical !== undefined;
  if (!hasOverride) return metadata ?? {};
  return {
    ...(metadata ?? {}),
    [PRINT_TRANSFORM_METADATA_KEY]: {
      ...(isValidRotation(overrides.rotate) ? { rotate: overrides.rotate } : {}),
      ...(typeof overrides.flipHorizontal === 'boolean' ? { flipHorizontal: overrides.flipHorizontal } : {}),
      ...(typeof overrides.flipVertical === 'boolean' ? { flipVertical: overrides.flipVertical } : {}),
    },
  };
}

function formatCssNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(6)).toString();
}
