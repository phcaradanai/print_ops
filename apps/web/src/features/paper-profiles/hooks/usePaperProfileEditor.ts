import { useCallback, useMemo, useReducer } from 'react';
import { DEFAULT_FORM, DEFAULT_UX } from '../model/defaults.js';
import {
  centerFieldAnchorHorizontal,
  centerFieldAnchorVertical,
} from '../model/fieldGeometry.js';
import { clampGroupDelta, getDesignPaperGeometry, nudgePrintablePoint } from '../model/geometry.js';
import type { FieldMove } from '../model/align.js';
import type { DynamicField, PaperForm, PaperProfile, PaperProfileUx } from '../model/types.js';
import { editorReducer } from '../state/editorReducer.js';
import { createEditorState, type SectionKey } from '../state/editorState.js';
import { selectSelectedField } from '../state/selectors.js';

function fieldId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Scroll the actual application scroll owner back to the editor after selecting
 * a saved profile. The app shell owns scrolling; `window.scrollTo()` alone does
 * not move `.app-main` in the desktop layout.
 */
export function scrollPaperProfileEditorIntoView(): void {
  const shell = document.querySelector<HTMLElement>('.app-main');
  if (shell && typeof shell.scrollTo === 'function') {
    shell.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function usePaperProfileEditor() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createEditorState);

  const patchForm = useCallback(<K extends keyof PaperForm>(key: K, value: PaperForm[K]) => {
    dispatch({ type: 'PATCH_FORM', patch: { [key]: value } });
  }, []);
  const patchUx = useCallback(<K extends keyof Omit<PaperProfileUx, 'dynamicFields'>>(
    key: K,
    value: PaperProfileUx[K],
  ) => {
    // UX presentation preferences are deliberately preview-local: they are not
    // part of the profile payload and therefore do not make the editor dirty.
    dispatch({ type: 'PATCH_UX', patch: { [key]: value } });
  }, []);
  const addField = useCallback(() => {
    const field: DynamicField = {
      id: fieldId(),
      key: '',
      label: '',
      defaultValue: '',
      type: 'text',
      xMm: 5,
      yMm: 5,
      fontSize: state.ux.fontSize,
      bold: state.ux.fontWeight === 'bold',
      color: state.ux.fontColor,
      align: 'left',
    };
    dispatch({ type: 'ADD_FIELD', field });
    return field;
  }, [state.ux.fontColor, state.ux.fontSize, state.ux.fontWeight]);
  const updateField = useCallback((id: string, patch: Partial<DynamicField>) => {
    dispatch({ type: 'UPDATE_FIELD', id, patch });
  }, []);
  const deleteField = useCallback((id: string) => dispatch({ type: 'DELETE_FIELD', id }), []);
  /** The field plus the rest of the selection when it is part of one. */
  const groupOf = useCallback((id: string) => (
    state.selectedFieldIds.includes(id) ? state.selectedFieldIds : [id]
  ), [state.selectedFieldIds]);
  /** Copies of the field (or its whole selection) 2 mm down-right, selected — like Figma's Ctrl/Cmd+D. */
  const duplicateField = useCallback((id: string) => {
    const geometry = getDesignPaperGeometry(state.form);
    const ids = groupOf(id);
    const fields = state.ux.dynamicFields.filter((candidate) => ids.includes(candidate.id));
    dispatch({ type: 'ADD_FIELDS', fields: fields.map((field) => ({
      ...field,
      id: fieldId(),
      key: field.key ? `${field.key}_copy` : '',
      ...nudgePrintablePoint(field.xMm, field.yMm, 2, 2, geometry),
    })) });
  }, [groupOf, state.form, state.ux.dynamicFields]);
  const deleteFields = useCallback((ids: string[]) => dispatch({ type: 'DELETE_FIELDS', ids }), []);
  const setSelection = useCallback((ids: string[]) => dispatch({ type: 'SET_SELECTION', ids }), []);
  const toggleFieldSelection = useCallback((id: string) => dispatch({ type: 'TOGGLE_FIELD_SELECTION', id }), []);
  const updateFields = useCallback((patches: { id: string; patch: Partial<DynamicField> }[]) => {
    dispatch({ type: 'UPDATE_FIELDS', patches });
  }, []);
  /** Moves each field by its own visual delta (align/distribute) as one undo step. */
  const moveFields = useCallback((moves: FieldMove[]) => {
    const geometry = getDesignPaperGeometry(state.form);
    const patches = moves.flatMap((move) => {
      const field = state.ux.dynamicFields.find((candidate) => candidate.id === move.id);
      if (!field || (Math.abs(move.dxMm) < 0.05 && Math.abs(move.dyMm) < 0.05)) return [];
      return [{ id: move.id, patch: nudgePrintablePoint(field.xMm, field.yMm, move.dxMm, move.dyMm, geometry) }];
    });
    if (patches.length === 0) return;
    dispatch({ type: 'UPDATE_FIELDS', patches });
    dispatch({ type: 'BREAK_HISTORY' });
  }, [state.form, state.ux.dynamicFields]);
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const breakHistory = useCallback(() => dispatch({ type: 'BREAK_HISTORY' }), []);
  const selectField = useCallback((id: string | null) => dispatch({ type: 'SELECT_FIELD', id }), []);
  const setSection = useCallback((section: SectionKey, open: boolean) => {
    dispatch({ type: 'SET_SECTION', section, open });
  }, []);
  const setAllSections = useCallback((open: boolean) => dispatch({ type: 'SET_SECTIONS', open }), []);
  const applyPreset = useCallback((preset: { widthMm: number; heightMm: number; dpi: number }) => {
    dispatch({ type: 'APPLY_PRESET', ...preset });
  }, []);
  const startEditing = useCallback((profile: PaperProfile) => {
    dispatch({ type: 'LOAD_PROFILE', profile });
    scrollPaperProfileEditorIntoView();
  }, []);
  const resetEditor = useCallback(() => dispatch({ type: 'RESET_EDITOR' }), []);

  const centerField = useCallback((id: string, axis: 'horizontal' | 'vertical') => {
    const field = state.ux.dynamicFields.find((candidate) => candidate.id === id);
    if (!field) return;
    const geometry = getDesignPaperGeometry(state.form);
    const patch = axis === 'horizontal'
      ? centerFieldAnchorHorizontal(field, geometry)
      : centerFieldAnchorVertical(field, geometry);
    dispatch({ type: 'UPDATE_FIELD', id, patch });
  }, [state.form, state.ux.dynamicFields]);
  /** Arrow-key nudge of the field, or of its whole selection as one piece. */
  const nudgeField = useCallback((id: string, deltaXmm: number, deltaYmm: number) => {
    const ids = groupOf(id);
    const fields = state.ux.dynamicFields.filter((candidate) => ids.includes(candidate.id));
    if (fields.length === 0) return;
    const geometry = getDesignPaperGeometry(state.form);
    const { dxMm, dyMm } = clampGroupDelta(fields, deltaXmm, deltaYmm, geometry);
    dispatch({
      type: 'UPDATE_FIELDS',
      patches: fields.map((field) => ({
        id: field.id,
        patch: nudgePrintablePoint(field.xMm, field.yMm, dxMm, dyMm, geometry),
      })),
    });
  }, [groupOf, state.form, state.ux.dynamicFields]);

  return useMemo(() => ({
    state,
    form: state.form,
    ux: state.ux,
    selectedField: selectSelectedField(state),
    patchForm,
    patchUx,
    addField,
    updateField,
    deleteField,
    duplicateField,
    deleteFields,
    toggleFieldSelection,
    setSelection,
    updateFields,
    moveFields,
    selectedFieldIds: state.selectedFieldIds,
    undo,
    redo,
    breakHistory,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    selectField,
    setSection,
    setAllSections,
    applyPreset,
    centerField,
    nudgeField,
    startEditing,
    resetEditor,
    saveStarted: () => dispatch({ type: 'SAVE_STARTED' }),
    saveSucceeded: (profileId?: string) => dispatch({ type: 'SAVE_SUCCEEDED', profileId }),
    saveFailed: (error: string) => dispatch({ type: 'SAVE_FAILED', error }),
    dismissSaveError: () => dispatch({ type: 'DISMISS_SAVE_ERROR' }),
  }), [
    addField, applyPreset, breakHistory, centerField, deleteField, deleteFields, duplicateField, moveFields, nudgeField, redo, setSelection, toggleFieldSelection, undo, updateFields, patchForm, patchUx,
    resetEditor, selectField, setAllSections, setSection, startEditing, state, updateField,
  ]);
}

export type PaperProfileEditor = ReturnType<typeof usePaperProfileEditor>;
export { DEFAULT_FORM, DEFAULT_UX };
