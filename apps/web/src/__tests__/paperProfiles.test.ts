import { describe, it, expect } from 'vitest';

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
