import { useEffect, useState } from 'react';
import { DISPLAY_UNITS, DPI_OPTIONS } from '../model/defaults.js';
import { displayValue, toMillimeters } from '../model/units.js';
import type { PaperForm, PaperProfileLayout } from '../model/types.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { FormField, Grid, Input, Select, Switch } from '../../../components/ui/index.js';
import { Section } from './editorPrimitives.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function DimensionInput({ editor, field, label, t }: {
  editor: PaperProfileEditor;
  field: keyof Pick<PaperForm, 'widthMm' | 'heightMm' | 'gapMm' | 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm'>;
  label: string;
  t: Translate;
}) {
  // While the field has focus the raw string wins, so a half-typed "1." or a
  // cleared box is not stomped by the millimetre round-trip on every keystroke.
  const [raw, setRaw] = useState<string | null>(null);
  const { displayUnit } = editor.ux;
  useEffect(() => setRaw(null), [displayUnit]);
  const valueMm = editor.form[field] ?? 0;
  return (
    <FormField label={`${t(label)} (${displayUnit})`}>
      {(control) => (
        <Input
          {...control}
          type="number"
          step="any"
           value={raw ?? String(displayValue(valueMm, displayUnit, editor.form.dpi))}
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

function LayoutInput({ editor, field, label, t }: {
  editor: PaperProfileEditor;
  field: keyof PaperProfileLayout;
  label: string;
  t: Translate;
}) {
  const layout = editor.form.layout;
  const value = layout?.[field] ?? (field === 'columns' ? 1 : field === 'cellWidthMm'
    ? Math.max(0, editor.form.widthMm - editor.form.marginLeftMm - editor.form.marginRightMm)
    : field === 'cellHeightMm'
      ? Math.max(0, editor.form.heightMm - editor.form.marginTopMm - editor.form.marginBottomMm)
      : field === 'rowPitchMm'
        ? Math.max(0, editor.form.heightMm - editor.form.marginTopMm - editor.form.marginBottomMm + (editor.form.gapMm ?? 0))
        : 0);
  return (
    <FormField label={t(label)}>
      {(control) => (
        <Input
          {...control}
          type="number"
          min={field === 'columns' ? 1 : 0}
          step={field === 'columns' ? 1 : 'any'}
          value={value}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value);
            if (!Number.isFinite(next)) return;
            const current = layout ?? {
              columns: 1,
              cellWidthMm: editor.form.widthMm - editor.form.marginLeftMm - editor.form.marginRightMm,
              cellHeightMm: editor.form.heightMm - editor.form.marginTopMm - editor.form.marginBottomMm,
              columnGapMm: editor.form.gapMm ?? 0,
              rowPitchMm: editor.form.heightMm - editor.form.marginTopMm - editor.form.marginBottomMm + (editor.form.gapMm ?? 0),
            };
            editor.patchForm('layout', {
              ...current,
              [field]: field === 'columns' ? Math.max(1, Math.round(next)) : next,
            });
          }}
        />
      )}
    </FormField>
  );
}

function layoutIssues(form: PaperForm): string[] {
  const layout = form.layout;
  if (!layout) return [];
  const printableWidth = form.widthMm - form.marginLeftMm - form.marginRightMm;
  const printableHeight = form.heightMm - form.marginTopMm - form.marginBottomMm;
  const usedWidth = layout.columns * layout.cellWidthMm + Math.max(0, layout.columns - 1) * layout.columnGapMm;
  const issues: string[] = [];
  if (!Number.isInteger(layout.columns) || layout.columns < 1) issues.push('page.paperProfiles.layoutColumnsInvalid');
  if (layout.cellWidthMm <= 0 || layout.cellHeightMm <= 0 || layout.rowPitchMm <= 0) issues.push('page.paperProfiles.layoutValuesInvalid');
  if (layout.columnGapMm < 0) issues.push('page.paperProfiles.layoutGapInvalid');
  if (usedWidth > printableWidth + 0.0001) issues.push('page.paperProfiles.layoutWidthInvalid');
  if (layout.cellHeightMm > printableHeight + 0.0001) issues.push('page.paperProfiles.layoutHeightInvalid');
  if (layout.rowPitchMm < layout.cellHeightMm) issues.push('page.paperProfiles.layoutPitchInvalid');
  return issues;
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
          <DimensionInput editor={editor} field="gapMm" label="page.paperProfiles.gap" t={t} />

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
          <FormField label={t('page.paperProfiles.rotation')}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                max={359}
                step="any"
                value={form.rotation}
                onChange={(event) => {
                  const value = Number.parseFloat(event.target.value);
                  if (Number.isFinite(value)) {
                    editor.patchForm('rotation', Math.max(0, Math.min(359, value)));
                  }
                }}
              />
            )}
          </FormField>

          <Switch
            label={t('page.paperProfiles.flipHorizontal')}
            onLabel={t('status.on')}
            offLabel={t('status.off')}
            checked={Boolean(form.flipHorizontal)}
            onChange={(event) => editor.patchForm('flipHorizontal', event.target.checked)}
          />

          <Switch
            label={t('page.paperProfiles.flipVertical')}
            onLabel={t('status.on')}
            offLabel={t('status.off')}
            checked={Boolean(form.flipVertical)}
            onChange={(event) => editor.patchForm('flipVertical', event.target.checked)}
          />
        </Grid>
        <div className="pp-layout-controls">
          <div className="pp-layout-controls__heading">
            <strong>{t('page.paperProfiles.layoutTitle')}</strong>
            <span>{t('page.paperProfiles.layoutHint')}</span>
          </div>
          <Grid columns={3} gap="md">
            <LayoutInput editor={editor} field="columns" label="page.paperProfiles.layoutColumns" t={t} />
            <LayoutInput editor={editor} field="cellWidthMm" label="page.paperProfiles.layoutCellWidth" t={t} />
            <LayoutInput editor={editor} field="cellHeightMm" label="page.paperProfiles.layoutCellHeight" t={t} />
            <LayoutInput editor={editor} field="columnGapMm" label="page.paperProfiles.layoutColumnGap" t={t} />
            <LayoutInput editor={editor} field="rowPitchMm" label="page.paperProfiles.layoutRowPitch" t={t} />
          </Grid>
          <div className="pp-layout-summary" role="status">
            {editor.form.layout
              ? `${t('page.paperProfiles.layoutUsedWidth')}: ${(editor.form.layout.columns * editor.form.layout.cellWidthMm + Math.max(0, editor.form.layout.columns - 1) * editor.form.layout.columnGapMm).toFixed(2)} / ${Math.max(0, editor.form.widthMm - editor.form.marginLeftMm - editor.form.marginRightMm).toFixed(2)} mm`
              : t('page.paperProfiles.layoutSingleColumn')}
          </div>
          {layoutIssues(editor.form).map((issue) => <div className="pp-layout-error" role="alert" key={issue}>{t(issue)}</div>)}
        </div>
      </Section>
    </div>
  );
}
