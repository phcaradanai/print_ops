import { Section } from './editorPrimitives.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { Translate } from './types.js';

export function BasicInfoSection({ editor, t, anchorRef }: {
  editor: PaperProfileEditor;
  t: Translate;
  anchorRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={anchorRef} className="pp-section-anchor">
      <Section title={t('page.paperProfiles.basicInfo')} icon="📄"
        open={editor.state.sectionsOpen.basicInfo}
        onToggle={() => editor.setSection('basicInfo', !editor.state.sectionsOpen.basicInfo)}>
        <div className="pp-form-grid pp-form-grid--two">
          <div>
            <label className="pp-label" htmlFor="paper-profile-code">{t('page.paperProfiles.codeLabel')}</label>
            <input id="paper-profile-code" value={editor.form.code} onChange={(event) => editor.patchForm('code', event.target.value)}
              placeholder={t('page.paperProfiles.codePlaceholder')} className="pp-input" />
          </div>
          <div>
            <label className="pp-label" htmlFor="paper-profile-name">{t('page.paperProfiles.nameLabel')} *</label>
            <input id="paper-profile-name" value={editor.form.name} onChange={(event) => editor.patchForm('name', event.target.value)}
              placeholder={t('page.paperProfiles.namePlaceholder')} className="pp-input" />
          </div>
        </div>
      </Section>
    </div>
  );
}
