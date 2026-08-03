import { useEffect, useState } from 'react';
import { DISPLAY_UNITS, DPI_OPTIONS } from '../model/defaults.js';
import { displayValue, toMillimeters } from '../model/units.js';
import type { PaperForm } from '../model/types.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { FormField, Grid, Input, Select } from '../../../components/ui/index.js';
import { Section } from './editorPrimitives.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function DimensionInput({ editor, field, label, t }: {
  editor: PaperProfileEditor;
  field: keyof Pick<PaperForm, 'widthMm' | 'heightMm' | 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm'>;
  label: string;
  t: Translate;
}) {
  // While the field has focus the raw string wins, so a half-typed "1." or a
  // cleared box is not stomped by the millimetre round-trip on every keystroke.
  const [raw, setRaw] = useState<string | null>(null);
  const { displayUnit } = editor.ux;
  useEffect(() => setRaw(null), [displayUnit]);
  return (
    <FormField label={`${t(label)} (${displayUnit})`}>
      {(control) => (
        <Input
          {...control}
          type="number"
          step="any"
          value={raw ?? String(displayValue(editor.form[field], displayUnit, editor.form.dpi))}
          onChange={(event) => {
            setRaw(event.target.value);
            const value = Number.parseFloat(event.target.value);
            if (!Number.isNaN(value)) editor.patchForm(field, toMillimeters(value, displayUnit, editor.form.dpi));
          }}
          onBlur={() => setRaw(null)}
        />
      )}
    </FormField>
  );
}

export function DimensionsSection({ editor, t, anchorRef }: {
  editor: PaperProfileEditor;
  t: Translate;
  anchorRef: React.RefObject<HTMLDivElement>;
}) {
  const { form, ux } = editor;
  return (
    <div ref={anchorRef} className="pp-section-anchor">
      <Section title={t('page.paperProfiles.dimensions')} icon={<PaperProfileIcon name="dimensions" />}
        open={editor.state.sectionsOpen.dimensions}
        onToggle={() => editor.setSection('dimensions', !editor.state.sectionsOpen.dimensions)}>
        <Grid columns={3} gap="md">
          <FormField label={t('page.paperProfiles.displayUnitLabel')}>
            {(control) => (
              <Select
                {...control}
                value={ux.displayUnit}
                onChange={(event) => editor.patchUx('displayUnit', event.target.value as typeof ux.displayUnit)}
              >
                {DISPLAY_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
              </Select>
            )}
          </FormField>

          <DimensionInput editor={editor} field="widthMm" label="page.paperProfiles.width" t={t} />
          <DimensionInput editor={editor} field="heightMm" label="page.paperProfiles.height" t={t} />

          <FormField label={t('page.paperProfiles.orientation')}>
            {(control) => (
              <Select
                {...control}
                value={form.orientation}
                onChange={(event) => {
                  const orientation = event.target.value as typeof form.orientation;
                  if (orientation === form.orientation) return;
                  // Rotating the sheet swaps the sides rather than leaving the
                  // label claiming an orientation its dimensions contradict.
                  const natural = form.widthMm > form.heightMm ? 'landscape' : 'portrait';
                  editor.patchForm('orientation', orientation);
                  if (orientation !== natural) {
                    editor.patchForm('widthMm', form.heightMm);
                    editor.patchForm('heightMm', form.widthMm);
                  }
                }}
              >
                <option value="portrait">{t('page.paperProfiles.portrait')}</option>
                <option value="landscape">{t('page.paperProfiles.landscape')}</option>
              </Select>
            )}
          </FormField>

          <FormField label={t('page.paperProfiles.dpi')}>
            {(control) => (
              <Select
                {...control}
                value={form.dpi}
                onChange={(event) => editor.patchForm('dpi', Number(event.target.value))}
              >
                {DPI_OPTIONS.map((dpi) => <option key={dpi} value={dpi}>{dpi} dpi</option>)}
              </Select>
            )}
          </FormField>

          <FormField label={t('page.paperProfiles.unitStorageLabel')}>
            {(control) => (
              <Select
                {...control}
                value={form.unit}
                onChange={(event) => editor.patchForm('unit', event.target.value as typeof form.unit)}
              >
                <option value="mm">mm</option>
                <option value="inch">inch</option>
              </Select>
            )}
          </FormField>
        </Grid>
      </Section>
    </div>
  );
}
