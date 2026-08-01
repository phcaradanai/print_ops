import { useEffect, useState } from 'react';
import { DISPLAY_UNITS, DPI_OPTIONS } from '../model/defaults.js';
import { displayValue, toMillimeters } from '../model/units.js';
import type { PaperForm } from '../model/types.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { Section } from './editorPrimitives.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function DimensionInput({ editor, field, label, t }: {
  editor: PaperProfileEditor;
  field: keyof Pick<PaperForm, 'widthMm' | 'heightMm' | 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm'>;
  label: string;
  t: Translate;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const { displayUnit } = editor.ux;
  const inputId = `paper-profile-${field}`;
  useEffect(() => setRaw(null), [displayUnit]);
  return (
    <div>
      <label className="pp-label" htmlFor={inputId}>{t(label)} ({displayUnit})</label>
      <input id={inputId} type="number" className="pp-input" step="any"
        value={raw ?? String(displayValue(editor.form[field], displayUnit, editor.form.dpi))}
        onChange={(event) => {
          setRaw(event.target.value);
          const value = Number.parseFloat(event.target.value);
          if (!Number.isNaN(value)) editor.patchForm(field, toMillimeters(value, displayUnit, editor.form.dpi));
        }}
        onBlur={() => setRaw(null)} />
    </div>
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
        <div className="pp-form-grid pp-form-grid--three">
          <div>
            <label className="pp-label" htmlFor="paper-profile-display-unit">{t('page.paperProfiles.displayUnitLabel')}</label>
            <select id="paper-profile-display-unit" value={ux.displayUnit}
              onChange={(event) => editor.patchUx('displayUnit', event.target.value as typeof ux.displayUnit)}
              className="pp-select">
              {DISPLAY_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
            </select>
          </div>
          <DimensionInput editor={editor} field="widthMm" label="page.paperProfiles.width" t={t} />
          <DimensionInput editor={editor} field="heightMm" label="page.paperProfiles.height" t={t} />
          <div>
            <label className="pp-label" htmlFor="paper-profile-orientation">{t('page.paperProfiles.orientation')}</label>
            <select id="paper-profile-orientation" value={form.orientation} className="pp-select" onChange={(event) => {
              const orientation = event.target.value as typeof form.orientation;
              if (orientation === form.orientation) return;
              const natural = form.widthMm > form.heightMm ? 'landscape' : 'portrait';
              editor.patchForm('orientation', orientation);
              if (orientation !== natural) {
                editor.patchForm('widthMm', form.heightMm);
                editor.patchForm('heightMm', form.widthMm);
              }
            }}>
              <option value="portrait">{t('page.paperProfiles.portrait')}</option>
              <option value="landscape">{t('page.paperProfiles.landscape')}</option>
            </select>
          </div>
          <div>
            <label className="pp-label" htmlFor="paper-profile-dpi">{t('page.paperProfiles.dpi')}</label>
            <select id="paper-profile-dpi" value={form.dpi} onChange={(event) => editor.patchForm('dpi', Number(event.target.value))} className="pp-select">
              {DPI_OPTIONS.map((dpi) => <option key={dpi} value={dpi}>{dpi} dpi</option>)}
            </select>
          </div>
          <div>
            <label className="pp-label" htmlFor="paper-profile-storage-unit">{t('page.paperProfiles.unitStorageLabel')}</label>
            <select id="paper-profile-storage-unit" value={form.unit} onChange={(event) => editor.patchForm('unit', event.target.value as typeof form.unit)} className="pp-select">
              <option value="mm">mm</option><option value="inch">inch</option>
            </select>
          </div>
        </div>
      </Section>
    </div>
  );
}
