import { describe, expect, it } from 'vitest';
import { editorReducer } from '../state/editorReducer.js';
import { createEditorState } from '../state/editorState.js';
import type { DynamicField, PaperProfile } from '../model/types.js';

const field = (id: string): DynamicField => ({
  id,
  key: id,
  label: id,
  defaultValue: '',
  type: 'text',
  xMm: 0,
  yMm: 0,
  fontSize: 12,
  bold: false,
  color: '#000000',
  align: 'left',
});

describe('editorReducer', () => {
  it('undoes a whole drag as one step, then redoes it', () => {
    let state = editorReducer(createEditorState(), { type: 'ADD_FIELD', field: field('a') });
    for (const xMm of [1, 2, 3]) state = editorReducer(state, { type: 'UPDATE_FIELD', id: 'a', patch: { xMm, yMm: 0 } });
    state = editorReducer(state, { type: 'BREAK_HISTORY' });
    state = editorReducer(state, { type: 'UPDATE_FIELD', id: 'a', patch: { xMm: 9, yMm: 0 } });

    state = editorReducer(state, { type: 'UNDO' });
    expect(state.ux.dynamicFields[0]!.xMm).toBe(3);
    state = editorReducer(state, { type: 'UNDO' });
    expect(state.ux.dynamicFields[0]!.xMm).toBe(0);
    state = editorReducer(state, { type: 'UNDO' });
    expect(state.ux.dynamicFields).toEqual([]);
    expect(state.selectedFieldId).toBeNull();

    state = editorReducer(state, { type: 'REDO' });
    state = editorReducer(state, { type: 'REDO' });
    expect(state.ux.dynamicFields[0]!.xMm).toBe(3);
    // A new edit drops the redo branch.
    state = editorReducer(state, { type: 'DELETE_FIELD', id: 'a' });
    expect(state.future).toEqual([]);
  });

  it('toggles a multi-selection and deletes it as one undo step', () => {
    let state = createEditorState();
    for (const id of ['a', 'b', 'c']) state = editorReducer(state, { type: 'ADD_FIELD', field: field(id) });
    state = editorReducer(state, { type: 'SELECT_FIELD', id: 'a' });
    state = editorReducer(state, { type: 'TOGGLE_FIELD_SELECTION', id: 'c' });
    expect(state.selectedFieldIds).toEqual(['a', 'c']);
    expect(state.selectedFieldId).toBe('c');
    state = editorReducer(state, { type: 'TOGGLE_FIELD_SELECTION', id: 'c' });
    expect(state.selectedFieldIds).toEqual(['a']);
    expect(state.selectedFieldId).toBe('a');

    state = editorReducer(state, { type: 'TOGGLE_FIELD_SELECTION', id: 'b' });
    state = editorReducer(state, { type: 'DELETE_FIELDS', ids: state.selectedFieldIds });
    expect(state.ux.dynamicFields.map((f) => f.id)).toEqual(['c']);
    expect(state.selectedFieldIds).toEqual([]);
    state = editorReducer(state, { type: 'UNDO' });
    expect(state.ux.dynamicFields.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('brings fields to the front or back (later prints on top), as one undo step', () => {
    let state = createEditorState();
    for (const id of ['a', 'b', 'c']) state = editorReducer(state, { type: 'ADD_FIELD', field: field(id) });
    state = editorReducer(state, { type: 'REORDER_FIELDS', ids: ['a'], to: 'front' });
    expect(state.ux.dynamicFields.map((f) => f.id)).toEqual(['b', 'c', 'a']);
    state = editorReducer(state, { type: 'REORDER_FIELDS', ids: ['c', 'a'], to: 'back' });
    expect(state.ux.dynamicFields.map((f) => f.id)).toEqual(['c', 'a', 'b']);
    state = editorReducer(state, { type: 'UNDO' });
    expect(state.ux.dynamicFields.map((f) => f.id)).toEqual(['b', 'c', 'a']);
  });

  it('starts a loaded profile with empty history', () => {
    let state = editorReducer(createEditorState(), { type: 'ADD_FIELD', field: field('a') });
    state = editorReducer(state, { type: 'RESET_EDITOR' });
    expect(state.past).toEqual([]);
    expect(editorReducer(state, { type: 'UNDO' })).toBe(state);
  });

  it('uses the same section keys as the runtime workspace', () => {
    expect(createEditorState().sectionsOpen).toEqual({
      basicInfo: true,
      dimensions: true,
      margins: false,
      fields: true,
    });
  });

  it('marks form changes dirty without mutating the previous state', () => {
    const initial = createEditorState();
    const next = editorReducer(initial, { type: 'PATCH_FORM', patch: { name: 'Shipping' } });
    expect(next.form.name).toBe('Shipping');
    expect(next.saveStatus).toBe('dirty');
    expect(initial.form.name).toBe('');
  });

  it('selects a new field and deterministically selects the first survivor after deletion', () => {
    let state = createEditorState();
    state = editorReducer(state, { type: 'ADD_FIELD', field: field('a') });
    state = editorReducer(state, { type: 'ADD_FIELD', field: field('b') });
    expect(state.selectedFieldId).toBe('b');
    state = editorReducer(state, { type: 'DELETE_FIELD', id: 'b' });
    expect(state.selectedFieldId).toBe('a');
  });

  it('loads a persisted profile without carrying stale selection or save errors', () => {
    const profile: PaperProfile = {
      ...createEditorState().form,
      id: 'profile-1',
      name: 'Loaded',
      fields: [field('a')],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const dirty = {
      ...createEditorState(),
      selectedFieldId: 'stale',
      saveStatus: 'error' as const,
      saveError: 'failed',
    };
    const loaded = editorReducer(dirty, { type: 'LOAD_PROFILE', profile });
    expect(loaded.editingProfileId).toBe('profile-1');
    expect(loaded.selectedFieldId).toBeNull();
    expect(loaded.saveStatus).toBe('idle');
    expect(loaded.saveError).toBeNull();
    expect(loaded.ux.dynamicFields).toEqual([field('a')]);
  });

  it('resets editor-owned persisted state after a successful delete flow', () => {
    const editing = {
      ...createEditorState(),
      editingProfileId: 'profile-1',
      form: { ...createEditorState().form, name: 'Loaded' },
      ux: { ...createEditorState().ux, dynamicFields: [field('a')] },
      selectedFieldId: 'a',
    };
    const reset = editorReducer(editing, { type: 'RESET_EDITOR' });
    expect(reset.editingProfileId).toBeNull();
    expect(reset.form.name).toBe('');
    expect(reset.ux.dynamicFields).toEqual([]);
    expect(reset.selectedFieldId).toBeNull();
  });

  it('returns to idle after a backend save error is dismissed', () => {
    const failed = editorReducer(createEditorState(), { type: 'SAVE_FAILED', error: 'Profile is in use' });
    expect(failed.saveStatus).toBe('error');
    expect(failed.saveError).toBe('Profile is in use');
    const dismissed = editorReducer(failed, { type: 'DISMISS_SAVE_ERROR' });
    expect(dismissed.saveError).toBeNull();
    expect(dismissed.saveStatus).toBe('idle');
  });

  it('uses the runtime basicInfo section key', () => {
    const collapsed = editorReducer(createEditorState(), {
      type: 'SET_SECTION',
      section: 'basicInfo',
      open: false,
    });
    expect(collapsed.sectionsOpen.basicInfo).toBe(false);
  });

  it('does not mark preview-only preferences dirty', () => {
    const initial = createEditorState();
    const next = editorReducer(initial, { type: 'PATCH_UX', patch: { displayUnit: 'cm' } });
    expect(next.ux.displayUnit).toBe('cm');
    expect(next.saveStatus).toBe('idle');
  });

  it('marks persisted dynamic-field updates dirty', () => {
    const withField = editorReducer(createEditorState(), { type: 'ADD_FIELD', field: field('a') });
    const saved = { ...withField, saveStatus: 'saved' as const };
    const updated = editorReducer(saved, { type: 'UPDATE_FIELD', id: 'a', patch: { xMm: 1.2 } });
    expect(updated.ux.dynamicFields[0].xMm).toBe(1.2);
    expect(updated.saveStatus).toBe('dirty');
  });
});
