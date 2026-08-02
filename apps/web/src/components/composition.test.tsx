import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageLayout } from './PageLayout.js';
import { SectionHeading } from './molecules/SectionHeading/index.js';
import { PageScaffold } from './organisms/PageScaffold/index.js';

function position(markup: string, value: string) {
  const index = markup.indexOf(value);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('molecular page composition', () => {
  it('renders canonical regions in document order', () => {
    const markup = renderToStaticMarkup(
      <PageScaffold
        header={<header>Header</header>}
        detail={<div>Evidence</div>}
        footer={<div>Actions</div>}
        width="standard"
        density="compact"
      >
        Primary task
      </PageScaffold>,
    );

    expect(markup).toContain('ui-page-scaffold--standard');
    expect(markup).toContain('ui-page-scaffold--compact');
    expect(position(markup, 'Header')).toBeLessThan(position(markup, 'Primary task'));
    expect(position(markup, 'Primary task')).toBeLessThan(position(markup, 'Evidence'));
    expect(position(markup, 'Evidence')).toBeLessThan(position(markup, 'Actions'));
  });

  it('keeps the PageLayout compatibility API', () => {
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
  });

  it('omits optional landmarks when no content exists', () => {
    const markup = renderToStaticMarkup(<PageScaffold>Primary task</PageScaffold>);

    expect(markup).not.toContain('<aside');
    expect(markup).not.toContain('<footer');
  });

  it('renders localized section copy without transformation flags', () => {
    const markup = renderToStaticMarkup(
      <SectionHeading title="คิวงานพิมพ์" description="งานที่กำลังดำเนินการ" />,
    );

    expect(markup).toContain('คิวงานพิมพ์');
    expect(markup).toContain('งานที่กำลังดำเนินการ');
    expect(markup).not.toContain('ui-text--caps');
  });
});
