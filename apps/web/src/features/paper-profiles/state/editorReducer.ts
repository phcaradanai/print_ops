import { DEFAULT_FORM, DEFAULT_UX } from '../model/defaults.js';
import { resolveSelectionAfterDelete } from '../model/fieldGeometry.js';
import type { DynamicField, PaperForm, PaperProfile, PaperProfileUx, SaveStatus } from '../model/types.js';
import type { EditorSnapshot, EditorState, SectionKey } from './editorState.js';

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
  | { type: 'ADD_FIELDS'; fields: DynamicField[] }
  | { type: 'UPDATE_FIELD'; id: string; patch: Partial<DynamicField> }
  | { type: 'UPDATE_FIELDS'; patches: { id: string; patch: Partial<DynamicField> }[] }
  | { type: 'DELETE_FIELD'; id: string }
  | { type: 'DELETE_FIELDS'; ids: string[] }
  /** Z-order: later fields print on top. */
  | { type: 'REORDER_FIELDS'; ids: string[]; to: 'front' | 'back' }
  | { type: 'SELECT_FIELD'; id: string | null }
  /** Shift/Cmd/Ctrl-click: add the field to the selection, or take it out. */
  | { type: 'TOGGLE_FIELD_SELECTION'; id: string }
  /** Marquee: replace the selection with exactly these fields. */
  | { type: 'SET_SELECTION'; ids: string[] }
  | { type: 'SET_SECTION'; section: SectionKey; open: boolean }
  | { type: 'SET_SECTIONS'; open: boolean }
  | { type: 'APPLY_PRESET'; widthMm: number; heightMm: number; dpi: number }
  | { type: 'MARK_DIRTY' }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVE_SUCCEEDED'; profileId?: string }
  | { type: 'SAVE_FAILED'; error: string }
  | { type: 'DISMISS_SAVE_ERROR' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  /** Ends the current merged edit, e.g. when a drag is released. */
  | { type: 'BREAK_HISTORY' };

const HISTORY_LIMIT = 100;

/** Undo-step key for an edit action; null for actions that are not edits. */
function historyKeyFor(action: EditorAction): string | null | undefined {
  switch (action.type) {
    case 'UPDATE_FIELD': return `field:${action.id}:${Object.keys(action.patch).sort().join(',')}`;
    case 'UPDATE_FIELDS': return `fields:${action.patches.map((p) => `${p.id}=${Object.keys(p.patch).sort().join(',')}`).join(';')}`;
    case 'ADD_FIELDS': case 'DELETE_FIELDS': case 'REORDER_FIELDS': return null;
    case 'PATCH_FORM': return `form:${Object.keys(action.patch).sort().join(',')}`;
    case 'ADD_FIELD': case 'DELETE_FIELD': case 'APPLY_PRESET': return null;
    default: return undefined;
  }
}

/** Selection state for `ids`, keeping `preferred` as primary when it is still selected. */
function selection(ids: string[], preferred: string | null): Pick<EditorState, 'selectedFieldId' | 'selectedFieldIds'> {
  return { selectedFieldIds: ids, selectedFieldId: preferred && ids.includes(preferred) ? preferred : ids.at(-1) ?? null };
}

const snapshot = (state: EditorState): EditorSnapshot => ({ form: state.form, fields: state.ux.dynamicFields });

function restore(state: EditorState, target: EditorSnapshot, past: EditorSnapshot[], future: EditorSnapshot[]): EditorState {
  return {
    ...state,
    form: target.form,
    ux: { ...state.ux, dynamicFields: target.fields },
    ...selection(state.selectedFieldIds.filter((id) => target.fields.some((field) => field.id === id)), state.selectedFieldId),
    past,
    future,
    historyKey: null,
    saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
  };
}

/** Figma-style undo/redo around the plain editor reducer. */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'UNDO') {
    const previous = state.past.at(-1);
    return previous ? restore(state, previous, state.past.slice(0, -1), [snapshot(state), ...state.future]) : state;
  }
  if (action.type === 'REDO') {
    const [next, ...future] = state.future;
    return next ? restore(state, next, [...state.past, snapshot(state)], future) : state;
  }
  if (action.type === 'BREAK_HISTORY' || action.type === 'SELECT_FIELD' || action.type === 'TOGGLE_FIELD_SELECTION' || action.type === 'SET_SELECTION') {
    const next = action.type === 'BREAK_HISTORY' ? state : baseReducer(state, action);
    return next.historyKey === null ? next : { ...next, historyKey: null };
  }
  if (action.type === 'RESET_EDITOR' || action.type === 'LOAD_PROFILE') {
    return { ...baseReducer(state, action), past: [], future: [], historyKey: null };
  }
  const key = historyKeyFor(action);
  const next = baseReducer(state, action);
  if (key === undefined || (next.form === state.form && next.ux.dynamicFields === state.ux.dynamicFields)) return next;
  const merge = key !== null && key === state.historyKey;
  return {
    ...next,
    past: merge ? state.past : [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
    future: [],
    historyKey: key,
  };
}

function baseReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'RESET_EDITOR':
      return {
        ...state,
        form: { ...DEFAULT_FORM },
        ux: { ...DEFAULT_UX, dynamicFields: [] },
        selectedFieldId: null,
        selectedFieldIds: [],
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
          gapMm: action.profile.gapMm ?? 0,
          heightMm: action.profile.heightMm,
          marginTopMm: action.profile.marginTopMm,
          marginRightMm: action.profile.marginRightMm,
          marginBottomMm: action.profile.marginBottomMm,
          marginLeftMm: action.profile.marginLeftMm,
          dpi: action.profile.dpi,
          orientation: action.profile.orientation,
          unit: action.profile.unit,
          rotation: action.profile.rotation ?? 0,
          flipHorizontal: action.profile.flipHorizontal ?? false,
          flipVertical: action.profile.flipVertical ?? false,
          layout: action.profile.layout ? { ...action.profile.layout } : undefined,
        },
        ux: { ...state.ux, dynamicFields: [...(action.profile.fields ?? [])] },
        selectedFieldId: null,
        selectedFieldIds: [],
        editingProfileId: action.profile.id,
        saveStatus: 'idle',
        saveError: null,
      };
    case 'PATCH_FORM':
      return { ...state, form: { ...state.form, ...action.patch }, saveStatus: nextSaveStatus(state.saveStatus, 'dirty') };
    case 'PATCH_UX':
      return { ...state, ux: { ...state.ux, ...action.patch } };
    case 'ADD_FIELD':
      return {
        ...state,
        ux: { ...state.ux, dynamicFields: [...state.ux.dynamicFields, action.field] },
        selectedFieldId: action.field.id,
        selectedFieldIds: [action.field.id],
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    case 'ADD_FIELDS':
      if (action.fields.length === 0) return state;
      return {
        ...state,
        ux: { ...state.ux, dynamicFields: [...state.ux.dynamicFields, ...action.fields] },
        ...selection(action.fields.map((field) => field.id), null),
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    case 'UPDATE_FIELDS': {
      const patches = new Map(action.patches.map((p) => [p.id, p.patch]));
      return {
        ...state,
        ux: {
          ...state.ux,
          dynamicFields: state.ux.dynamicFields.map((field) =>
            patches.has(field.id) ? { ...field, ...patches.get(field.id) } : field,
          ),
        },
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    }
    case 'REORDER_FIELDS': {
      const moving = new Set(action.ids);
      const picked = state.ux.dynamicFields.filter((field) => moving.has(field.id));
      const rest = state.ux.dynamicFields.filter((field) => !moving.has(field.id));
      const dynamicFields = action.to === 'front' ? [...rest, ...picked] : [...picked, ...rest];
      if (dynamicFields.every((field, i) => field === state.ux.dynamicFields[i])) return state;
      return { ...state, ux: { ...state.ux, dynamicFields }, saveStatus: nextSaveStatus(state.saveStatus, 'dirty') };
    }
    case 'DELETE_FIELDS': {
      const doomed = new Set(action.ids);
      if (!state.ux.dynamicFields.some((field) => doomed.has(field.id))) return state;
      return {
        ...state,
        ux: { ...state.ux, dynamicFields: state.ux.dynamicFields.filter((field) => !doomed.has(field.id)) },
        ...selection(state.selectedFieldIds.filter((id) => !doomed.has(id)), state.selectedFieldId),
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    }
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
    case 'DELETE_FIELD': {
      const remaining = state.selectedFieldIds.filter((id) => id !== action.id);
      const fallback = resolveSelectionAfterDelete(state.ux.dynamicFields, action.id, state.selectedFieldId);
      return {
        ...state,
        ux: {
          ...state.ux,
          dynamicFields: state.ux.dynamicFields.filter((field) => field.id !== action.id),
        },
        ...(remaining.length > 0 ? selection(remaining, state.selectedFieldId) : selection(fallback ? [fallback] : [], fallback)),
        saveStatus: nextSaveStatus(state.saveStatus, 'dirty'),
      };
    }
    case 'SELECT_FIELD':
      return { ...state, ...selection(action.id ? [action.id] : [], action.id) };
    case 'SET_SELECTION': {
      const ids = action.ids.filter((id) => state.ux.dynamicFields.some((field) => field.id === id));
      const same = ids.length === state.selectedFieldIds.length && ids.every((id, i) => id === state.selectedFieldIds[i]);
      return same ? state : { ...state, ...selection(ids, state.selectedFieldId) };
    }
    case 'TOGGLE_FIELD_SELECTION':
      return state.selectedFieldIds.includes(action.id)
        ? { ...state, ...selection(state.selectedFieldIds.filter((id) => id !== action.id), state.selectedFieldId) }
        : { ...state, ...selection([...state.selectedFieldIds, action.id], action.id) };
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
    default:
      return state;
  }
}
