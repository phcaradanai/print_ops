import { DEFAULT_FORM, DEFAULT_UX } from '../model/defaults.js';
import { resolveSelectionAfterDelete } from '../model/fieldGeometry.js';
import type { DynamicField, PaperForm, PaperProfile, PaperProfileUx, SaveStatus } from '../model/types.js';
import type { EditorState, SectionKey } from './editorState.js';

export function nextSaveStatus(
  current: SaveStatus,
  action: 'dirty' | 'save' | 'success' | 'fail' | 'reset',
): SaveStatus {
  switch (action) {
    case 'dirty':
      return current === 'idle' || current === 'saved' || current === 'error' ? 'dirty' : current;
    case 'save':
      return current !== 'saving' ? 'saving' : current;
    case 'success':
      return 'saved';
    case 'fail':
      return 'error';
    case 'reset':
      return 'idle';
  }
}

export type EditorAction =
  | { type: 'RESET_EDITOR' }
  | { type: 'LOAD_PROFILE'; profile: PaperProfile }
  | { type: 'PATCH_FORM'; patch: Partial<PaperForm> }
  | { type: 'PATCH_UX'; patch: Partial<Omit<PaperProfileUx, 'dynamicFields'>> }
  | { type: 'ADD_FIELD'; field: DynamicField }
  | { type: 'UPDATE_FIELD'; id: string; patch: Partial<DynamicField> }
  | { type: 'DELETE_FIELD'; id: string }
  | { type: 'SELECT_FIELD'; id: string | null }
  | { type: 'SET_SECTION'; section: SectionKey; open: boolean }
  | { type: 'SET_SECTIONS'; open: boolean }
  | { type: 'APPLY_PRESET'; widthMm: number; heightMm: number; dpi: number }
  | { type: 'MARK_DIRTY' }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVE_SUCCEEDED'; profileId?: string }
  | { type: 'SAVE_FAILED'; error: string }
  | { type: 'DISMISS_SAVE_ERROR' };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'RESET_EDITOR':
      return {
        ...state,
        form: { ...DEFAULT_FORM },
        ux: { ...DEFAULT_UX, dynamicFields: [] },
        selectedFieldId: null,
        editingProfileId: null,
        saveStatus: 'idle',
        saveError: null,
      };
    case 'LOAD_PROFILE':
      return {
        ...state,
        form: {
          code: action.profile.code,
          name: action.profile.name,
          widthMm: action.profile.widthMm,
          heightMm: action.profile.heightMm,
          marginTopMm: action.profile.marginTopMm,
          marginRightMm: action.profile.marginRightMm,
          marginBottomMm: action.profile.marginBottomMm,
          marginLeftMm: action.profile.marginLeftMm,
          dpi: action.profile.dpi,
          orientation: action.profile.orientation,
          unit: action.profile.unit,
        },
        ux: { ...state.ux, dynamicFields: [...(action.profile.fields ?? [])] },
        selectedFieldId: null,
        editingProfileId: action.profile.id,
        saveStatus: 'idle',
        saveError: null,
      };
    case 'PATCH_FORM':
      return { ...state, form: { ...state.form, ...action.patch }, saveStatus: nextSaveStatus(state.saveStatus, 'dirty') };
    case 'PATCH_UX':
      return { ...state, ux: { ...state.ux, ...action.patch }, saveStatus: nextSaveStatus(state.saveStatus, 'dirty') };
    case 'ADD_FIELD':
      return {
        ...state,
        ux: { ...state.ux, dynamicFields: [...state.ux.dynamicFields, action.field] },
        selectedFieldId: action.field.id,
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    case 'UPDATE_FIELD':
      return {
        ...state,
        ux: {
          ...state.ux,
          dynamicFields: state.ux.dynamicFields.map((field) =>
            field.id === action.id ? { ...field, ...action.patch } : field,
          ),
        },
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    case 'DELETE_FIELD':
      return {
        ...state,
        ux: {
          ...state.ux,
          dynamicFields: state.ux.dynamicFields.filter((field) => field.id !== action.id),
        },
        selectedFieldId: resolveSelectionAfterDelete(state.ux.dynamicFields, action.id, state.selectedFieldId),
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    case 'SELECT_FIELD':
      return { ...state, selectedFieldId: action.id };
    case 'SET_SECTION':
      return { ...state, sectionsOpen: { ...state.sectionsOpen, [action.section]: action.open } };
    case 'SET_SECTIONS':
      return {
        ...state,
        sectionsOpen: Object.fromEntries(
          Object.keys(state.sectionsOpen).map((section) => [section, action.open]),
        ) as EditorState['sectionsOpen'],
      };
    case 'APPLY_PRESET':
      return {
        ...state,
        form: {
          ...state.form,
          widthMm: action.widthMm,
          heightMm: action.heightMm,
          dpi: action.dpi,
          orientation: action.widthMm > action.heightMm ? 'landscape' : 'portrait',
        },
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    case 'MARK_DIRTY':
      return { ...state, saveStatus: nextSaveStatus(state.saveStatus, 'dirty') };
    case 'SAVE_STARTED':
      return { ...state, saveStatus: 'saving', saveError: null };
    case 'SAVE_SUCCEEDED':
      return {
        ...state,
        editingProfileId: action.profileId ?? state.editingProfileId,
        saveStatus: 'saved',
        saveError: null,
      };
    case 'SAVE_FAILED':
      return { ...state, saveStatus: 'error', saveError: action.error };
    case 'DISMISS_SAVE_ERROR':
      return { ...state, saveStatus: 'idle', saveError: null };
  }
}
