import { IconButton } from './editorPrimitives.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import { getVisualPaperGeometry } from '../model/geometry.js';
import { displayValue } from '../model/units.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
import { TransferIcon } from '../../../components/TransferIcon.js';

export function PaperProfilePageHeader({ editor, popups, stage, onCreate, onBack, t }: {
  editor: PaperProfileEditor;
  popups: PaperProfilePopups;
  stage: 'library' | 'editor';
  onCreate: () => void;
  onBack: () => void;
  t: Translate;
}) {
  const { form, ux } = editor;
  const geometry = getVisualPaperGeometry(form);
  if (stage === 'library') {
    return (
      <div className="pp-page-header pp-page-header--library">
        <div className="pp-page-heading">
          <div>
            <h1>{t('page.paperProfiles.title')}</h1>
            <p className="pp-page-heading__description">{t('page.paperProfiles.libraryDescription')}</p>
          </div>
        </div>
        <button type="button" className="ds-btn ds-btn--secondary" onClick={onCreate}>
          <PaperProfileIcon name="plus" /> {t('page.paperProfiles.createProfile')}
        </button>
      </div>
    );
  }
  return (
    <div className="pp-page-header pp-page-header--editor">
      <div className="pp-editor-heading">
        <button type="button" className="pp-back-button" onClick={onBack}>
          <PaperProfileIcon name="arrow-left" /> <span>{t('page.paperProfiles.backToLibrary')}</span>
        </button>
        <div className="pp-page-heading">
          <div>
            <h1>{editor.state.editingProfileId ? t('page.paperProfiles.editProfileTitle') : t('page.paperProfiles.createProfileTitle')}</h1>
            <div className="pp-page-heading__meta">
              <span>{form.code || 'auto'}</span>
              <span>{displayValue(geometry.widthMm, ux.displayUnit, form.dpi)} × {displayValue(geometry.heightMm, ux.displayUnit, form.dpi)} {ux.displayUnit}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="pp-toolbar" role="toolbar" aria-label={t('page.paperProfiles.pageActions')}>
        <IconButton icon={<PaperProfileIcon name="expand" />} label={t('page.paperProfiles.fullPreview')} onClick={popups.openFullPreview} />
        <IconButton icon={<PaperProfileIcon name="fields" />} label={t('page.paperProfiles.toggleFields')} onClick={() => popups.toggleDrawer('fields')} active={popups.drawer === 'fields'} />
        <IconButton icon={<PaperProfileIcon name="palette" />} label={t('page.paperProfiles.toggleStyle')} onClick={() => popups.toggleDrawer('appearance')} active={popups.drawer === 'appearance'} />
        <IconButton icon={<TransferIcon action="import" />} label={t('page.paperProfiles.importDesign')} onClick={() => popups.openDrawer('import')} active={popups.drawer === 'import'} />
      </div>
    </div>
  );
}
