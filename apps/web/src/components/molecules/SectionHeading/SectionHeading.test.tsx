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

  it('keeps a scope control on the title row, separate from actions', () => {
    // "All endpoints [All | Enabled | Draft]" is one phrase. Pushing the filter
    // to the actions end of a wide row breaks it, which is why two sections of
    // the Webhooks page had each hand-rolled this wrapper instead.
    const markup = renderToStaticMarkup(
      <SectionHeading
        title="All endpoints"
        scope={<button>Enabled</button>}
        actions={<button>Refresh</button>}
      />,
    );

    const titleRow = markup.indexOf('ui-section-heading__title-row');
    const scope = markup.indexOf('ui-section-heading__scope');
    const actions = markup.indexOf('ui-section-heading__actions');

    expect(titleRow).toBeGreaterThanOrEqual(0);
    expect(scope).toBeGreaterThan(titleRow);
    expect(scope).toBeLessThan(actions);
    expect(markup).toContain('Enabled');
    expect(markup).toContain('Refresh');
  });

  it('omits the scope wrapper when no scope is given', () => {
    const markup = renderToStaticMarkup(<SectionHeading title="Timing" />);

    expect(markup).not.toContain('ui-section-heading__scope');
    expect(markup).not.toContain('ui-section-heading__actions');
  });
});
