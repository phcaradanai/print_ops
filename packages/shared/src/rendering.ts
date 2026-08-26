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

export function wrapHtmlWithRenderTransform(
  html: string,
  widthMm: number,
  heightMm: number,
  transform: RenderTransform,
): string {
  if (renderTransformCss(transform) === 'none') return html;
  const width = formatCssNumber(widthMm);
  const height = formatCssNumber(heightMm);
  const frameStyle = `position:relative;width:${width}mm;height:${height}mm;overflow:hidden;box-sizing:border-box;`;
  const layerStyle = `position:absolute;left:0;top:0;width:${width}mm;height:${height}mm;overflow:visible;box-sizing:border-box;transform-origin:50% 50%;transform:${renderTransformCss(transform)};`;
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
