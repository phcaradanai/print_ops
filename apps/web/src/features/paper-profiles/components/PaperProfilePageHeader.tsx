import { IconButton } from './editorPrimitives.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import { displayValue } from '../model/units.js';
import type { Translate } from './types.js';

export function PaperProfilePageHeader({ editor, popups, t }: {
  editor: PaperProfileEditor;
  popups: PaperProfilePopups;
  t: Translate;
}) {
  const { form, ux } = editor;
  return (
    <header className="pp-page-header">
      <div className="pp-page-heading">
        <span className="pp-page-heading__icon" aria-hidden="true">📄</span>
        <div>
          <h1>{t('page.paperProfiles.title')}</h1>
          <div className="pp-page-heading__meta">
            <span>{form.code || 'auto'}</span>
            <span>{displayValue(form.widthMm, ux.displayUnit, form.dpi)} × {displayValue(form.heightMm, ux.displayUnit, form.dpi)} {ux.displayUnit}</span>
          </div>
        </div>
      </div>
      <div className="pp-toolbar" role="toolbar" aria-label={t('page.paperProfiles.pageActions')}>
        <IconButton icon="⛶" label={t('page.paperProfiles.fullPreview')} onClick={popups.openFullPreview} active />
        <IconButton icon="⚡" label={t('page.paperProfiles.toggleFields')} onClick={() => popups.toggleDrawer('fields')} active={popups.drawer === 'fields'} />
        <IconButton icon="🎨" label={t('page.paperProfiles.toggleStyle')} onClick={() => popups.toggleDrawer('appearance')} active={popups.drawer === 'appearance'} />
        <IconButton icon="📥" label={t('page.paperProfiles.importDesign')} onClick={() => popups.openDrawer('import')} active={popups.drawer === 'import'} />
      </div>
    </header>
  );
}
