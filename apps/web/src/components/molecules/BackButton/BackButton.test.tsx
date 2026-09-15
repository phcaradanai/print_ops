// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LocaleProvider } from '../../../i18n/index.js';
import { BackButton } from './BackButton.js';

let container: HTMLDivElement;
let root: Root;

function renderAt(path: string, fallback: string, entries: string[] = [path]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <LocaleProvider>
        <MemoryRouter initialEntries={entries}>
          <Routes>
            <Route path="/jobs/:id" element={<BackButton to={fallback} />} />
            <Route path={fallback} element={<div data-testid="fallback">FALLBACK PAGE</div>} />
            <Route path="/printers" element={<div data-testid="printers">PRINTER LIST</div>} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>,
    );
  });
}

function cleanup() {
  act(() => root.unmount());
  document.body.removeChild(container);
}

describe('BackButton', () => {
  it('renders the back icon with the localized label', () => {
    renderAt('/jobs/abc', '/jobs');
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.textContent).toBe('ย้อนกลับ');
    expect(button?.querySelector('.action-icon')).toBeTruthy();
    cleanup();
  });

  it('falls back to the parent route when there is no in-app history (deep link)', () => {
    renderAt('/jobs/abc', '/jobs');
    const button = container.querySelector('button')!;
    act(() => button.click());
    expect(container.textContent).toContain('FALLBACK PAGE');
    cleanup();
  });

  it('pops in-app history when a previous page exists', () => {
    renderAt('/jobs/abc', '/jobs', ['/printers', '/jobs/abc']);
    // BrowserRouter keeps window.history.state.idx on every in-app push;
    // idx > 0 means a previous page exists to pop back to. MemoryRouter does
    // not touch window.history, so fake the BrowserRouter contract directly.
    Object.defineProperty(window.history, 'state', {
      value: { idx: 3 },
      configurable: true,
    });
    const button = container.querySelector('button')!;
    act(() => button.click());
    expect(container.textContent).toContain('PRINTER LIST');
    cleanup();
  });
});
