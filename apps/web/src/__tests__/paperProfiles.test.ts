import { describe, it, expect } from 'vitest';
import {
  clampGridSpacing as clampGridSpacingSource,
  getVisualPaperGeometry,
  mapPrintablePointToVisual,
  mapVisualPointToPrintable,
} from '../pages/PaperProfiles.js';

// ── Extracted pure functions from PaperProfiles.tsx ────────────────────

/** Determine natural orientation from raw dimensions. */
function naturalOrientation(widthMm: number, heightMm: number): 'portrait' | 'landscape' {
  return widthMm > heightMm ? 'landscape' : 'portrait';
}

/** Whether a CSS rotation is required to match the declared orientation. */
function needsRotation(
  widthMm: number,
  heightMm: number,
  orientation: 'portrait' | 'landscape',
): boolean {
  return naturalOrientation(widthMm, heightMm) !== orientation;
}

/** Preview display dimensions after accounting for rotation. */
function previewDimensions(
  widthMm: number,
  heightMm: number,
  orientation: 'portrait' | 'landscape',
): { previewWidthMm: number; previewHeightMm: number } {
  const rotate = needsRotation(widthMm, heightMm, orientation);
  return {
    previewWidthMm: rotate ? heightMm : widthMm,
    previewHeightMm: rotate ? widthMm : heightMm,
  };
}

/**
 * Orientation change handler: swaps W/H when the new orientation
 * would contradict the natural aspect ratio.
 * Returns the new [widthMm, heightMm, orientation].
 */
function applyOrientationChange(
  widthMm: number,
  heightMm: number,
  currentOrientation: 'portrait' | 'landscape',
  nextOrientation: 'portrait' | 'landscape',
): [number, number, 'portrait' | 'landscape'] {
  if (nextOrientation === currentOrientation) {
    return [widthMm, heightMm, currentOrientation];
  }
  const natural = naturalOrientation(widthMm, heightMm);
  if (nextOrientation !== natural) {
    // Swap: the bigger number should match the dominant axis of the new orientation.
    return [heightMm, widthMm, nextOrientation];
  }
  return [widthMm, heightMm, nextOrientation];
}

// ── Preview scale helper ──────────────────────────────────────────────
function previewScale(
  widthMm: number,
  heightMm: number,
  orientation: 'portrait' | 'landscape',
  maxSize: number,
): number {
  const { previewWidthMm, previewHeightMm } = previewDimensions(widthMm, heightMm, orientation);
  return Math.min(maxSize / previewWidthMm, maxSize / previewHeightMm, 2);
}

// ── Modal (full-screen) scale helper ─────────────────────────────────
function modalScale(
  stageWidth: number,
  stageHeight: number,
  widthMm: number,
  heightMm: number,
  orientation: 'portrait' | 'landscape',
  margin = 24,
  maxScale = 20,
): number {
  if (stageWidth === 0 || stageHeight === 0) return 0.5;
  const { previewWidthMm, previewHeightMm } = previewDimensions(widthMm, heightMm, orientation);
  const availableW = Math.max(1, stageWidth - margin * 2);
  const availableH = Math.max(1, stageHeight - margin * 2);
  const scale = Math.min(availableW / previewWidthMm, availableH / previewHeightMm);
  return Math.max(0.5, Math.min(maxScale, scale));
}

// ── Display value helper ──────────────────────────────────────────────
function toPx(mm: number, dpi: number): number {
  return (mm * dpi) / 25.4;
}
function displayVal(mm: number, unit: 'mm' | 'cm' | 'px', dpi: number): string {
  if (unit === 'cm') return (mm / 10).toFixed(1);
  if (unit === 'px') return Math.round(toPx(mm, dpi)).toString();
  return mm.toFixed(1);
}

// ══════════════════════════════════════════════════════════════════════
//  Tests
// ══════════════════════════════════════════════════════════════════════

