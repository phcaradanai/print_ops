import { describe, expect, it } from 'vitest';

import { resolveRenderTransform, transformPoint } from './rendering.js';

describe('rendering transforms', () => {
  it('resolves profile values and per-job overrides', () => {
    expect(resolveRenderTransform({ rotation: 90, flipHorizontal: true }, { rotate: 180, flipVertical: true })).toEqual({
      rotation: 180,
      flipHorizontal: true,
      flipVertical: true,
    });
  });

  it('rotates points around the paper center', () => {
    expect(transformPoint(0, 0, 100, 50, { rotation: 90, flipHorizontal: false, flipVertical: false })).toEqual({
      x: 75,
      y: -25,
    });
  });
});
