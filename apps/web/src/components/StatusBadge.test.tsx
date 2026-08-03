import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge.js';

describe('StatusBadge', () => {
  it('preserves the raw status and requested visual size', () => {
    const markup = renderToStaticMarkup(
      <StatusBadge status="UNVERIFIED" size="sm" title="ยังยืนยันผลการพิมพ์ไม่ได้" />,
    );

    expect(markup).toContain('status-badge status-badge--sm');
    expect(markup).toContain('UNVERIFIED');
    expect(markup).toContain('title="ยังยืนยันผลการพิมพ์ไม่ได้"');
  });
});
