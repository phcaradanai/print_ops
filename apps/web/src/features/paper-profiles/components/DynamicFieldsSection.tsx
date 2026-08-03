import type { RefObject } from 'react';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { IconButton } from '../../../components/ui/index.js';
import { Section } from './editorPrimitives.js';
import { FieldCard } from './FieldCard.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
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
      <Section title={t('page.paperProfiles.fieldsCount').replace('{n}', String(fields.length))} icon={<PaperProfileIcon name="fields" />}
        open={editor.state.sectionsOpen.fields}
        onToggle={() => editor.setSection('fields', !editor.state.sectionsOpen.fields)}>
        {fields.length === 0 && (
          <div className="pp-fields-empty">
            <div className="pp-fields-empty__copy">
              <span className="pp-fields-empty__icon" aria-hidden="true"><PaperProfileIcon name="fields" /></span>
              <div><strong>{t('page.paperProfiles.noCustomFields')}</strong><p>{t('page.paperProfiles.clickAddField')}</p></div>
            </div>
            <IconButton variant="primary" className="pp-tool-btn"
              label={t('page.paperProfiles.addField')} onClick={add}>
              <PaperProfileIcon name="plus" />
            </IconButton>
          </div>
        )}
        <p className="pp-preview-only-hint">{t('page.paperProfiles.previewOnlyHint')}</p>
        <div className="pp-field-list">
          {fields.map((field) => <FieldCard key={field.id} field={field} editor={editor} t={t} />)}
        </div>
        {fields.length > 0 && (
          <IconButton variant="primary" className="pp-add-field"
            label={t('page.paperProfiles.addField')} onClick={add}>
            <PaperProfileIcon name="plus" />
          </IconButton>
        )}
      </Section>
    </div>
  );
}
