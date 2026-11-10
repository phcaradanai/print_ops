import { describe, expect, it } from 'vitest';

import {
  fieldContentBounds,
  fieldContentFitsPaper,
  maxFieldContentMm,
  maxFieldSymbolSizeMm,
  type FieldContentBox,
} from './field-limits.js';
import {
  getOrientedPaperGeometry,
  resolveRenderTransformFrame,
  type PaperGeometry,
  type RenderTransform,
} from './rendering.js';

const paper = (overrides: Partial<Parameters<typeof getOrientedPaperGeometry>[0]> = {}): PaperGeometry =>
  getOrientedPaperGeometry({
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 0,
    marginRightMm: 0,
    marginBottomMm: 0,
    marginLeftMm: 0,
    orientation: 'landscape',
    ...overrides,
  });

const turn = (rotation: number, flips: Partial<RenderTransform> = {}): RenderTransform => ({
  rotation,
  flipHorizontal: false,
  flipVertical: false,
  ...flips,
});

const qrBox = (xMm: number, yMm: number, outerSizeMm = 13.81): FieldContentBox => ({
  xMm,
  yMm,
  widthMm: outerSizeMm,
  heightMm: outerSizeMm,
  align: 'left',
});

describe('field content bounds', () => {
  it('keeps a centered box inside the frame through every quarter turn', () => {
    const box: FieldContentBox = { xMm: 40, yMm: 20, widthMm: 20, heightMm: 10, align: 'left' };

    for (const rotation of [0, 90, 180, 270]) {
      const transform = turn(rotation);
      const frame = resolveRenderTransformFrame(100, 50, transform);
      const bounds = fieldContentBounds(paper(), transform, box);

      expect(fieldContentFitsPaper(paper(), transform, box)).toBe(true);
      expect(bounds.minX).toBeGreaterThanOrEqual(-0.0001);
      expect(bounds.minY).toBeGreaterThanOrEqual(-0.0001);
      expect(bounds.maxX).toBeLessThanOrEqual(frame.width + 0.0001);
      expect(bounds.maxY).toBeLessThanOrEqual(frame.height + 0.0001);
    }
  });

  it('keeps a flipped box inside the frame', () => {
    const transform = turn(90, { flipHorizontal: true, flipVertical: true });
    const box: FieldContentBox = { xMm: 40, yMm: 20, widthMm: 20, heightMm: 10, align: 'left' };

    expect(fieldContentFitsPaper(paper(), transform, box)).toBe(true);
  });

  it('moves the box with its alignment', () => {
    const box: FieldContentBox = { xMm: 50, yMm: 20, widthMm: 20, heightMm: 10, align: 'center' };

    expect(fieldContentBounds(paper(), turn(0), box).minX).toBe(40);
    expect(fieldContentFitsPaper(paper(), turn(0), box)).toBe(true);
    expect(fieldContentFitsPaper(paper(), turn(0), { ...box, xMm: 95, align: 'right' })).toBe(true);
    expect(fieldContentFitsPaper(paper(), turn(0), { ...box, xMm: 95, align: 'left' })).toBe(false);
  });

  it('treats unmeasurable paper as fitting rather than reporting every field', () => {
    const broken = paper({ widthMm: Number.NaN });
    const box: FieldContentBox = { xMm: 10, yMm: 10, widthMm: 900, heightMm: 900, align: 'left' };

    expect(fieldContentFitsPaper(broken, turn(0), box)).toBe(true);
    expect(maxFieldContentMm(broken, turn(0), box)).toEqual({ maxWidthMm: 0, maxHeightMm: 0 });
    expect(maxFieldSymbolSizeMm(broken, turn(0), box)).toEqual({ maxWidthMm: 0, maxHeightMm: 0 });
  });
});

describe('field content limits', () => {
  it('quotes the square symbol that still fits at an overflowing anchor', () => {
    // A QR code on a 100 × 50 label turned 90°: the anchor is on the paper, the
    // 13.81 mm quiet-zone box is not, and only 5 mm of it still prints.
    const transform = turn(90);
    const box = qrBox(95, 20);

    expect(fieldContentFitsPaper(paper(), transform, box)).toBe(false);
    expect(maxFieldSymbolSizeMm(paper(), transform, box)).toEqual({ maxWidthMm: 5, maxHeightMm: 5 });
    expect(fieldContentFitsPaper(paper(), transform, { ...box, widthMm: 5, heightMm: 5 })).toBe(true);
  });

  it('searches one side at a time but keeps the configured aspect ratio', () => {
    const box: FieldContentBox = { xMm: 62, yMm: 32, widthMm: 28, heightMm: 12, align: 'left' };

    expect(maxFieldContentMm(paper(), turn(0), box)).toEqual({ maxWidthMm: 38, maxHeightMm: 18 });
    expect(maxFieldSymbolSizeMm(paper(), turn(0), box)).toEqual({ maxWidthMm: 38, maxHeightMm: 16.2 });
  });

  it('reports zero on an axis whose current size already overflows', () => {
    const transform = turn(90);
    const box = qrBox(95, 20);
    const singleLineBox = { ...box, widthMm: 0, heightMm: 13.81 };

    expect(maxFieldContentMm(paper(), transform, box)).toEqual({ maxWidthMm: 5, maxHeightMm: 0 });
    expect(maxFieldContentMm(paper(), transform, singleLineBox)).toEqual({ maxWidthMm: 5, maxHeightMm: 30 });
  });

  it('quotes nothing when the anchor itself is off the paper', () => {
    const box = qrBox(120, 20);

    expect(maxFieldContentMm(paper(), turn(0), box)).toEqual({ maxWidthMm: 0, maxHeightMm: 0 });
    expect(maxFieldSymbolSizeMm(paper(), turn(0), box)).toEqual({ maxWidthMm: 0, maxHeightMm: 0 });
  });
});
