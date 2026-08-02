import { useRef } from 'react';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { SectionKey } from '../state/editorState.js';
import { BasicInfoSection } from './BasicInfoSection.js';
import { DimensionsSection } from './DimensionsSection.js';
import { DynamicFieldsSection } from './DynamicFieldsSection.js';
import { MarginsSection } from './MarginsSection.js';
import { PaperProfileCommandBar } from './PaperProfileCommandBar.js';
import type { Translate } from './types.js';

export function ProfileFormPanel({ editor, persistence, popups, t, onNotice, onSaved, onCancel }: {
  editor: PaperProfileEditor;
  persistence: PaperProfilePersistence;
  popups: PaperProfilePopups;
  t: Translate;
  onNotice: (message: string) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const basicInfo = useRef<HTMLDivElement>(null);
  const dimensions = useRef<HTMLDivElement>(null);
  const margins = useRef<HTMLDivElement>(null);
  const fields = useRef<HTMLDivElement>(null);
  const refs = { basicInfo, dimensions, margins, fields };
  const scrollTo = (section: SectionKey) => {
    if (!editor.state.sectionsOpen[section]) editor.setSection(section, true);
    refs[section].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div className="pp-form-panel">
      <PaperProfileCommandBar editor={editor} persistence={persistence} popups={popups} t={t}
        scrollTo={scrollTo} onSaved={onSaved} onCancel={onCancel} />
      <div className="pp-form-scroll">
        <BasicInfoSection editor={editor} t={t} anchorRef={basicInfo} />
        <DimensionsSection editor={editor} t={t} anchorRef={dimensions} />
        <MarginsSection editor={editor} t={t} anchorRef={margins} />
        <DynamicFieldsSection editor={editor} t={t} anchorRef={fields} onNotice={onNotice} />
      </div>
    </div>
  );
}
