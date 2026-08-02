import { DEFAULT_FORM, DEFAULT_UX } from '../model/defaults.js';
import type { PaperForm, PaperProfileUx, SaveStatus } from '../model/types.js';

export type SectionKey = 'basicInfo' | 'dimensions' | 'margins' | 'fields';

export interface EditorState {
  form: PaperForm;
  ux: PaperProfileUx;
  selectedFieldId: string | null;
  editingProfileId: string | null;
  sectionsOpen: Record<SectionKey, boolean>;
  saveStatus: SaveStatus;
  saveError: string | null;
}

export function createEditorState(): EditorState {
  return {
    form: { ...DEFAULT_FORM },
    ux: { ...DEFAULT_UX, dynamicFields: [] },
    selectedFieldId: null,
    editingProfileId: null,
    sectionsOpen: { basicInfo: true, dimensions: true, margins: false, fields: true },
    saveStatus: 'idle',
    saveError: null,
  };
}
