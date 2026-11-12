import { describe, expect, it } from 'vitest';
import { alignBoxes, distributeBoxes, type FieldBox } from '../model/align.js';
import { clampGroupDelta } from '../model/geometry.js';
import { getOrientedPaperGeometry } from '@printerops/shared';

const boxes: FieldBox[] = [
  { id: 'a', left: 2, top: 10, width: 10, height: 4 },
  { id: 'b', left: 20, top: 2, width: 6, height: 6 },
  { id: 'c', left: 40, top: 20, width: 20, height: 2 },
];
const move = (moves: ReturnType<typeof alignBoxes>, id: string) => moves.find((m) => m.id === id)!;

describe('align/distribute selection', () => {
  it('aligns edges and centers to the selection bounds', () => {
    expect(move(alignBoxes(boxes, 'left'), 'c').dxMm).toBe(-38);
    expect(move(alignBoxes(boxes, 'right'), 'a').dxMm).toBe(48); // 60 - 12
    expect(move(alignBoxes(boxes, 'hcenter'), 'b').dxMm).toBe(8); // 31 - 23
    expect(move(alignBoxes(boxes, 'top'), 'c').dyMm).toBe(-18);
    expect(move(alignBoxes(boxes, 'bottom'), 'b').dyMm).toBe(14); // 22 - 8
    expect(alignBoxes(boxes, 'left').every((m) => m.dyMm === 0)).toBe(true);
  });

  it('distributes equal gaps and keeps the outer bounds', () => {
    // span 2..60 = 58, sizes 36, gap = 11: a 2..12, b 23..29, c 40..60
    const moves = distributeBoxes(boxes, 'horizontal');
    expect(move(moves, 'a').dxMm).toBe(0);
    expect(move(moves, 'b').dxMm).toBe(3);
    expect(move(moves, 'c').dxMm).toBe(0);
    expect(distributeBoxes(boxes.slice(0, 2), 'vertical')).toEqual([]);
  });

  it('stops a group at the paper edge as one piece', () => {
    const geometry = getOrientedPaperGeometry({ widthMm: 50, heightMm: 30, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, orientation: 'landscape' });
    expect(clampGroupDelta([{ xMm: 1, yMm: 5 }, { xMm: 10, yMm: 5 }], -5, 0, geometry)).toEqual({ dxMm: -1, dyMm: 0 });
  });
});
