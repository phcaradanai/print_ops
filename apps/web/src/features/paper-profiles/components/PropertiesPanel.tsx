import type { ReactNode } from 'react';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_BARCODE_WIDTH_MM, DEFAULT_QR_SIZE_MM } from '../model/defaults.js';
import { clampFontSize } from '../model/geometry.js';
import { displayValue, toMillimeters } from '../model/units.js';
import type { DynamicField, PaperForm } from '../model/types.js';
import { DraftNumberInput } from './DraftNumberInput.js';
import { IconButton } from './editorPrimitives.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
import type { Translate } from './types.js';

/**
 * Figma/Canva-style contextual inspector beside the canvas: the selected
 * field's properties, or the paper's when nothing is selected.
 */
export function PropertiesPanel({ editor, t }: { editor: PaperProfileEditor; t: Translate }) {
  const field = editor.selectedField;
  return (
    <section className="pp-props" aria-label={t('page.paperProfiles.propertiesTitle')} aria-live="polite">
      {field ? <FieldProperties field={field} editor={editor} t={t} /> : <PaperProperties editor={editor} t={t} />}
      <p className="pp-props__hint">{t('page.paperProfiles.canvasShortcutsHint')}</p>
    </section>
  );
}

function FieldProperties({ field, editor, t }: { field: DynamicField; editor: PaperProfileEditor; t: Translate }) {
  const update = (patch: Partial<DynamicField>) => editor.updateField(field.id, patch);
  const isText = field.type !== 'barcode' && field.type !== 'qrcode';
  return (
    <>
      <header className="pp-props__header">
        <span className="pp-field-type-badge">{field.type === 'qrcode' ? 'QR' : field.type}</span>
        <strong>{field.label || field.key || t('page.paperProfiles.untitledField')}</strong>
        <IconButton icon={<PaperProfileIcon name="trash" />} label={t('page.paperProfiles.remove')}
          onClick={() => editor.deleteField(field.id)} />
      </header>
      <PropRow>
        <Num prefix="X" label={t('page.paperProfiles.fieldXmm')} value={field.xMm} onChange={(xMm) => update({ xMm })} />
        <Num prefix="Y" label={t('page.paperProfiles.fieldYmm')} value={field.yMm} onChange={(yMm) => update({ yMm })} />
        <IconButton icon={<PaperProfileIcon name="align-horizontal" />} label={t('page.paperProfiles.centerHorizontally')}
          onClick={() => editor.centerField(field.id, 'horizontal')} />
        <IconButton icon={<PaperProfileIcon name="align-vertical" />} label={t('page.paperProfiles.centerVertically')}
          onClick={() => editor.centerField(field.id, 'vertical')} />
      </PropRow>
      {field.type === 'barcode' && (
        <PropRow>
          <Num prefix="W" label={t('page.paperProfiles.barcodeWidthMm')} value={field.barcodeWidthMm ?? DEFAULT_BARCODE_WIDTH_MM}
            normalize={(v) => Math.max(4, Math.min(100, v))} onChange={(barcodeWidthMm) => update({ barcodeWidthMm })} />
          <Num prefix="H" label={t('page.paperProfiles.barcodeHeightMm')} value={field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM}
            normalize={(v) => Math.max(4, Math.min(60, v))} onChange={(barcodeHeightMm) => update({ barcodeHeightMm })} />
        </PropRow>
      )}
      {field.type === 'qrcode' && (
        <PropRow>
          <Num prefix="↔" label={t('page.paperProfiles.qrSizeMm')} value={field.qrSizeMm ?? DEFAULT_QR_SIZE_MM}
            normalize={(v) => Math.max(4, Math.min(100, v))} onChange={(qrSizeMm) => update({ qrSizeMm })} />
        </PropRow>
      )}
      {isText && (
        <PropRow>
          <Num prefix="pt" label={t('page.paperProfiles.fieldFontSizePt')} value={field.fontSize}
            normalize={clampFontSize} onChange={(fontSize) => update({ fontSize })} />
          <div className="pp-props__segmented" role="group" aria-label={t('page.paperProfiles.align')}>
            {(['left', 'center', 'right'] as const).map((align) => (
              <button key={align} type="button" aria-pressed={field.align === align}
                aria-label={t(`page.paperProfiles.align${align[0].toUpperCase()}${align.slice(1)}`)}
                title={t(`page.paperProfiles.align${align[0].toUpperCase()}${align.slice(1)}`)}
                onClick={() => update({ align })}>
                <AlignGlyph align={align} />
              </button>
            ))}
          </div>
          <button type="button" className="pp-props__toggle" aria-pressed={field.bold}
            aria-label={t('page.paperProfiles.bold')} title={t('page.paperProfiles.bold')}
            onClick={() => update({ bold: !field.bold })}><strong>B</strong></button>
          <input type="color" className="ui-color-field__swatch" value={field.color}
            aria-label={t('page.paperProfiles.fieldColor')} title={t('page.paperProfiles.fieldColor')}
            onChange={(event) => update({ color: event.target.value })} />
        </PropRow>
      )}
    </>
  );
}

function PaperProperties({ editor, t }: { editor: PaperProfileEditor; t: Translate }) {
  const { form, ux } = editor;
  const unit = ux.displayUnit;
  const dim = (key: keyof Pick<PaperForm, 'widthMm' | 'heightMm' | 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm'>, prefix: string, label: string) => (
    <Num prefix={prefix} label={`${t(label)} (${unit})`}
      value={Number(displayValue(form[key], unit, form.dpi))}
      onChange={(value) => editor.patchForm(key, toMillimeters(value, unit, form.dpi))} />
  );
  return (
    <>
      <header className="pp-props__header">
        <PaperProfileIcon name="profile" />
        <strong>{t('page.paperProfiles.paperProperties')}</strong>
        <span className="pp-props__unit">{unit}</span>
      </header>
      <PropRow>
        {dim('widthMm', 'W', 'page.paperProfiles.width')}
        {dim('heightMm', 'H', 'page.paperProfiles.height')}
      </PropRow>
      <div className="pp-props__label">{t('page.paperProfiles.margins')}</div>
      <PropRow>
        {dim('marginTopMm', '↑', 'page.paperProfiles.top')}
        {dim('marginRightMm', '→', 'page.paperProfiles.right')}
        {dim('marginBottomMm', '↓', 'page.paperProfiles.bottom')}
        {dim('marginLeftMm', '←', 'page.paperProfiles.left')}
      </PropRow>
    </>
  );
}

function PropRow({ children }: { children: ReactNode }) {
  return <div className="pp-props__row">{children}</div>;
}

/** Compact number box with a short prefix, like Figma's "X 12". */
function Num({ prefix, label, value, normalize, onChange }: {
  prefix: string;
  label: string;
  value: number;
  normalize?: (value: number) => number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="pp-props__num" title={label}>
      <span aria-hidden="true">{prefix}</span>
      <DraftNumberInput controlSize="sm" step="0.1" aria-label={label} value={value} normalize={normalize} onValueChange={onChange} />
    </label>
  );
}

const ALIGN_GLYPH = {
  left: 'M2 4h12M2 8h8M2 12h10',
  center: 'M2 4h12M4 8h8M3 12h10',
  right: 'M2 4h12M6 8h8M4 12h10',
} as const;

function AlignGlyph({ align }: { align: keyof typeof ALIGN_GLYPH }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d={ALIGN_GLYPH[align]} />
    </svg>
  );
}