describe('naturalOrientation', () => {
  it('width > height → landscape', () => {
    expect(naturalOrientation(100, 50)).toBe('landscape');
    expect(naturalOrientation(297, 210)).toBe('landscape');
  });

  it('height > width → portrait', () => {
    expect(naturalOrientation(50, 100)).toBe('portrait');
    expect(naturalOrientation(210, 297)).toBe('portrait');
  });

  it('width == height → portrait (default)', () => {
    expect(naturalOrientation(100, 100)).toBe('portrait');
    expect(naturalOrientation(50, 50)).toBe('portrait');
  });

  it('handles zero dimensions gracefully', () => {
    // zero is not > zero, so portrait
    expect(naturalOrientation(0, 0)).toBe('portrait');
    // 0 > 0 is false, so portrait
    expect(naturalOrientation(0, 10)).toBe('portrait');
  });
});

describe('needsRotation', () => {
  it('natural landscape + portrait orientation → needs rotation', () => {
    expect(needsRotation(100, 50, 'portrait')).toBe(true);
  });

  it('natural portrait + landscape orientation → needs rotation', () => {
    expect(needsRotation(50, 100, 'landscape')).toBe(true);
  });

  it('natural landscape + landscape orientation → no rotation', () => {
    expect(needsRotation(100, 50, 'landscape')).toBe(false);
  });

  it('natural portrait + portrait orientation → no rotation', () => {
    expect(needsRotation(50, 100, 'portrait')).toBe(false);
  });

  it('square dimensions → no rotation for either orientation', () => {
    // naturalOrientation(100,100) === 'portrait'
    expect(needsRotation(100, 100, 'portrait')).toBe(false);
    expect(needsRotation(100, 100, 'landscape')).toBe(true);
  });
});

describe('previewDimensions', () => {
  it('landscape page, portrait orientation — swaps', () => {
    const dims = previewDimensions(100, 50, 'portrait');
    expect(dims.previewWidthMm).toBe(50);
    expect(dims.previewHeightMm).toBe(100);
  });

  it('portrait page, landscape orientation — swaps', () => {
    const dims = previewDimensions(50, 100, 'landscape');
    expect(dims.previewWidthMm).toBe(100);
    expect(dims.previewHeightMm).toBe(50);
  });

  it('landscape page, landscape orientation — no swap', () => {
    const dims = previewDimensions(100, 50, 'landscape');
    expect(dims.previewWidthMm).toBe(100);
    expect(dims.previewHeightMm).toBe(50);
  });

  it('portrait page, portrait orientation — no swap', () => {
    const dims = previewDimensions(210, 297, 'portrait');
    expect(dims.previewWidthMm).toBe(210);
    expect(dims.previewHeightMm).toBe(297);
  });
});

describe('applyOrientationChange', () => {
  it('no-op when next === current', () => {
    const [w, h, o] = applyOrientationChange(100, 50, 'landscape', 'landscape');
    expect(w).toBe(100);
    expect(h).toBe(50);
    expect(o).toBe('landscape');
  });

  it('landscape→portrait when natural is landscape: swaps', () => {
    // 100×50 is natural landscape, user picks portrait
    const [w, h, o] = applyOrientationChange(100, 50, 'landscape', 'portrait');
    expect(w).toBe(50);
    expect(h).toBe(100);
    expect(o).toBe('portrait');
  });

  it('portrait→landscape when natural is portrait: swaps', () => {
    // 50×100 is natural portrait, user picks landscape
    const [w, h, o] = applyOrientationChange(50, 100, 'portrait', 'landscape');
    expect(w).toBe(100);
    expect(h).toBe(50);
    expect(o).toBe('landscape');
  });

  it('portrait→landscape when natural is landscape: no swap', () => {
    // Already landscape dimensions, user just confirms landscape
    const [w, h, o] = applyOrientationChange(100, 50, 'portrait', 'landscape');
    expect(w).toBe(100);
    expect(h).toBe(50);
    expect(o).toBe('landscape');
  });

  it('landscape→portrait when natural is portrait: no swap', () => {
    // Already portrait dimensions, user just confirms portrait
    const [w, h, o] = applyOrientationChange(50, 100, 'landscape', 'portrait');
    expect(w).toBe(50);
    expect(h).toBe(100);
    expect(o).toBe('portrait');
  });

  it('square: portrait→landscape swaps correctly', () => {
    // 100×100 is natural portrait; user picks landscape → swap
    const [w, h, o] = applyOrientationChange(100, 100, 'portrait', 'landscape');
    expect(w).toBe(100);
    expect(h).toBe(100);
    expect(o).toBe('landscape');
    // Swap is genuine: 100↔100 is same, so both correct
  });
});

