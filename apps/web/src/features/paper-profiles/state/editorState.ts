import { DEFAULT_FORM, DEFAULT_UX } from '../model/defaults.js';
import type { DynamicField, PaperForm, PaperProfileUx, SaveStatus } from '../model/types.js';

/** What undo/redo restores: the profile content, not view state. */
export interface EditorSnapshot {
  form: PaperForm;
  fields: DynamicField[];
}

export type SectionKey = 'basicInfo' | 'dimensions' | 'margins' | 'fields';

export interface EditorState {
  form: PaperForm;
  ux: PaperProfileUx;
  /** Primary selection: the field the Properties panel and resize grip follow. */
  selectedFieldId: string | null;
  /** Every selected field, primary included. Empty when nothing is selected. */
  selectedFieldIds: string[];
  editingProfileId: string | null;
  sectionsOpen: Record<SectionKey, boolean>;
  saveStatus: SaveStatus;
  saveError: string | null;
  past: EditorSnapshot[];
  future: EditorSnapshot[];
  /** Consecutive edits with the same key (a drag, typing in one box) merge into one undo step. */
  historyKey: string | null;
}

export function createEditorState(): EditorState {
  return {
    form: { ...DEFAULT_FORM },
    ux: { ...DEFAULT_UX, dynamicFields: [] },
    selectedFieldId: null,
    selectedFieldIds: [],
    editingProfileId: null,
    sectionsOpen: { basicInfo: true, dimensions: true, margins: false, fields: true },
    saveStatus: 'idle',
    saveError: null,
    past: [],
    future: [],
    historyKey: null,
  };
}
