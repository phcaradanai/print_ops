import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageSection } from './PageSection.js';

describe('PageSection', () => {
  it('renders a semantic section and forwards attributes', () => {
    const markup = renderToStaticMarkup(
      <PageSection aria-label="Queue filters" data-density="compact" className="queue-filters">
        Filters
      </PageSection>,
    );

    expect(markup).toContain('<section');
    expect(markup).toContain('ui-page-section');
    expect(markup).toContain('queue-filters');
    expect(markup).toContain('aria-label="Queue filters"');
    expect(markup).toContain('data-density="compact"');
    expect(markup).toContain('Filters');
  });
});
