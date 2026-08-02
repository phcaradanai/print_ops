import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageLayout } from './PageLayout.js';

function occurrences(markup: string, value: string) {
  return markup.split(value).length - 1;
}

describe('PageLayout compatibility facade', () => {
  it('keeps the title, description, actions, and body API', () => {
    const markup = renderToStaticMarkup(
      <PageLayout title="Queue" description="Live workload" actions={<button>Refresh</button>}>
        Jobs
      </PageLayout>,
    );

    expect(markup).toContain('<h1');
    expect(markup).toContain('Queue');
    expect(markup).toContain('Live workload');
    expect(markup).toContain('Refresh');
    expect(markup).toContain('Jobs');
    expect(occurrences(markup, '<header')).toBe(1);
  });

  it('supports custom header content without rendering the default heading', () => {
    const markup = renderToStaticMarkup(
      <PageLayout header={<div data-testid="custom-header">Custom route header</div>}>
        Body
      </PageLayout>,
    );

    expect(markup).toContain('Custom route header');
    expect(markup).not.toContain('<h1');
    expect(occurrences(markup, '<header')).toBe(1);
  });
});
