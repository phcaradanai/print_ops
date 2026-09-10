// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftNumberInput } from '../components/DraftNumberInput.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function setInputValue(input: HTMLInputElement, value: string, event: 'input' | 'blur' = 'input') {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    if (event === 'blur') input.blur();
    else input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('DraftNumberInput', () => {
  it('keeps a cleared draft empty until the replacement is typed', () => {
    const onValueChange = vi.fn();
    act(() => root.render(<DraftNumberInput value={42} onValueChange={onValueChange} aria-label="value" />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => input.focus());
    setInputValue(input, '');
    expect(input.value).toBe('');

    setInputValue(input, '27');
    expect(input.value).toBe('27');
    expect(onValueChange).toHaveBeenLastCalledWith(27);
  });

  it('normalizes only when editing ends', () => {
    const onValueChange = vi.fn();
    act(() => root.render(
      <DraftNumberInput
        value={10}
        onValueChange={onValueChange}
        normalize={(value) => Math.max(1, Math.min(10, value))}
        aria-label="value"
      />,
    ));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => input.focus());
    setInputValue(input, '99');
    expect(onValueChange).toHaveBeenLastCalledWith(99);
    setInputValue(input, '', 'blur');
    expect(onValueChange).toHaveBeenLastCalledWith(10);
  });
});
