import { describe, expect, it } from 'vitest';
import { localPreview } from './helpers.js';

describe('local template preview transform frame', () => {
  it('uses the shared transformed bounds for a rectangular quarter turn', () => {
    const preview = localPreview(
      '<span>label</span>',
      'HTML',
      {},
      {
        id: 'paper-1',
        code: 'LABEL_100X50',
        name: 'Label 100x50',
        widthMm: 100,
        heightMm: 50,
        orientation: 'landscape',
        rotation: 90,
        fields: [],
      },
    );

    expect(preview).toContain('width:50mm;height:100mm;background:#fff');
    expect(preview).toContain('left:-25mm;top:25mm;width:100mm;height:50mm');
  });

  it('frames one cell of a multi-column profile, the size each job prints', () => {
    const preview = localPreview('<span>label</span>', 'HTML', {}, {
      id: 'paper-2', code: 'GRID', name: 'Grid', widthMm: 104, heightMm: 30, orientation: 'landscape',
      marginLeftMm: 2, layout: { columns: 2, cellWidthMm: 48, cellHeightMm: 25 }, fields: [],
    });
    expect(preview).toContain('width:48mm;height:25mm;background:#fff');
  });
});
