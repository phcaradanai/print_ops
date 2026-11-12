import { describe, expect, it } from 'vitest';
import { marqueeRect, rectsTouch } from '../hooks/useMarqueeSelection.js';
import { editorReducer } from '../state/editorReducer.js';
import { createEditorState } from '../state/editorState.js';
import type { DynamicField } from '../model/types.js';

describe('marquee selection', () => {
  it('spans the drag in any direction and catches boxes it only touches', () => {
    const rect = marqueeRect(50, 40, 10, 0);
    expect(rect).toEqual({ left: 10, top: 0, width: 40, height: 40 });
    expect(rectsTouch(rect, { left: 50, top: 40, width: 5, height: 5 })).toBe(true); // corner touch
    expect(rectsTouch(rect, { left: 51, top: 0, width: 5, height: 5 })).toBe(false);
  });

  it('replaces the selection with existing fields only', () => {
    const field = { id: 'a', key: 'a', label: '', defaultValue: '', type: 'text', xMm: 0, yMm: 0, fontSize: 10, bold: false, color: '#000', align: 'left' } as DynamicField;
    let state = editorReducer(createEditorState(), { type: 'ADD_FIELD', field });
    state = editorReducer(state, { type: 'ADD_FIELD', field: { ...field, id: 'b' } });
    state = editorReducer(state, { type: 'SET_SELECTION', ids: ['a', 'b', 'ghost'] });
    expect(state.selectedFieldIds).toEqual(['a', 'b']);
    expect(editorReducer(state, { type: 'SET_SELECTION', ids: ['a', 'b'] })).toBe(state);
    expect(editorReducer(state, { type: 'SET_SELECTION', ids: [] }).selectedFieldId).toBeNull();
  });
});
