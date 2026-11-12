import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { registerPointerDragListeners } from './useCanvasInteraction.js';

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Movement under this many px is a click (deselect), not a marquee. */
const DRAG_THRESHOLD_PX = 3;

/** Rectangle spanned by two client points. */
export function marqueeRect(x1: number, y1: number, x2: number, y2: number): MarqueeRect {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** Figma rule: a field is caught as soon as the marquee touches its box. */
export function rectsTouch(a: MarqueeRect, b: { left: number; top: number; width: number; height: number }): boolean {
  return a.left <= b.left + b.width && b.left <= a.left + a.width && a.top <= b.top + b.height && b.top <= a.top + a.height;
}

/**
 * Drag on empty canvas space to select every field the rectangle touches,
 * live, like Figma. Shift adds to the selection the drag started with.
 */
export function useMarqueeSelection(
  sheetRef: RefObject<HTMLElement | null>,
  selectedIds: string[],
  setSelection: (ids: string[]) => void,
) {
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const startRef = useRef<{ x: number; y: number; base: string[] } | null>(null);
  const setSelectionRef = useRef(setSelection);
  setSelectionRef.current = setSelection;

  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!active) return;
    const onMove = (event: PointerEvent) => {
      const start = startRef.current;
      const sheet = sheetRef.current;
      if (!start || !sheet) return;
      if (Math.abs(event.clientX - start.x) < DRAG_THRESHOLD_PX && Math.abs(event.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      const next = marqueeRect(start.x, start.y, event.clientX, event.clientY);
      setRect(next);
      const hits = Array.from(sheet.querySelectorAll<HTMLElement>('[data-field-id]'))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return rectsTouch(next, { left: box.left, top: box.top, width: box.width, height: box.height });
        })
        .map((element) => element.dataset.fieldId!);
      setSelectionRef.current([...start.base, ...hits.filter((id) => !start.base.includes(id))]);
    };
    return registerPointerDragListeners(document, onMove, () => {
      startRef.current = null;
      setRect(null);
      setActive(false);
    });
  }, [active, sheetRef]);

  /** Call from the stage's pointerdown when it did not land on a field. */
  const start = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); // no text selection while dragging the marquee
    const base = event.shiftKey ? selectedIds : [];
    startRef.current = { x: event.clientX, y: event.clientY, base };
    setSelectionRef.current(base);
    setActive(true);
  }, [selectedIds]);

  return { rect, start };
}
