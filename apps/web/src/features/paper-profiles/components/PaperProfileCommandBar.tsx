import { IconButton } from './editorPrimitives.js';
import { PresetMenu } from './PresetMenu.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { SectionKey } from '../state/editorState.js';
import type { Translate } from './types.js';

export function PaperProfileCommandBar({ editor, persistence, popups, t, scrollTo }: {
  editor: PaperProfileEditor;
  persistence: PaperProfilePersistence;
  popups: PaperProfilePopups;
  t: Translate;
  scrollTo: (section: SectionKey) => void;
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
          <button type="button" key={key} className="pp-index-btn" onClick={() => scrollTo(key)}
            title={t(`page.paperProfiles.${key}`)} aria-label={t(`page.paperProfiles.${key}`)}>
            <span aria-hidden="true">{key === 'basicInfo' ? '📄' : key === 'dimensions' ? '📐' : key === 'margins' ? '⬜' : '⚡'}</span>
          </button>
        ))}
      </nav>
      <div className="pp-command-actions">
        <div className="pp-command-status" aria-live="polite">
          <span className="pp-command-status__dot" aria-hidden="true">●</span>
          <span>{statusText}</span>
          {saveStatus === 'error' && (
            <button type="button" onClick={editor.dismissSaveError} className="pp-command-status__dismiss"
              aria-label={t('common.cancel')}>✕</button>
          )}
        </div>
        <PresetMenu editor={editor} popups={popups} t={t} />
        <IconButton icon={allExpanded ? '▾' : '▸'}
          label={allExpanded ? t('page.paperProfiles.collapseAll') : t('page.paperProfiles.expandAll')}
          onClick={() => editor.setAllSections(!allExpanded)} />
        <button type="button" className="ds-btn ds-btn--primary" onClick={() => void persistence.save()}
          disabled={persistence.savePending} title={editingProfileId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}
          aria-label={editingProfileId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}>
          <span aria-hidden="true">{persistence.savePending ? '⏳' : '💾'}</span>
        </button>
        {editingProfileId && (
          <button type="button" className="pp-icon-btn" onClick={editor.resetEditor}
            title={t('common.cancel')} aria-label={t('common.cancel')}><span aria-hidden="true">✕</span></button>
        )}
      </div>
    </div>
  );
}
