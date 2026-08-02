// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

function renderPagination(props: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });

  const onPrevious = vi.fn();
  const onNext = vi.fn();

  act(() => {
    root.render(
      <Pagination
        ariaLabel="การแบ่งหน้า"
        page={2}
        totalPages={3}
        previousLabel="ก่อนหน้า"
        nextLabel="ถัดไป"
        status="หน้า 2 จาก 3"
        onPrevious={onPrevious}
        onNext={onNext}
        {...props}
      />,
    );
  });

  return { container, onPrevious, onNext };
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe('Pagination', () => {
  it('renders a labelled landmark and localized live status', () => {
    const { container } = renderPagination();
    const nav = container.querySelector('nav');
    const status = container.querySelector('.ui-pagination__status');

    expect(nav?.getAttribute('aria-label')).toBe('การแบ่งหน้า');
    expect(status?.textContent).toBe('หน้า 2 จาก 3');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.getAttribute('aria-atomic')).toBe('true');
  });

  it('uses native buttons and calls enabled navigation actions', () => {
    const { container, onPrevious, onNext } = renderPagination();
    const buttons = Array.from(container.querySelectorAll('button'));

    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.type).toBe('button');
    expect(buttons[1]?.type).toBe('button');
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(false);

    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('disables previous on the first page and next on the last page', () => {
    const first = renderPagination({ page: 1, totalPages: 3, status: 'หน้า 1 จาก 3' });
    const last = renderPagination({ page: 3, totalPages: 3, status: 'หน้า 3 จาก 3' });
    const firstButtons = Array.from(first.container.querySelectorAll('button'));
    const lastButtons = Array.from(last.container.querySelectorAll('button'));

    expect(firstButtons[0]?.disabled).toBe(true);
    expect(firstButtons[1]?.disabled).toBe(false);
    expect(lastButtons[0]?.disabled).toBe(false);
    expect(lastButtons[1]?.disabled).toBe(true);

    act(() => firstButtons[0]?.click());
    act(() => lastButtons[1]?.click());

    expect(first.onPrevious).not.toHaveBeenCalled();
    expect(last.onNext).not.toHaveBeenCalled();
  });
});
