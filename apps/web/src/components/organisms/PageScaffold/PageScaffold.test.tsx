import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageScaffold } from './PageScaffold.js';

function position(markup: string, value: string) {
  const index = markup.indexOf(value);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('PageScaffold', () => {
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
    expect(markup).toContain('ui-page-scaffold__header');
    expect(position(markup, 'Header')).toBeLessThan(position(markup, 'Primary task'));
    expect(position(markup, 'Primary task')).toBeLessThan(position(markup, 'Evidence'));
    expect(position(markup, 'Evidence')).toBeLessThan(position(markup, 'Actions'));
  });

  it('omits optional regions when no content exists', () => {
    const markup = renderToStaticMarkup(<PageScaffold>Primary task</PageScaffold>);

    expect(markup).not.toContain('ui-page-scaffold__header');
    expect(markup).not.toContain('<aside');
    expect(markup).not.toContain('<footer');
  });
});
