import { staticBoxMm } from '@printerops/shared';
import type { PaperGeometry } from '@printerops/shared';
import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_BARCODE_WIDTH_MM, DEFAULT_QR_SIZE_MM } from './defaults.js';
import { clampFontSize, mapPrintablePointToVisual, mapVisualPointToPrintable } from './geometry.js';
import type { DynamicField } from './types.js';

export function resolveSelectionAfterDelete(
  fields: { id: string }[],
  deletedId: string,
  currentSelectedId: string | null,
): string | null {
  if (currentSelectedId !== deletedId) return currentSelectedId;
  const remaining = fields.filter((field) => field.id !== deletedId);
  return remaining.length > 0 ? remaining[0].id : null;
}

export function centerFieldAnchorHorizontal(
  field: { xMm: number; yMm: number },
  geometry: PaperGeometry,
): { xMm: number; yMm: number } {
  const visualPoint = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
  const visualCenterX = Number((geometry.printableWidthMm / 2).toFixed(1));
  return mapVisualPointToPrintable(visualCenterX, visualPoint.yMm, geometry);
}

export function centerFieldAnchorVertical(
  field: { xMm: number; yMm: number },
  geometry: PaperGeometry,
): { xMm: number; yMm: number } {
  const visualPoint = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
  const visualCenterY = Number((geometry.printableHeightMm / 2).toFixed(1));
  return mapVisualPointToPrintable(visualPoint.xMm, visualCenterY, geometry);
}

export function anchorTransform(align: 'left' | 'center' | 'right', _rotated: boolean): string | undefined {
  if (align === 'center') return 'translateX(-50%)';
  if (align === 'right') return 'translateX(-100%)';
  return undefined;
}

export function anchorTransformOrigin(align: 'left' | 'center' | 'right'): string {
  if (align === 'center') return 'center center';
  if (align === 'right') return 'right center';
  return 'left center';
}

/**
 * Which side of a field the resize handle sits on, and how a horizontal drag
 * changes the width: a left-anchored box grows by the drag, a centered one by
 * twice it (both sides move), a right-anchored one grows leftwards.
 */
export const RESIZE_HANDLE_WIDTH_FACTOR = { left: 1, center: 2, right: -1 } as const;

const clampMm = (value: number, max: number) => Math.round(Math.max(4, Math.min(max, value)) * 10) / 10;

/**
 * The patch a corner-handle drag of (dxMm, dyMm) applies to `start`, the field
 * as it was when the drag began. Barcodes resize freely, QR codes stay
 * square, and text scales its font size with the box height, as in Canva.
 */
export function resizeFieldPatch(
  start: DynamicField,
  dxMm: number,
  dyMm: number,
  startHeightMm: number,
): Partial<DynamicField> {
  const dwMm = dxMm * RESIZE_HANDLE_WIDTH_FACTOR[start.align];
  if (start.type === 'barcode') {
    return {
      barcodeWidthMm: clampMm((start.barcodeWidthMm ?? DEFAULT_BARCODE_WIDTH_MM) + dwMm, 100),
      barcodeHeightMm: clampMm((start.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM) + dyMm, 60),
    };
  }
  if (start.type === 'shape' || start.type === 'image') {
    // Thin lines are shapes too, so the floor is 0.2 mm, not the 4 mm symbol minimum.
    const box = staticBoxMm(start);
    const clampBox = (value: number) => Math.round(Math.max(0.2, Math.min(500, value)) * 10) / 10;
    return { boxWidthMm: clampBox(box.widthMm + dwMm), boxHeightMm: clampBox(box.heightMm + dyMm) };
  }
  if (start.type === 'qrcode') {
    return { qrSizeMm: clampMm((start.qrSizeMm ?? DEFAULT_QR_SIZE_MM) + Math.max(dwMm, dyMm), 100) };
  }
  if (startHeightMm <= 0) return {};
  return { fontSize: clampFontSize(start.fontSize * (startHeightMm + dyMm) / startHeightMm) };
}
