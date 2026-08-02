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

  it('renders the detail and footer landmarks only when those slots are filled', () => {
    const bodyOnly = renderToStaticMarkup(<PageLayout title="Queue">Jobs</PageLayout>);

    expect(bodyOnly).not.toContain('<aside');
    expect(bodyOnly).not.toContain('<footer');

    const withRegions = renderToStaticMarkup(
      <PageLayout title="Queue" detail={<p>Evidence</p>} footer={<button>Reprint</button>}>
        Jobs
      </PageLayout>,
    );

    expect(occurrences(withRegions, '<aside')).toBe(1);
    expect(occurrences(withRegions, '<footer')).toBe(1);
    expect(withRegions).toContain('Evidence');
    expect(withRegions).toContain('Reprint');
  });

  it('omits the header landmark entirely when a page passes no header content', () => {
    const markup = renderToStaticMarkup(<PageLayout>Jobs</PageLayout>);

    expect(markup).not.toContain('<header');
    expect(markup).toContain('Jobs');
  });

  it('keeps a page to a single set of landmarks, so `detail` is the only aside', () => {
    // The contract the guard in __tests__/layoutContract.test.ts enforces:
    // one header, one aside, one footer per route, all owned by the scaffold.
    const markup = renderToStaticMarkup(
      <PageLayout title="Queue" detail={<p>Evidence</p>} footer={<button>Reprint</button>}>
        Jobs
      </PageLayout>,
    );

    expect(occurrences(markup, '<header')).toBe(1);
    expect(occurrences(markup, '<aside')).toBe(1);
    expect(occurrences(markup, '<footer')).toBe(1);
  });
});
