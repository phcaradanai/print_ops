import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

function renderDialog(element: React.ReactElement) {
  act(() => root.render(element));
}

describe('Dialog adapter', () => {
  it('renders a labelled modal and an accessible close button', () => {
    const onClose = vi.fn();

    renderDialog(
      <Dialog
        open
        onClose={onClose}
        title="Print preview"
        closeLabel="Close preview"
      >
        <p>Proof</p>
      </Dialog>,
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    const titleId = dialog?.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId ?? '')?.textContent).toBe('Print preview');

    const closeButton = document.querySelector<HTMLButtonElement>('.ui-dialog-close');
    expect(closeButton?.getAttribute('aria-label')).toBe('Close preview');
    expect(closeButton?.getAttribute('title')).toBe('Close preview');

    act(() => closeButton?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not add an unlabeled close button', () => {
    renderDialog(
      <Dialog open onClose={vi.fn()} title="Confirmation">
        <p>Body</p>
      </Dialog>,
    );

    expect(document.querySelector('.ui-dialog-close')).toBeNull();
  });

  it('keeps warning and footer semantics inside the modal surface', () => {
    renderDialog(
      <Dialog
        open
        onClose={vi.fn()}
        title="Reprint confirmation"
        warning="This may create a duplicate physical copy."
        footer={<button type="button">Confirm reprint</button>}
      >
        <p>Destination: Pharmacy 2</p>
      </Dialog>,
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain('duplicate physical copy');
    expect(dialog?.querySelector('.ui-dialog-footer')?.textContent).toContain('Confirm reprint');
  });
});
