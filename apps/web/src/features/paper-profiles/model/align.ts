/** A field's rendered box on the upright design canvas, in mm from the printable-area origin. */
export interface FieldBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

export interface FieldMove {
  id: string;
  dxMm: number;
  dyMm: number;
}

/** Figma-style align: every box lines up with the selection's bounds. */
export function alignBoxes(boxes: FieldBox[], mode: AlignMode): FieldMove[] {
  if (boxes.length < 2) return [];
  const minLeft = Math.min(...boxes.map((b) => b.left));
  const maxRight = Math.max(...boxes.map((b) => b.left + b.width));
  const minTop = Math.min(...boxes.map((b) => b.top));
  const maxBottom = Math.max(...boxes.map((b) => b.top + b.height));
  return boxes.map((b) => {
    let dxMm = 0;
    let dyMm = 0;
    if (mode === 'left') dxMm = minLeft - b.left;
    if (mode === 'hcenter') dxMm = (minLeft + maxRight) / 2 - (b.left + b.width / 2);
    if (mode === 'right') dxMm = maxRight - (b.left + b.width);
    if (mode === 'top') dyMm = minTop - b.top;
    if (mode === 'vmiddle') dyMm = (minTop + maxBottom) / 2 - (b.top + b.height / 2);
    if (mode === 'bottom') dyMm = maxBottom - (b.top + b.height);
    return { id: b.id, dxMm, dyMm };
  });
}

/**
 * Figma-style distribute: keeps the outermost boxes in place and makes the
 * gaps between neighbours equal. Needs at least three boxes.
 */
export function distributeBoxes(boxes: FieldBox[], axis: DistributeAxis): FieldMove[] {
  if (boxes.length < 3) return [];
  const start = (b: FieldBox) => (axis === 'horizontal' ? b.left : b.top);
  const size = (b: FieldBox) => (axis === 'horizontal' ? b.width : b.height);
  const sorted = [...boxes].sort((a, b) => start(a) - start(b));
  const first = sorted[0]!;
  const last = sorted.reduce((end, b) => (start(b) + size(b) > start(end) + size(end) ? b : end), sorted[0]!);
  const span = start(last) + size(last) - start(first);
  const gap = (span - sorted.reduce((sum, b) => sum + size(b), 0)) / (sorted.length - 1);
  let cursor = start(first);
  return sorted.map((b) => {
    const delta = cursor - start(b);
    cursor += size(b) + gap;
    return { id: b.id, dxMm: axis === 'horizontal' ? delta : 0, dyMm: axis === 'vertical' ? delta : 0 };
  });
}
