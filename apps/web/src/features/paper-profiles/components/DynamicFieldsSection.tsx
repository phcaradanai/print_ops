import type { RefObject } from 'react';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { Section, s } from './editorPrimitives.js';
import { FieldCard } from './FieldCard.js';
import type { Translate } from './types.js';

export function DynamicFieldsSection({ editor, t, anchorRef, onNotice }: {
  editor: PaperProfileEditor;
  t: Translate;
  anchorRef: RefObject<HTMLDivElement>;
  onNotice: (message: string) => void;
}) {
  const fields = editor.ux.dynamicFields;
  const add = () => {
    editor.addField();
    onNotice(t('page.paperProfiles.addedFieldNote'));
  };
  return (
    <div ref={anchorRef} className="pp-section-anchor">
      <Section title={t('page.paperProfiles.fieldsCount').replace('{n}', String(fields.length))} icon="⚡"
        open={editor.state.sectionsOpen.fields}
        onToggle={() => editor.setSection('fields', !editor.state.sectionsOpen.fields)}>
        {fields.length === 0 && (
          <div className="pp-fields-empty">
            <div className="pp-fields-empty__copy">
              <span className="pp-fields-empty__icon" aria-hidden="true">⚡</span>
              <div><strong>{t('page.paperProfiles.noCustomFields')}</strong><p>{t('page.paperProfiles.clickAddField')}</p></div>
            </div>
            <button type="button" className="pp-tool-btn" onClick={add}
              title={t('page.paperProfiles.addField')} aria-label={t('page.paperProfiles.addField')}>+</button>
          </div>
        )}
        <p className="pp-preview-only-hint">{t('page.paperProfiles.previewOnlyHint')}</p>
        <div className="pp-field-list">
          {fields.map((field) => <FieldCard key={field.id} field={field} editor={editor} t={t} />)}
        </div>
        {fields.length > 0 && (
          <button type="button" className="pp-add-field"
            style={{ ...s.btnSmall, marginTop: '0.5rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#89b4fa' }}
            onClick={add} title={t('page.paperProfiles.addField')} aria-label={t('page.paperProfiles.addField')}>
            <span aria-hidden="true">+</span>
          </button>
        )}
      </Section>
    </div>
  );
}
