import { describe, expect, it, vi } from 'vitest';
import { registerPointerDragListeners, SNAP_THRESHOLD_MM } from '../hooks/useCanvasInteraction.js';

class ListenerTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener({ type } as Event);
      else listener.handleEvent({ type } as Event);
    }
  }
}

describe('canvas interaction lifecycle', () => {
  it('ends a drag on pointer cancel', () => {
    const target = new ListenerTarget();
    const end = vi.fn();
    registerPointerDragListeners(target as unknown as Document, vi.fn(), end);
    target.emit('pointercancel');
    expect(end).toHaveBeenCalledOnce();
  });

  it('removes move, up, and cancel listeners during cleanup', () => {
    const target = new ListenerTarget();
    const move = vi.fn();
    const end = vi.fn();
    const cleanup = registerPointerDragListeners(target as unknown as Document, move, end);
    cleanup();
    target.emit('pointermove');
    target.emit('pointerup');
    target.emit('pointercancel');
    expect(move).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('keeps the established two millimetre snap threshold', () => {
    expect(SNAP_THRESHOLD_MM).toBe(2);
  });
});
