import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog.js';

describe('Dialog close control', () => {
  it('renders a visible accessible close button when closeLabel is provided', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        onClose={vi.fn()}
        title="Print preview"
        closeLabel="Close preview"
      >
        <p>Proof</p>
      </Dialog>,
    );

    expect(html).toContain('class="ui-dialog-close"');
    expect(html).toContain('aria-label="Close preview"');
    expect(html).toContain('title="Close preview"');
  });

  it('does not add an unlabeled close button', () => {
    const html = renderToStaticMarkup(
      <Dialog open onClose={vi.fn()} title="Confirmation">
        <p>Body</p>
      </Dialog>,
    );

    expect(html).not.toContain('class="ui-dialog-close"');
  });
});
