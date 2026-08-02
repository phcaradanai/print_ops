import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SectionHeading } from './SectionHeading.js';

describe('SectionHeading', () => {
  it('renders localized copy without text transformation', () => {
    const markup = renderToStaticMarkup(
      <SectionHeading title="คิวงานพิมพ์" description="งานที่กำลังดำเนินการ" />,
    );

    expect(markup).toContain('คิวงานพิมพ์');
    expect(markup).toContain('งานที่กำลังดำเนินการ');
    expect(markup).not.toContain('ui-text--caps');
  });

  it('forwards heading level, id, and local actions', () => {
    const markup = renderToStaticMarkup(
      <SectionHeading
        title="Printer evidence"
        level={3}
        id="printer-evidence"
        actions={<button>Copy</button>}
      />,
    );

    expect(markup).toContain('<h3');
    expect(markup).toContain('id="printer-evidence"');
    expect(markup).toContain('Copy');
  });
});
