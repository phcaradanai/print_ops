import { describe, expect, it } from 'vitest';
import {
  computeTemplateMenuPosition,
  nextTemplateMenuIndex,
} from './TemplateRowMenu.js';

describe('Template row menu positioning', () => {
  it('places the menu below the trigger when the viewport has room', () => {
    expect(computeTemplateMenuPosition(
      { top: 100, right: 300, bottom: 132, left: 268, width: 32, height: 32 },
      { width: 176, height: 120 },
      1024,
      768,
    )).toEqual({ top: 136, left: 124 });
  });

  it('flips the menu above the trigger near the viewport bottom', () => {
    expect(computeTemplateMenuPosition(
      { top: 700, right: 1000, bottom: 732, left: 968, width: 32, height: 32 },
      { width: 176, height: 120 },
      1024,
      768,
    )).toEqual({ top: 576, left: 824 });
  });

  it('keeps the menu inside the horizontal viewport edges', () => {
    expect(computeTemplateMenuPosition(
      { top: 40, right: 50, bottom: 72, left: 18, width: 32, height: 32 },
      { width: 176, height: 120 },
      320,
      640,
    )).toEqual({ top: 76, left: 8 });
  });
});

describe('Template row menu keyboard navigation', () => {
  it('wraps ArrowDown and ArrowUp through all menu items', () => {
    expect(nextTemplateMenuIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextTemplateMenuIndex(0, 'ArrowUp', 3)).toBe(2);
  });

  it('supports Home and End', () => {
    expect(nextTemplateMenuIndex(1, 'Home', 3)).toBe(0);
    expect(nextTemplateMenuIndex(1, 'End', 3)).toBe(2);
  });

  it('ignores unrelated keys and empty menus', () => {
    expect(nextTemplateMenuIndex(0, 'Enter', 3)).toBeNull();
    expect(nextTemplateMenuIndex(0, 'ArrowDown', 0)).toBeNull();
  });
});
