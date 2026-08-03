import { FormField, Grid, Input } from '../../../components/ui/index.js';
import { Section } from './editorPrimitives.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function BasicInfoSection({ editor, t, anchorRef }: {
  editor: PaperProfileEditor;
  t: Translate;
  anchorRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={anchorRef} className="pp-section-anchor">
      <Section title={t('page.paperProfiles.basicInfo')} icon={<PaperProfileIcon name="profile" />}
        open={editor.state.sectionsOpen.basicInfo}
        onToggle={() => editor.setSection('basicInfo', !editor.state.sectionsOpen.basicInfo)}>
        <Grid columns={2} gap="md">
          <FormField label={t('page.paperProfiles.codeLabel')}>
            {(control) => (
              <Input
                {...control}
                value={editor.form.code}
                onChange={(event) => editor.patchForm('code', event.target.value)}
                placeholder={t('page.paperProfiles.codePlaceholder')}
              />
            )}
          </FormField>
          <FormField label={t('page.paperProfiles.nameLabel')} required>
            {(control) => (
              <Input
                {...control}
                value={editor.form.name}
                onChange={(event) => editor.patchForm('name', event.target.value)}
                placeholder={t('page.paperProfiles.namePlaceholder')}
              />
            )}
          </FormField>
        </Grid>
      </Section>
    </div>
  );
}
