import { IconButton as SharedIconButton } from '../../../components/ui/index.js';
import { IconButton } from './editorPrimitives.js';
import { PresetMenu } from './PresetMenu.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { SectionKey } from '../state/editorState.js';
import type { Translate } from './types.js';
import { PaperProfileIcon, type PaperProfileIconName } from './PaperProfileIcon.js';

const SECTION_ICONS: Record<SectionKey, PaperProfileIconName> = {
  basicInfo: 'profile',
  dimensions: 'dimensions',
  margins: 'margins',
  fields: 'fields',
};

export function PaperProfileCommandBar({ editor, persistence, popups, t, scrollTo, onSaved, onCancel }: {
  editor: PaperProfileEditor;
  persistence: PaperProfilePersistence;
  popups: PaperProfilePopups;
  t: Translate;
  scrollTo: (section: SectionKey) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { saveStatus, saveError, editingProfileId, sectionsOpen } = editor.state;
  const allExpanded = Object.values(sectionsOpen).every(Boolean);
  const statusText = saveStatus === 'dirty' ? t('page.paperProfiles.unsavedChanges')
    : saveStatus === 'saving' ? t('page.paperProfiles.saving')
    : saveStatus === 'saved' ? t('page.paperProfiles.saved')
    : saveStatus === 'error' ? (saveError || t('common.error'))
    : editingProfileId ? t('page.paperProfiles.editingProfile') : t('page.paperProfiles.readyToSave');
  return (
    <div className="pp-command-bar">
      <nav className="pp-index" role="navigation" aria-label={t('page.paperProfiles.sectionIndex')}>
        {(['basicInfo', 'dimensions', 'margins', 'fields'] as SectionKey[]).map((key) => (
          <SharedIconButton key={key} variant="ghost" className="pp-index-btn"
            label={t(`page.paperProfiles.${key}`)} onClick={() => scrollTo(key)}>
            <PaperProfileIcon name={SECTION_ICONS[key]} />
          </SharedIconButton>
        ))}
      </nav>
      <div className="pp-command-actions">
        <div className="pp-command-status" aria-live="polite">
          <span className="pp-command-status__dot" aria-hidden="true" />
          <span>{statusText}</span>
          {saveStatus === 'error' && (
            <SharedIconButton variant="ghost" size="sm" className="pp-command-status__dismiss"
              label={t('common.cancel')} onClick={editor.dismissSaveError}>
              <PaperProfileIcon name="close" />
            </SharedIconButton>
          )}
        </div>
        <PresetMenu editor={editor} popups={popups} t={t} />
        <IconButton icon={<PaperProfileIcon name="chevron" className={allExpanded ? 'pp-icon--expanded' : undefined} />}
          label={allExpanded ? t('page.paperProfiles.collapseAll') : t('page.paperProfiles.expandAll')}
          onClick={() => editor.setAllSections(!allExpanded)} />
        <SharedIconButton
          variant="primary"
          busy={persistence.savePending}
          label={editingProfileId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}
          onClick={() => void persistence.save().then((saved) => { if (saved) onSaved(); })}
        >
          <PaperProfileIcon name="save" />
        </SharedIconButton>
        <SharedIconButton label={t('page.paperProfiles.backToLibrary')} onClick={onCancel}>
          <PaperProfileIcon name="close" />
        </SharedIconButton>
      </div>
    </div>
  );
}
