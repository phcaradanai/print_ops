import { FONT_LIST } from '../model/defaults.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import { ColorInput } from './editorPrimitives.js';
import { FieldCard } from './FieldCard.js';
import type { Translate } from './types.js';

export function EditorDrawer({ editor, popups, t }: {
  editor: PaperProfileEditor;
  popups: PaperProfilePopups;
  t: Translate;
}) {
  const title = popups.drawer === 'fields'
    ? t('page.paperProfiles.dynamicFieldsEditor')
    : t('page.paperProfiles.appearanceEditor');
  return (
    <>
      <div className="pp-drawer-backdrop" onClick={popups.closeDrawer} />
      <div className="pp-drawer" role="dialog" aria-modal="true" aria-label={title}
        ref={popups.drawerRef} tabIndex={-1}>
        <div className="pp-drawer__header"><span className="pp-drawer__title">{title}</span>
          <button className="pp-tool-btn" ref={popups.drawerCloseButtonRef}
            title={t('common.cancel')} aria-label={t('common.cancel')} onClick={popups.closeDrawer}>✕</button></div>
        <div className="pp-drawer__body">
          {popups.drawer === 'fields' ? (
            <>
              {editor.ux.dynamicFields.map((field) => <FieldCard key={field.id} field={field} editor={editor} t={t} />)}
              <button type="button" className="pp-add-field" onClick={() => editor.addField()}>+ {t('page.paperProfiles.addField')}</button>
            </>
          ) : (
            <div className="pp-appearance-form">
              <label>{t('page.paperProfiles.fontFamily')}
                <select className="pp-select" value={editor.ux.fontFamily}
                  onChange={(event) => editor.patchUx('fontFamily', event.target.value)}>
                  {FONT_LIST.map((font) => <option key={font} value={font}>{font.split(',')[0].replaceAll('"', '')}</option>)}
                </select>
              </label>
              <label>{t('page.paperProfiles.fontSize')}
                <input className="pp-input" type="number" value={editor.ux.fontSize}
                  onChange={(event) => editor.patchUx('fontSize', Number(event.target.value))} />
              </label>
              <ColorInput label={t('page.paperProfiles.fontColor')} value={editor.ux.fontColor}
                onChange={(value) => editor.patchUx('fontColor', value)} />
              <ColorInput label={t('page.paperProfiles.backgroundColor')} value={editor.ux.bgColor}
                onChange={(value) => editor.patchUx('bgColor', value)} />
              <label>{t('page.paperProfiles.watermark')}
                <input className="pp-input" value={editor.ux.watermarkText}
                  onChange={(event) => editor.patchUx('watermarkText', event.target.value)} />
              </label>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
