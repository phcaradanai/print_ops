import { FONT_LIST } from '../model/defaults.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import { ColorInput } from './editorPrimitives.js';
import { FieldCard } from './FieldCard.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
import { Button, Drawer, FormField, Input, Select, Stack } from '../../../components/ui/index.js';

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
              <Button variant="secondary" className="pp-add-field" onClick={() => editor.addField()}>
                <PaperProfileIcon name="plus" /> {t('page.paperProfiles.addField')}
              </Button>
            </>
          ) : (
            <Stack gap="md" className="pp-appearance-form">
              <FormField label={t('page.paperProfiles.fontFamily')}>
                {(control) => (
                  <Select
                    {...control}
                    value={editor.ux.fontFamily}
                    onChange={(event) => editor.patchUx('fontFamily', event.target.value)}
                  >
                    {FONT_LIST.map((font) => (
                      <option key={font} value={font}>{font.split(',')[0].replaceAll('"', '')}</option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField label={t('page.paperProfiles.fontSize')}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    value={editor.ux.fontSize}
                    onChange={(event) => editor.patchUx('fontSize', Number(event.target.value))}
                  />
                )}
              </FormField>
              <ColorInput label={t('page.paperProfiles.fontColor')} value={editor.ux.fontColor}
                onChange={(value) => editor.patchUx('fontColor', value)} />
              <ColorInput label={t('page.paperProfiles.backgroundColor')} value={editor.ux.bgColor}
                onChange={(value) => editor.patchUx('bgColor', value)} />
              <FormField label={t('page.paperProfiles.watermark')}>
                {(control) => (
                  <Input
                    {...control}
                    value={editor.ux.watermarkText}
                    onChange={(event) => editor.patchUx('watermarkText', event.target.value)}
                  />
                )}
              </FormField>
            </Stack>
          )}
    </Drawer>
  );
}
