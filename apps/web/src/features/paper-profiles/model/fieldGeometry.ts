import { mapPrintablePointToVisual, mapVisualPointToPrintable } from './geometry.js';
import type { VisualPaperGeometry } from './types.js';

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
  geometry: VisualPaperGeometry,
): { xMm: number; yMm: number } {
  const visualPoint = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
  const visualCenterX = Number((geometry.printableWidthMm / 2).toFixed(1));
  return mapVisualPointToPrintable(visualCenterX, visualPoint.yMm, geometry);
}

export function centerFieldAnchorVertical(
  field: { xMm: number; yMm: number },
  geometry: VisualPaperGeometry,
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
