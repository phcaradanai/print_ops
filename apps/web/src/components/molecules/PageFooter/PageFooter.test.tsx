import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageFooter } from './PageFooter.js';

describe('PageFooter', () => {
  it('renders one footer landmark and forwards attributes', () => {
    const markup = renderToStaticMarkup(
      <PageFooter aria-label="Page actions" className="job-actions">
        <button>Save</button>
      </PageFooter>,
    );

    expect(markup).toContain('<footer');
    expect(markup).toContain('ui-page-footer');
    expect(markup).toContain('job-actions');
    expect(markup).toContain('aria-label="Page actions"');
    expect(markup).toContain('Save');
    expect(markup.split('<footer').length - 1).toBe(1);
  });
});
