import { FONT_LIST } from '../model/defaults.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import { ColorInput } from './editorPrimitives.js';
import { FieldCard } from './FieldCard.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
import { Drawer } from '../../../components/ui/index.js';

export function EditorDrawer({ editor, popups, t }: {
  editor: PaperProfileEditor;
  popups: PaperProfilePopups;
  t: Translate;
}) {
  const title = popups.drawer === 'fields'
    ? t('page.paperProfiles.dynamicFieldsEditor')
    : t('page.paperProfiles.appearanceEditor');
  return (
    <Drawer open onClose={popups.closeDrawer} title={title} closeLabel={t('common.cancel')}>
          {popups.drawer === 'fields' ? (
            <>
              {editor.ux.dynamicFields.map((field) => <FieldCard key={field.id} field={field} editor={editor} t={t} />)}
              <button type="button" className="pp-add-field" onClick={() => editor.addField()}><PaperProfileIcon name="plus" /> {t('page.paperProfiles.addField')}</button>
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
    </Drawer>
  );
}
