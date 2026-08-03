import { useCallback, useMemo, useReducer } from 'react';
import { DEFAULT_FORM, DEFAULT_UX } from '../model/defaults.js';
import {
  centerFieldAnchorHorizontal,
  centerFieldAnchorVertical,
} from '../model/fieldGeometry.js';
import { getVisualPaperGeometry, nudgePrintablePoint } from '../model/geometry.js';
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
    const geometry = getVisualPaperGeometry(state.form);
    const patch = axis === 'horizontal'
      ? centerFieldAnchorHorizontal(field, geometry)
      : centerFieldAnchorVertical(field, geometry);
    dispatch({ type: 'UPDATE_FIELD', id, patch });
  }, [state.form, state.ux.dynamicFields]);
  const nudgeField = useCallback((id: string, deltaXmm: number, deltaYmm: number) => {
    const field = state.ux.dynamicFields.find((candidate) => candidate.id === id);
    if (!field) return;
    dispatch({
      type: 'UPDATE_FIELD',
      id,
      patch: nudgePrintablePoint(
        field.xMm,
        field.yMm,
        deltaXmm,
        deltaYmm,
        getVisualPaperGeometry(state.form),
      ),
    });
  }, [state.form, state.ux.dynamicFields]);

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
    addField, applyPreset, centerField, deleteField, nudgeField, patchForm, patchUx,
    resetEditor, selectField, setAllSections, setSection, startEditing, state, updateField,
  ]);
}

export type PaperProfileEditor = ReturnType<typeof usePaperProfileEditor>;
export { DEFAULT_FORM, DEFAULT_UX };
