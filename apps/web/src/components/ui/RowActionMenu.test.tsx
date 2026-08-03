// @vitest-environment jsdom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RowActionMenu, computeRowActionMenuPosition } from './RowActionMenu.js';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.PointerEvent) {
    Object.defineProperty(globalThis, 'PointerEvent', { value: MouseEvent, configurable: true });
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    value: () => undefined,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    value: () => undefined,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: () => undefined,
    configurable: true,
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = undefined;
  container = undefined;
});

function renderMenu(element: ReactElement) {
  if (!root) throw new Error('RowActionMenu test root is not initialized');
  act(() => root?.render(element));
}

async function openMenu(label: string) {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(trigger).not.toBeNull();

  await act(async () => {
    trigger?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }));
    await Promise.resolve();
  });

  return trigger;
}

describe('RowActionMenu adapter', () => {
  it('renders a labelled menu with enabled, disabled, and danger items', async () => {
    renderMenu(
      <RowActionMenu
        label="Template actions"
        items={[
          { id: 'open', label: 'Open', onSelect: vi.fn() },
          { id: 'blocked', label: 'Publish unavailable', disabled: true, onSelect: vi.fn() },
          { id: 'delete', label: 'Delete', danger: true, onSelect: vi.fn() },
        ]}
      />,
    );

    const trigger = await openMenu('Template actions');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');

    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.getAttribute('aria-label')).toBe('Template actions');

    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map((item) => item.textContent)).toEqual(['Open', 'Publish unavailable', 'Delete']);
    expect(items[1]?.hasAttribute('data-disabled')).toBe(true);
    expect(items[2]?.classList.contains('ui-row-action-menu__item--danger')).toBe(true);
  });

  it('runs an enabled item action and does not run a disabled item action', async () => {
    const openAction = vi.fn();
    const blockedAction = vi.fn();

    renderMenu(
      <RowActionMenu
        label="Printer actions"
        items={[
          { id: 'open', label: 'Open printer', onSelect: openAction },
          { id: 'blocked', label: 'Remove unavailable', disabled: true, onSelect: blockedAction },
        ]}
      />,
    );

    await openMenu('Printer actions');
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));

    await act(async () => {
      items[1]?.click();
      await Promise.resolve();
    });
    expect(blockedAction).not.toHaveBeenCalled();

    await act(async () => {
      items[0]?.click();
      await Promise.resolve();
    });
    expect(openAction).toHaveBeenCalledTimes(1);
  });
});

describe('computeRowActionMenuPosition compatibility helper', () => {
  it('fits the menu inside the viewport and flips above when needed', () => {
    expect(computeRowActionMenuPosition(
      { top: 740, right: 990, bottom: 780, left: 950, width: 40, height: 40 },
      { width: 200, height: 180 },
      1000,
      800,
    )).toEqual({ top: 556, left: 790 });
  });
});
