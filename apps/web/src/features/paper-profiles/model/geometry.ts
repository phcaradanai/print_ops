import type { PaperForm, VisualPaperGeometry } from './types.js';

export function getVisualPaperGeometry(
  form: Pick<
    PaperForm,
    | 'widthMm'
    | 'heightMm'
    | 'marginTopMm'
    | 'marginRightMm'
    | 'marginBottomMm'
    | 'marginLeftMm'
    | 'orientation'
  >,
): VisualPaperGeometry {
  const natural = form.widthMm > form.heightMm ? 'landscape' : 'portrait';
  const rotated = natural !== form.orientation;
  const marginTopMm = rotated ? form.marginLeftMm : form.marginTopMm;
  const marginRightMm = rotated ? form.marginTopMm : form.marginRightMm;
  const marginBottomMm = rotated ? form.marginRightMm : form.marginBottomMm;
  const marginLeftMm = rotated ? form.marginBottomMm : form.marginLeftMm;
  const widthMm = rotated ? form.heightMm : form.widthMm;
  const heightMm = rotated ? form.widthMm : form.heightMm;
  const sourcePrintableWidthMm = Math.max(0, form.widthMm - form.marginLeftMm - form.marginRightMm);
  const sourcePrintableHeightMm = Math.max(0, form.heightMm - form.marginTopMm - form.marginBottomMm);
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

export function mapPrintablePointToVisual(
  xMm: number,
  yMm: number,
  geometry: Pick<VisualPaperGeometry, 'rotated' | 'sourcePrintableHeightMm'>,
) {
  if (!geometry.rotated) return { xMm, yMm };
  return { xMm: geometry.sourcePrintableHeightMm - yMm, yMm: xMm };
}

export function mapVisualPointToPrintable(
  xMm: number,
  yMm: number,
  geometry: Pick<VisualPaperGeometry, 'rotated' | 'sourcePrintableHeightMm'>,
) {
  if (!geometry.rotated) return { xMm, yMm };
  return { xMm: yMm, yMm: geometry.sourcePrintableHeightMm - xMm };
}

export function nudgePrintablePoint(
  xMm: number,
  yMm: number,
  deltaVisualXmm: number,
  deltaVisualYmm: number,
  geometry: VisualPaperGeometry,
) {
  const visualPoint = mapPrintablePointToVisual(xMm, yMm, geometry);
  const visualX = Math.max(0, Math.min(geometry.printableWidthMm, visualPoint.xMm + deltaVisualXmm));
  const visualY = Math.max(0, Math.min(geometry.printableHeightMm, visualPoint.yMm + deltaVisualYmm));
  const printablePoint = mapVisualPointToPrintable(visualX, visualY, geometry);
  return {
    xMm: Number(printablePoint.xMm.toFixed(1)),
    yMm: Number(printablePoint.yMm.toFixed(1)),
  };
}

export function clampGridSpacing(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.max(6, Math.min(72, Math.round(value)));
}

export const CANVAS_SCALE_MIN = 0.5;
export const CANVAS_SCALE_MAX = 4;
export const CANVAS_SCALE_STEP = 0.25;

export function clampPreviewZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(CANVAS_SCALE_MIN, Math.min(CANVAS_SCALE_MAX, Math.round(value * 100) / 100));
}

export function stepPreviewZoom(value: number, direction: -1 | 1): number {
  return clampPreviewZoom(value + direction * CANVAS_SCALE_STEP);
}

export function fontPointSizeToPreviewPixels(fontSizePt: number, pixelsPerMm: number): number {
  if (!Number.isFinite(fontSizePt) || !Number.isFinite(pixelsPerMm) || fontSizePt <= 0 || pixelsPerMm <= 0) {
    return 0;
  }
  return (fontSizePt * 25.4 * pixelsPerMm) / 72;
}