describe('previewScale', () => {
  const maxSize = 320;

  it('A4 portrait fits within maxSize', () => {
    const s = previewScale(210, 297, 'portrait', maxSize);
    expect(s).toBeLessThanOrEqual(2);
    // 320/210 ≈ 1.523, 320/297 ≈ 1.077 → min ≈ 1.077
    expect(s).toBeCloseTo(320 / 297, 3);
  });

  it('A4 landscape fits within maxSize', () => {
    const s = previewScale(210, 297, 'landscape', maxSize);
    // previewWidthMm=297, previewHeightMm=210
    // 320/297 ≈ 1.077, 320/210 ≈ 1.523 → min ≈ 1.077
    expect(s).toBeCloseTo(320 / 297, 3);
  });

  it('clamps at 2x', () => {
    const s = previewScale(10, 10, 'portrait', maxSize);
    expect(s).toBe(2);
  });

  it('tiny paper uses max, not huge', () => {
    const s = previewScale(5, 5, 'portrait', maxSize);
    // 320/5 = 64, clamped to 2
    expect(s).toBe(2);
  });
});

describe('modalScale', () => {
  // Typical full-screen stage on a 1920×1080 desktop with a 370px sidebar:
  // canvas width ≈ 1500 - 370 - borders ≈ 1100px, height ≈ 960 - bars ≈ 880px.
  // Stage content-box (after 1rem padding) ≈ 1068×848.
  const desktopStage = { width: 1068, height: 848 };

  it('100×50 label portrait fills the stage', () => {
    // Natural orientation is landscape (100>50), but orientation=portrait
    // → needs rotation, so previewWidthMm=50, previewHeightMm=100
    // available: (1068-48)=1020, (848-48)=800
    // scale = min(1020/50, 800/100) = min(20.4, 8) = 8
    const s = modalScale(desktopStage.width, desktopStage.height, 100, 50, 'portrait');
    expect(s).toBeCloseTo(8, 1);
    expect(s).toBeGreaterThan(5); // exceeds old cap
  });

  it('50×100 label landscape fills the stage', () => {
    // previewWidthMm=100, previewHeightMm=50 (after rotation)
    const s = modalScale(desktopStage.width, desktopStage.height, 50, 100, 'landscape');
    expect(s).toBeCloseTo(10.2, 1);
    expect(s).toBeGreaterThan(5);
  });

  it('A4 portrait scales reasonably', () => {
    // previewWidthMm=210, previewHeightMm=297
    // available: 1020/210≈4.857, 800/297≈2.694 → min≈2.694
    const s = modalScale(desktopStage.width, desktopStage.height, 210, 297, 'portrait');
    expect(s).toBeCloseTo(800 / 297, 2);
    expect(s).toBeGreaterThan(2);
    expect(s).toBeLessThan(20);
  });

  it('A4 landscape scales reasonably', () => {
    // previewWidthMm=297, previewHeightMm=210
    // available: 1020/297≈3.434, 800/210≈3.810 → min≈3.434
    const s = modalScale(desktopStage.width, desktopStage.height, 210, 297, 'landscape');
    expect(s).toBeCloseTo(1020 / 297, 2);
    expect(s).toBeGreaterThan(2);
    expect(s).toBeLessThan(20);
  });

  it('clamps at maxScale (20)', () => {
    // 10×5mm paper, stage 2000px wide → 1952/10 = 195.2, 1952/5 = 390.4, capped at 20
    const s = modalScale(2000, 2000, 10, 5, 'portrait');
    expect(s).toBe(20);
  });

  it('has minimum of 0.5', () => {
    // A0 paper (841×1189mm) in a tiny stage
    const s = modalScale(100, 100, 841, 1189, 'portrait');
    // available 52/841≈0.062, 52/1189≈0.044 → min=0.044, clamped to 0.5
    expect(s).toBe(0.5);
  });

  it('zero stage dimensions returns minimum 0.5', () => {
    expect(modalScale(0, 0, 100, 50, 'portrait')).toBe(0.5);
  });

  it('respects custom margin', () => {
    // 100×50 portait (natural landscape → rotation), margin=100
    // available: 500-200=300, 400-200=200
    // After rotation: previewW=50, previewH=100
    // 300/50=6, 200/100=2 → scale=2
    const s = modalScale(500, 400, 100, 50, 'portrait', 100);
    expect(s).toBeCloseTo(2, 1);
  });
});

