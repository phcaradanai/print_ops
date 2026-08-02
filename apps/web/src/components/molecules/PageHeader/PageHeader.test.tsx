import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader.js';

describe('PageHeader', () => {
  it('does not render an empty header landmark', () => {
    expect(renderToStaticMarkup(<PageHeader />)).toBe('');
  });

  it('renders localized copy and page actions', () => {
    const markup = renderToStaticMarkup(
      <PageHeader
        eyebrow="PrintOps"
        title="คิวงานพิมพ์"
        description="งานที่กำลังดำเนินการ"
        actions={<button>รีเฟรช</button>}
      />,
    );

    expect(markup).toContain('<header');
    expect(markup).toContain('<h1');
    expect(markup).toContain('PrintOps');
    expect(markup).toContain('คิวงานพิมพ์');
    expect(markup).toContain('งานที่กำลังดำเนินการ');
    expect(markup).toContain('รีเฟรช');
    expect(markup).not.toContain('ui-text--caps');
  });
});
