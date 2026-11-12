import {
  getOrientedPaperGeometry,
  mapPrintablePointToVisual as mapPrintablePointToVisualShared,
  mapVisualPointToPrintable as mapVisualPointToPrintableShared,
  type PaperGeometry,
} from '@printerops/shared';
import type { PaperForm } from './types.js';

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
): PaperGeometry {
  return getOrientedPaperGeometry(form);
}

/**
 * The surface fields are designed on — exactly what one print job renders.
 * A multi-column layout prints each label into one cell with no margins of its
 * own (paperProfileForCell in @printerops/domain), so the canvas shows that
 * cell, not the whole media. Single-cell profiles use the media as before.
 */
export function getDesignPaperGeometry(
  form: Parameters<typeof getVisualPaperGeometry>[0] & Pick<PaperForm, 'layout'>,
): PaperGeometry {
  const layout = form.layout;
  if (!layout || layout.columns <= 1) return getOrientedPaperGeometry(form);
  return getOrientedPaperGeometry({
    widthMm: layout.cellWidthMm,
    heightMm: layout.cellHeightMm,
    marginTopMm: 0,
    marginRightMm: 0,
    marginBottomMm: 0,
    marginLeftMm: 0,
    orientation: form.orientation,
  });
}

export function mapPrintablePointToVisual(
  xMm: number,
  yMm: number,
  geometry: Pick<PaperGeometry, 'rotated' | 'sourcePrintableHeightMm'>,
) {
  return mapPrintablePointToVisualShared(xMm, yMm, geometry);
}

export function mapVisualPointToPrintable(
  xMm: number,
  yMm: number,
  geometry: Pick<PaperGeometry, 'rotated' | 'sourcePrintableHeightMm'>,
) {
  return mapVisualPointToPrintableShared(xMm, yMm, geometry);
}

export function nudgePrintablePoint(
  xMm: number,
  yMm: number,
  deltaVisualXmm: number,
  deltaVisualYmm: number,
  geometry: PaperGeometry,
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

/**
 * Shrinks a visual move so every anchor in a group stays on the printable
 * area: the group stops at the edge as one piece instead of bunching up.
 */
export function clampGroupDelta(
  fields: { xMm: number; yMm: number }[],
  deltaVisualXmm: number,
  deltaVisualYmm: number,
  geometry: PaperGeometry,
): { dxMm: number; dyMm: number } {
  let dxMm = deltaVisualXmm;
  let dyMm = deltaVisualYmm;
  for (const field of fields) {
    const point = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
    dxMm = Math.max(-point.xMm, Math.min(geometry.printableWidthMm - point.xMm, dxMm));
    dyMm = Math.max(-point.yMm, Math.min(geometry.printableHeightMm - point.yMm, dyMm));
  }
  return { dxMm, dyMm };
}

export function clampGridSpacing(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.max(6, Math.min(72, Math.round(value)));
}

/**
 * Physical pixel density used as the browser/CSS reference for "1mm on
 * screen = 1mm on the printed sheet" (96 CSS px per inch ÷ 25.4mm per inch).
 * This is the same assumption `FieldBarcodePreview` already relies on when it
 * sizes barcodes/QR codes with raw CSS `mm` units.
 *
 * Both the compact preview and the full-screen preview auto-scale to fit
 * whatever box they're drawn in, which — left uncapped — let a small label
 * profile render *larger on screen* than a full A4 sheet. That makes the
 * canvas useless as a real print-size reference. Capping the auto-fit scale
 * at this value means paper is never inflated past real life: it can only
 * shrink to fit its container, never grow beyond true size on its own.
 */
export const CSS_PX_PER_MM = 96 / 25.4;

/** How close a preview's px-per-mm scale is to true physical size, as a whole-number percentage. */
export function actualSizePercent(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  return Math.round((scale / CSS_PX_PER_MM) * 100);
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
