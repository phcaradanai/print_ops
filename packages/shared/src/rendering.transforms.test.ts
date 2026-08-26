import { describe, expect, it } from 'vitest';

import {
  inverseTransformPoint,
  inverseTransformVector,
  isValidRotation,
  resolveRenderTransform,
  transformedBounds,
  transformPoint,
  wrapHtmlWithRenderTransform,
} from './rendering.js';

const noFlip = (rotation: number) => ({ rotation, flipHorizontal: false, flipVertical: false });

describe('rendering transform geometry', () => {
  it.each([
    [0, { x: 0, y: 0 }],
    [90, { x: 75, y: -25 }],
    [180, { x: 100, y: 50 }],
    [270, { x: 25, y: 75 }],
  ])('rotates a corner at %d degrees around the paper center', (rotation, expected) => {
    const actual = transformPoint(0, 0, 100, 50, noFlip(rotation));
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
  });

  it('supports arbitrary angles with centered bounds', () => {
    const point = transformPoint(0, 0, 100, 50, noFlip(37));
    const bounds = transformedBounds(100, 50, noFlip(37));

    expect(point.x).toBeCloseTo(25.11, 2);
    expect(point.y).toBeCloseTo(-25.06, 2);
    expect(bounds.width).toBeCloseTo(109.95, 2);
    expect(bounds.height).toBeCloseTo(100.11, 2);
  });

  it.each([
    ['horizontal', { rotation: 0, flipHorizontal: true, flipVertical: false }, { x: 100, y: 0 }],
    ['vertical', { rotation: 0, flipHorizontal: false, flipVertical: true }, { x: 0, y: 50 }],
    ['both', { rotation: 0, flipHorizontal: true, flipVertical: true }, { x: 100, y: 50 }],
  ])('supports %s flipping', (_name, transform, expected) => {
    expect(transformPoint(0, 0, 100, 50, transform)).toEqual(expected);
  });

  it('round-trips points and visible drag vectors through rotation and flips', () => {
    const transform = { rotation: 137, flipHorizontal: true, flipVertical: false };
    const point = { x: 31.25, y: 17.5 };
    const visible = transformPoint(point.x, point.y, 100, 50, transform);
    const restored = inverseTransformPoint(visible.x, visible.y, 100, 50, transform);
    const vector = { x: 4, y: -2 };
    const visibleVector = inverseTransformVector(vector.x, vector.y, transform);

    expect(restored.x).toBeCloseTo(point.x, 8);
    expect(restored.y).toBeCloseTo(point.y, 8);
    expect(inverseTransformVector(visibleVector.x, visibleVector.y, transform).x).toBeCloseTo(vector.x, 8);
    expect(inverseTransformVector(visibleVector.x, visibleVector.y, transform).y).toBeCloseTo(vector.y, 8);
  });

  it('resolves profile defaults and lets each job field override independently', () => {
    expect(resolveRenderTransform({ rotation: 123, flipHorizontal: true, flipVertical: false })).toEqual({
      rotation: 123,
      flipHorizontal: true,
      flipVertical: false,
    });
    expect(resolveRenderTransform(
      { rotation: 123, flipHorizontal: true, flipVertical: true },
      { rotate: 271, flipHorizontal: false },
    )).toEqual({ rotation: 271, flipHorizontal: false, flipVertical: true });
  });

  it('keeps the physical frame dimensions while clipping transformed content', () => {
    const wrapped = wrapHtmlWithRenderTransform('<span>all output</span>', 100, 50, noFlip(90));

    expect(wrapped).toContain('data-printops-transform-frame="true"');
    expect(wrapped).toContain('width:100mm;height:50mm;overflow:hidden');
    expect(wrapped).toContain('transform:rotate(90deg) scaleX(1) scaleY(1)');
    expect(transformedBounds(100, 50, noFlip(90))).toMatchObject({
      minX: 25,
      minY: -25,
      width: 50,
      height: 100,
    });
  });

  it('accepts the inclusive lower and exclusive upper rotation range', () => {
    expect(isValidRotation(0)).toBe(true);
    expect(isValidRotation(359.999)).toBe(true);
    expect(isValidRotation(360)).toBe(false);
    expect(isValidRotation(-1)).toBe(false);
    expect(isValidRotation(Number.NaN)).toBe(false);
  });
});
