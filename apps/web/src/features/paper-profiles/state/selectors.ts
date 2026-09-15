import type { EditorState } from './editorState.js';

export function selectSelectedField(state: EditorState) {
  return state.ux.dynamicFields.find((field) => field.id === state.selectedFieldId) ?? null;
}

export function selectIsEditing(state: EditorState): boolean {
  return state.editingProfileId !== null;
}

export function selectIsDirty(state: EditorState): boolean {
  return state.saveStatus === 'dirty';
}

export type FieldInspectorState = 'empty' | 'selection-required' | 'selected';

export function getFieldInspectorState(
  fieldsLength: number,
  selectedFieldExists: boolean,
): FieldInspectorState {
  if (fieldsLength <= 0) return 'empty';
  return selectedFieldExists ? 'selected' : 'selection-required';
}
