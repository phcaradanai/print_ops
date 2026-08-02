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