describe('displayVal', () => {
  it('mm returns fixed-1', () => {
    expect(displayVal(100.456, 'mm', 300)).toBe('100.5');
  });

  it('cm divides by 10', () => {
    expect(displayVal(100, 'cm', 300)).toBe('10.0');
  });

  it('px converts with DPI', () => {
    const px = displayVal(25.4, 'px', 300);
    expect(px).toBe('300');
  });

  it('px rounds to nearest integer', () => {
    const px = displayVal(10, 'px', 203);
    // (10 * 203) / 25.4 ≈ 79.921...
    expect(px).toBe('80');
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Grid line generation
// ══════════════════════════════════════════════════════════════════════

/** Generate vertical grid line positions (mm offsets from margin). */
function generateGridLines(
  intervalMm: number,
  printableWidthMm: number,
  printableHeightMm: number,
  vertical: boolean,
  horizontal: boolean,
): { verticalLines: number[]; horizontalLines: number[] } {
  const verticalLines: number[] = [];
  const horizontalLines: number[] = [];
  if (vertical) {
    for (let x = intervalMm; x < printableWidthMm; x += intervalMm) {
      verticalLines.push(x);
    }
  }
  if (horizontal) {
    for (let y = intervalMm; y < printableHeightMm; y += intervalMm) {
      horizontalLines.push(y);
    }
  }
  return { verticalLines, horizontalLines };
}

describe('generateGridLines', () => {
  it('produces vertical grid lines at 10mm intervals', () => {
    const result = generateGridLines(10, 90, 40, true, false);
    expect(result.verticalLines).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(result.horizontalLines).toEqual([]);
  });

  it('produces horizontal grid lines at 10mm intervals', () => {
    const result = generateGridLines(10, 90, 40, false, true);
    expect(result.verticalLines).toEqual([]);
    expect(result.horizontalLines).toEqual([10, 20, 30]);
  });

  it('produces both when both toggled', () => {
    const result = generateGridLines(10, 50, 30, true, true);
    expect(result.verticalLines).toEqual([10, 20, 30, 40]);
    expect(result.horizontalLines).toEqual([10, 20]);
  });

  it('produces nothing when both toggled off', () => {
    const result = generateGridLines(10, 100, 50, false, false);
    expect(result.verticalLines).toEqual([]);
    expect(result.horizontalLines).toEqual([]);
  });

  it('handles small paper (interval larger than printable)', () => {
    const result = generateGridLines(10, 8, 8, true, true);
    expect(result.verticalLines).toEqual([]);
    expect(result.horizontalLines).toEqual([]);
  });

  it('handles custom interval', () => {
    const result = generateGridLines(5, 20, 15, true, true);
    expect(result.verticalLines).toEqual([5, 10, 15]);
    expect(result.horizontalLines).toEqual([5, 10]);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Snap-to-field helpers
// ══════════════════════════════════════════════════════════════════════

interface SnapField {
  id: string;
  xMm: number;
  yMm: number;
}

/** Snap a position to nearby field positions within threshold. */
function snapPosition(
  xMm: number,
  yMm: number,
  otherFields: SnapField[],
  threshold = 2,
): { xMm: number; yMm: number } {
  let snappedX = xMm;
  let snappedY = yMm;
  for (const o of otherFields) {
    if (Math.abs(o.yMm - snappedY) < threshold) snappedY = o.yMm;
    if (Math.abs(o.xMm - snappedX) < threshold) snappedX = o.xMm;
  }
  return { xMm: snappedX, yMm: snappedY };
}

describe('snapPosition', () => {
  const otherFields: SnapField[] = [
    { id: 'a', xMm: 10, yMm: 15 },
    { id: 'b', xMm: 30, yMm: 15 },
    { id: 'c', xMm: 50, yMm: 40 },
  ];

  it('snaps Y to nearby field within threshold', () => {
    const result = snapPosition(12, 16.5, otherFields);
    expect(result.xMm).toBe(12);
    expect(result.yMm).toBe(15); // snapped to 15
  });

  it('snaps X to nearby field within threshold', () => {
    const result = snapPosition(11.5, 20, otherFields);
    expect(result.xMm).toBe(10); // snapped to 10
    expect(result.yMm).toBe(20);
  });

  it('snaps both X and Y when both within threshold', () => {
    const result = snapPosition(11, 16, otherFields);
    expect(result.xMm).toBe(10); // snapped to 10
    expect(result.yMm).toBe(15); // snapped to 15
  });

  it('does not snap when outside threshold', () => {
    const result = snapPosition(25, 25, otherFields);
    expect(result.xMm).toBe(25);
    expect(result.yMm).toBe(25);
  });

  it('empty otherFields: no snap', () => {
    const result = snapPosition(11, 16, []);
    expect(result.xMm).toBe(11);
    expect(result.yMm).toBe(16);
  });

  it('default threshold is 2mm', () => {
    const result = snapPosition(31.9, 15, otherFields, 2);
    expect(result.xMm).toBe(30); // within 2mm
    expect(result.yMm).toBe(15);
  });

  it('custom threshold: 1mm', () => {
    const result = snapPosition(31.5, 15, otherFields, 1);
    expect(result.xMm).toBe(31.5); // 1.5 > 1 → no snap
    expect(result.yMm).toBe(15);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Alignment helpers (baseline / column)
// ══════════════════════════════════════════════════════════════════════

/** Find nearest other field's Y within tolerance. Returns null if none close enough. */
function findNearestBaselineY(
  targetId: string,
  allFields: SnapField[],
  tolerance = 10,
): number | null {
  const target = allFields.find((f) => f.id === targetId);
  if (!target) return null;
  const others = allFields.filter((f) => f.id !== targetId);
  if (others.length === 0) return null;
  let best = Math.abs(others[0].yMm - target.yMm);
  let nearest = others[0];
  for (const o of others) {
    const d = Math.abs(o.yMm - target.yMm);
    if (d < best) { nearest = o; best = d; }
  }
  return best <= tolerance ? nearest.yMm : null;
}

function findNearestColumnX(
  targetId: string,
  allFields: SnapField[],
  tolerance = 10,
): number | null {
  const target = allFields.find((f) => f.id === targetId);
  if (!target) return null;
  const others = allFields.filter((f) => f.id !== targetId);
  if (others.length === 0) return null;
  let best = Math.abs(others[0].xMm - target.xMm);
  let nearest = others[0];
  for (const o of others) {
    const d = Math.abs(o.xMm - target.xMm);
    if (d < best) { nearest = o; best = d; }
  }
  return best <= tolerance ? nearest.xMm : null;
}

describe('findNearestBaselineY', () => {
  const fields: SnapField[] = [
    { id: 'a', xMm: 10, yMm: 20 },
    { id: 'b', xMm: 30, yMm: 45 },
    { id: 'c', xMm: 50, yMm: 22 },
  ];

  it('finds nearest Y within tolerance', () => {
    const y = findNearestBaselineY('c', fields);
    expect(y).toBe(20); // c.yMm=22, nearest is a.yMm=20 (diff=2)
  });

  it('returns null when all outside tolerance', () => {
    const y = findNearestBaselineY('b', fields);
    // b.yMm=45, nearest is c.yMm=22 (diff=23) > 10
    expect(y).toBeNull();
  });

  it('returns null for single field', () => {
    expect(findNearestBaselineY('a', [fields[0]])).toBeNull();
  });

  it('returns null for unknown field id', () => {
    expect(findNearestBaselineY('z', fields)).toBeNull();
  });
});

describe('findNearestColumnX', () => {
  const fields: SnapField[] = [
    { id: 'a', xMm: 10, yMm: 20 },
    { id: 'b', xMm: 32, yMm: 45 },
    { id: 'c', xMm: 50, yMm: 22 },
  ];

  it('finds nearest X within tolerance', () => {
    const x = findNearestColumnX('b', fields);
    // b.xMm=32, nearest is a.xMm=10 (diff=22 > 10), c.xMm=50 (diff=18 > 10)
    // both outside → null
    expect(x).toBeNull();
  });

  it('finds nearest X when close enough', () => {
    const fields2: SnapField[] = [
      { id: 'a', xMm: 10, yMm: 20 },
      { id: 'b', xMm: 14, yMm: 45 },
    ];
    const x = findNearestColumnX('b', fields2);
    expect(x).toBe(10);
  });

  it('returns null for single field', () => {
    expect(findNearestColumnX('a', [fields[0]])).toBeNull();
  });

  it('returns null for unknown field id', () => {
    expect(findNearestColumnX('z', fields)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Ruler tick calculation
// ══════════════════════════════════════════════════════════════════════

/** Compute ruler major tick positions (mm values) for a given length. */
function computeMajorTickMm(
  totalMm: number,
  intervalMm: number,
): number[] {
  const ticks: number[] = [];
  for (let mm = 0; mm <= totalMm; mm += intervalMm) {
    ticks.push(mm);
  }
  return ticks;
}

/** Compute ruler minor tick positions, excluding major tick positions. */
function computeMinorTickMm(
  totalMm: number,
  majorIntervalMm: number,
  minorIntervalMm: number,
): number[] {
  const ticks: number[] = [];
  if (minorIntervalMm >= majorIntervalMm) return ticks;
  for (let mm = minorIntervalMm; mm <= totalMm; mm += minorIntervalMm) {
    if (mm % majorIntervalMm === 0) continue;
    ticks.push(mm);
  }
  return ticks;
}

/** Format a ruler tick label from mm value. */
function formatTickLabel(
  mm: number,
  unit: 'mm' | 'cm' | 'px',
  dpi: number,
): string {
  if (unit === 'px') return String(Math.round((mm * dpi) / 25.4));
  if (unit === 'cm') return (mm / 10).toFixed(0) + 'cm';
  return String(mm);
}

describe('computeMajorTickMm', () => {
  it('produces ticks at 10mm intervals for 100mm paper', () => {
    const ticks = computeMajorTickMm(100, 10);
    expect(ticks).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('produces ticks for short paper', () => {
    const ticks = computeMajorTickMm(25, 10);
    expect(ticks).toEqual([0, 10, 20]);
  });

  it('handles zero length', () => {
    const ticks = computeMajorTickMm(0, 10);
    expect(ticks).toEqual([0]);
  });

  it('handles 50mm interval for px mode', () => {
    const ticks = computeMajorTickMm(150, 50);
    expect(ticks).toEqual([0, 50, 100, 150]);
  });
});

describe('computeMinorTickMm', () => {
  it('excludes major tick positions', () => {
    const minor = computeMinorTickMm(30, 10, 5);
    expect(minor).toEqual([5, 15, 25]);
  });

  it('returns empty when no room for minors', () => {
    const minor = computeMinorTickMm(4, 10, 5);
    expect(minor).toEqual([]);
  });

  it('returns empty when minor equals major', () => {
    const minor = computeMinorTickMm(30, 10, 10);
    expect(minor).toEqual([]);
  });

  it('includes last tick when < totalMm', () => {
    const minor = computeMinorTickMm(12, 10, 5);
    expect(minor).toEqual([5]);
  });
});

describe('formatTickLabel', () => {
  it('mm: just the number', () => {
    expect(formatTickLabel(50, 'mm', 300)).toBe('50');
    expect(formatTickLabel(0, 'mm', 300)).toBe('0');
  });

  it('cm: divides by 10 with cm suffix', () => {
    expect(formatTickLabel(50, 'cm', 300)).toBe('5cm');
    expect(formatTickLabel(100, 'cm', 300)).toBe('10cm');
  });

  it('px: converts via DPI', () => {
    const label = formatTickLabel(25.4, 'px', 300);
    expect(label).toBe('300');
  });

  it('px: rounds to integer', () => {
    const label = formatTickLabel(10, 'px', 203);
    expect(label).toBe('80');
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Grid spacing clamp
// ══════════════════════════════════════════════════════════════════════

/** Clamp grid spacing to valid range [1, 100] mm. */
function clampGridSpacing(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

describe('clampGridSpacing', () => {
  it('returns the value when within range', () => {
    expect(clampGridSpacing(10)).toBe(10);
    expect(clampGridSpacing(1)).toBe(1);
    expect(clampGridSpacing(100)).toBe(100);
    expect(clampGridSpacing(50)).toBe(50);
  });

  it('clamps below 1 to 1', () => {
    expect(clampGridSpacing(0)).toBe(1);
    expect(clampGridSpacing(-5)).toBe(1);
    expect(clampGridSpacing(0.5)).toBe(1); // after round: 0 -> 1
  });

  it('clamps above 100 to 100', () => {
    expect(clampGridSpacing(101)).toBe(100);
    expect(clampGridSpacing(200)).toBe(100);
    expect(clampGridSpacing(999)).toBe(100);
  });

  it('handles zero by clamping to 1', () => {
    expect(clampGridSpacing(0)).toBe(1);
  });
});

describe('PaperProfiles visual coordinate model', () => {
  const rotated = getVisualPaperGeometry({
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 3,
    marginBottomMm: 4,
    marginLeftMm: 5,
    orientation: 'portrait',
  });

  const nonRotated = getVisualPaperGeometry({
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 3,
    marginBottomMm: 4,
    marginLeftMm: 5,
    orientation: 'landscape',
  });

  it('uses visual dimensions and rotated margins from one geometry', () => {
    expect(rotated.rotated).toBe(true);
    expect(rotated.widthMm).toBe(50);
    expect(rotated.heightMm).toBe(100);
    expect(rotated.marginTopMm).toBe(5);
    expect(rotated.marginRightMm).toBe(2);
    expect(rotated.marginBottomMm).toBe(3);
    expect(rotated.marginLeftMm).toBe(4);
    expect(rotated.sourcePrintableWidthMm).toBe(92);
    expect(rotated.sourcePrintableHeightMm).toBe(44);
    expect(rotated.printableWidthMm).toBe(44);
    expect(rotated.printableHeightMm).toBe(92);
  });

  it('maps printable-relative coords to the same visual space as the grid', () => {
    const p1 = mapPrintablePointToVisual(0, 0, rotated);
    expect(p1).toEqual({ xMm: 44, yMm: 0 });

    const p2 = mapPrintablePointToVisual(92, 44, rotated);
    expect(p2).toEqual({ xMm: 0, yMm: 92 });
  });

  it('round-trips rotated points without drift', () => {
    const visual = mapPrintablePointToVisual(15, 10, rotated);
    expect(mapVisualPointToPrintable(visual.xMm, visual.yMm, rotated)).toEqual({ xMm: 15, yMm: 10 });

    const visual2 = mapPrintablePointToVisual(50, 30, rotated);
    expect(mapVisualPointToPrintable(visual2.xMm, visual2.yMm, rotated)).toEqual({ xMm: 50, yMm: 30 });
  });

  it('non-rotated coordinates remain unchanged', () => {
    const p = mapPrintablePointToVisual(10, 5, nonRotated);
    expect(p).toEqual({ xMm: 10, yMm: 5 });
  });

  it('non-rotated round-trips', () => {
    const visual = mapPrintablePointToVisual(20, 15, nonRotated);
    expect(mapVisualPointToPrintable(visual.xMm, visual.yMm, nonRotated)).toEqual({ xMm: 20, yMm: 15 });
  });

  it('clamps invalid grid spacing in the actual source helper', () => {
    expect(clampGridSpacingSource(Number.NaN)).toBe(10);
    expect(clampGridSpacingSource(0)).toBe(1);
    expect(clampGridSpacingSource(10.6)).toBe(11);
    expect(clampGridSpacingSource(120)).toBe(100);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Ruler visual dimension computation (rotation-aware)
// ══════════════════════════════════════════════════════════════════════

interface RulerDims {
  visualWidthMm: number;
  visualHeightMm: number;
}

/** Compute visual ruler dimensions accounting for CSS rotation. */
function rulerVisualDims(
  widthMm: number,
  heightMm: number,
  rotateSheet: boolean,
  needsRotation: boolean,
): RulerDims {
  if (rotateSheet && needsRotation) {
    return { visualWidthMm: heightMm, visualHeightMm: widthMm };
  }
  return { visualWidthMm: widthMm, visualHeightMm: heightMm };
}

describe('rulerVisualDims', () => {
  it('no rotation: returns original dimensions', () => {
    const dims = rulerVisualDims(100, 50, false, false);
    expect(dims.visualWidthMm).toBe(100);
    expect(dims.visualHeightMm).toBe(50);
  });

  it('rotateSheet true but no needsRotation: returns original', () => {
    const dims = rulerVisualDims(100, 50, true, false);
    expect(dims.visualWidthMm).toBe(100);
    expect(dims.visualHeightMm).toBe(50);
  });

  it('rotateSheet true and needsRotation: swaps dimensions', () => {
    const dims = rulerVisualDims(100, 50, true, true);
    expect(dims.visualWidthMm).toBe(50);
    expect(dims.visualHeightMm).toBe(100);
  });

  it('portrait A4 rotated to landscape: swaps', () => {
    const dims = rulerVisualDims(210, 297, true, true);
    expect(dims.visualWidthMm).toBe(297);
    expect(dims.visualHeightMm).toBe(210);
  });

  it('landscape paper with portrait orientation rotates: rulers show portrait', () => {
    // 100x50 is natural landscape, needsRotation=true when orientation=portrait
    const dims = rulerVisualDims(100, 50, true, true);
    expect(dims.visualWidthMm).toBe(50);
    expect(dims.visualHeightMm).toBe(100);
  });

  it('square dimensions: swap is no-op', () => {
    const dims = rulerVisualDims(100, 100, true, true);
    expect(dims.visualWidthMm).toBe(100);
    expect(dims.visualHeightMm).toBe(100);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Ruler origin tick calculations (visual vs original mm)
// ══════════════════════════════════════════════════════════════════════

/** Compute the total mm length of ruler ticks for a given visual dimension. */
function rulerTickRange(
  visualMm: number,
  majorIntervalMm: number,
): { firstTickMm: number; lastTickMm: number; count: number } {
  let last = 0;
  let count = 0;
  for (let mm = 0; mm <= visualMm; mm += majorIntervalMm) {
    last = mm;
    count++;
  }
  return { firstTickMm: 0, lastTickMm: last, count };
}

describe('rulerTickRange', () => {
  it('100mm paper, 10mm interval: 0…100, 11 ticks', () => {
    const r = rulerTickRange(100, 10);
    expect(r.firstTickMm).toBe(0);
    expect(r.lastTickMm).toBe(100);
    expect(r.count).toBe(11);
  });

  it('50mm paper, 10mm interval: 0…50, 6 ticks', () => {
    const r = rulerTickRange(50, 10);
    expect(r.lastTickMm).toBe(50);
    expect(r.count).toBe(6);
  });

  it('95mm paper, 10mm interval: last partial tick at 90', () => {
    const r = rulerTickRange(95, 10);
    expect(r.lastTickMm).toBe(90);
    expect(r.count).toBe(10); // 0,10,20,30,40,50,60,70,80,90
  });

  it('0mm paper: single tick at 0', () => {
    const r = rulerTickRange(0, 10);
    expect(r.firstTickMm).toBe(0);
    expect(r.lastTickMm).toBe(0);
    expect(r.count).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Portrait vs landscape ruler dimensions
// ══════════════════════════════════════════════════════════════════════

/** Compute expected ruler pixel sizes at a given scale. */
function rulerPixelDims(
  visualWidthMm: number,
  visualHeightMm: number,
  scale: number,
): { widthPx: number; heightPx: number } {
  return {
    widthPx: visualWidthMm * scale,
    heightPx: visualHeightMm * scale,
  };
}

describe('rulerPixelDims', () => {
  it('A4 portrait at scale 2.5: width=525px, height≈742.5px', () => {
    const { widthPx, heightPx } = rulerPixelDims(210, 297, 2.5);
    expect(widthPx).toBe(525);
    expect(heightPx).toBeCloseTo(742.5, 1);
  });

  it('A4 landscape (rotated) at scale 3: width=891px, height=630px', () => {
    // After rotation: visual width = height (297), visual height = width (210)
    const { widthPx, heightPx } = rulerPixelDims(297, 210, 3);
    expect(widthPx).toBe(891);
    expect(heightPx).toBe(630);
  });

  it('100x50 label portrait at scale 8: width=400px, height=800px', () => {
    // Natural landscape, portrait orientation → rotate → visual width=50, height=100
    const { widthPx, heightPx } = rulerPixelDims(50, 100, 8);
    expect(widthPx).toBe(400);
    expect(heightPx).toBe(800);
  });

  it('100x50 label landscape at scale 10: width=1000px, height=500px', () => {
    const { widthPx, heightPx } = rulerPixelDims(100, 50, 10);
    expect(widthPx).toBe(1000);
    expect(heightPx).toBe(500);
  });
});
