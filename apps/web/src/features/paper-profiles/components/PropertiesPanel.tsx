import type { ReactNode } from 'react';
import { DEFAULT_STATIC_BOX_MM } from '@printerops/shared';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_BARCODE_WIDTH_MM, DEFAULT_QR_SIZE_MM } from '../model/defaults.js';
import { alignBoxes, distributeBoxes, type AlignMode, type DistributeAxis, type FieldBox, type FieldMove } from '../model/align.js';
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
export function PropertiesPanel({ editor, t, measureSelection }: {
  editor: PaperProfileEditor;
  t: Translate;
  /** Rendered boxes of the selected fields; align/distribute need it. */
  measureSelection?: () => FieldBox[];
}) {
  const field = editor.selectedField;
  const multi = editor.selectedFieldIds.length > 1;
  return (
    <section className="pp-props" aria-label={t('page.paperProfiles.propertiesTitle')} aria-live="polite">
      {multi ? <SelectionProperties editor={editor} t={t} measureSelection={measureSelection} />
        : field ? <FieldProperties field={field} editor={editor} t={t} /> : <PaperProperties editor={editor} t={t} />}
      <p className="pp-props__hint">{t('page.paperProfiles.canvasShortcutsHint')}</p>
    </section>
  );
}

const ALIGN_ACTIONS: { mode: AlignMode; label: string; path: string }[] = [
  { mode: 'left', label: 'page.paperProfiles.alignSelectionLeft', path: 'M3 2v12M6 5h8M6 11h5' },
  { mode: 'hcenter', label: 'page.paperProfiles.alignSelectionHCenter', path: 'M8 2v12M3 5h10M5 11h6' },
  { mode: 'right', label: 'page.paperProfiles.alignSelectionRight', path: 'M13 2v12M2 5h8M5 11h5' },
  { mode: 'top', label: 'page.paperProfiles.alignSelectionTop', path: 'M2 3h12M5 6v8M11 6v5' },
  { mode: 'vmiddle', label: 'page.paperProfiles.alignSelectionVMiddle', path: 'M2 8h12M5 3v10M11 5v6' },
  { mode: 'bottom', label: 'page.paperProfiles.alignSelectionBottom', path: 'M2 13h12M5 2v8M11 5v5' },
];

const DISTRIBUTE_ACTIONS: { axis: DistributeAxis; label: string; path: string }[] = [
  { axis: 'horizontal', label: 'page.paperProfiles.distributeHorizontal', path: 'M2 2v12M14 2v12M6 5h4v6H6z' },
  { axis: 'vertical', label: 'page.paperProfiles.distributeVertical', path: 'M2 2h12M2 14h12M5 6h6v4H5z' },
];

/** Figma-style inspector for a multi-selection: align, distribute, delete. */
function SelectionProperties({ editor, t, measureSelection }: {
  editor: PaperProfileEditor;
  t: Translate;
  measureSelection?: () => FieldBox[];
}) {
  const count = editor.selectedFieldIds.length;
  const apply = (plan: (boxes: FieldBox[]) => FieldMove[]) => {
    const boxes = measureSelection?.() ?? [];
    editor.moveFields(plan(boxes));
  };
  return (
    <>
      <header className="pp-props__header">
        <strong>{t('page.paperProfiles.selectedCount').replace('{n}', String(count))}</strong>
        <IconButton icon={<PaperProfileIcon name="copy" />} label={t('page.paperProfiles.duplicateField')}
          onClick={() => editor.state.selectedFieldId && editor.duplicateField(editor.state.selectedFieldId)} />
        <IconButton icon={<PaperProfileIcon name="trash" />} label={t('page.paperProfiles.remove')}
          onClick={() => editor.deleteFields(editor.selectedFieldIds)} />
      </header>
      <PropRow>
        <div className="pp-props__segmented" role="group" aria-label={t('page.paperProfiles.alignSelection')}>
          {ALIGN_ACTIONS.map((action) => (
            <button key={action.mode} type="button" aria-label={t(action.label)} title={t(action.label)}
              disabled={!measureSelection} onClick={() => apply((boxes) => alignBoxes(boxes, action.mode))}>
              <Glyph path={action.path} />
            </button>
          ))}
        </div>
        <div className="pp-props__segmented" role="group" aria-label={t('page.paperProfiles.distributeSelection')}>
          {DISTRIBUTE_ACTIONS.map((action) => (
            <button key={action.axis} type="button" aria-label={t(action.label)} title={t(action.label)}
              disabled={!measureSelection || count < 3} onClick={() => apply((boxes) => distributeBoxes(boxes, action.axis))}>
              <Glyph path={action.path} />
            </button>
          ))}
        </div>
      </PropRow>
    </>
  );
}

function Glyph({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d={path} />
    </svg>
  );
}

function FieldProperties({ field, editor, t }: { field: DynamicField; editor: PaperProfileEditor; t: Translate }) {
  const update = (patch: Partial<DynamicField>) => editor.updateField(field.id, patch);
  const isStatic = field.type === 'shape' || field.type === 'image';
  const isText = field.type !== 'barcode' && field.type !== 'qrcode' && !isStatic;
  return (
    <>
      <header className="pp-props__header">
        <span className="pp-field-type-badge">{field.type === 'qrcode' ? 'QR' : field.type}</span>
        <strong>{field.label || field.key || t('page.paperProfiles.untitledField')}</strong>
        <IconButton icon={<span aria-hidden="true">{field.locked ? '🔒' : '🔓'}</span>}
          label={t(field.locked ? 'page.paperProfiles.unlockField' : 'page.paperProfiles.lockField')}
          active={Boolean(field.locked)} onClick={() => editor.toggleLock(field.id)} />
        <IconButton icon={<span aria-hidden="true">⤒</span>} label={t('page.paperProfiles.bringToFront')}
          onClick={() => editor.reorderFields(field.id, 'front')} />
        <IconButton icon={<span aria-hidden="true">⤓</span>} label={t('page.paperProfiles.sendToBack')}
          onClick={() => editor.reorderFields(field.id, 'back')} />
        <IconButton icon={<PaperProfileIcon name="copy" />} label={t('page.paperProfiles.duplicateField')}
          onClick={() => editor.duplicateField(field.id)} />
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
      {isStatic && (
        <PropRow>
          <Num prefix="W" label={t('page.paperProfiles.boxWidthMm')} value={field.boxWidthMm ?? DEFAULT_STATIC_BOX_MM.widthMm}
            normalize={(v) => Math.max(0.2, Math.min(500, v))} onChange={(boxWidthMm) => update({ boxWidthMm })} />
          <Num prefix="H" label={t('page.paperProfiles.boxHeightMm')} value={field.boxHeightMm ?? DEFAULT_STATIC_BOX_MM.heightMm}
            normalize={(v) => Math.max(0.2, Math.min(500, v))} onChange={(boxHeightMm) => update({ boxHeightMm })} />
          {field.type === 'shape' && (
            <>
              <Num prefix="▢" label={t('page.paperProfiles.borderMm')} value={field.borderMm ?? DEFAULT_STATIC_BOX_MM.borderMm}
                normalize={(v) => Math.max(0, Math.min(10, v))} onChange={(borderMm) => update({ borderMm })} />
              <input type="color" className="ui-color-field__swatch" value={field.color}
                aria-label={t('page.paperProfiles.fieldColor')} title={t('page.paperProfiles.fieldColor')}
                onChange={(event) => update({ color: event.target.value })} />
              <input type="color" className="ui-color-field__swatch" value={field.bgColor ?? '#ffffff'}
                aria-label={t('page.paperProfiles.fieldBgColor')} title={t('page.paperProfiles.fieldBgColor')}
                onChange={(event) => update({ bgColor: event.target.value })} />
              {field.bgColor && (
                <IconButton icon={<span aria-hidden="true">×</span>} label={t('page.paperProfiles.clearBgColor')}
                  onClick={() => update({ bgColor: undefined })} />
              )}
            </>
          )}
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
          {/* 0 clears the fixed width back to the text's natural width. */}
          <Num prefix="W" label={t('page.paperProfiles.fieldDisplayWidthMm')} value={field.displayWidthMm ?? 0}
            normalize={(v) => Math.max(0, Math.min(500, v))}
            onChange={(v) => update({ displayWidthMm: v > 0 ? v : undefined })} />
          <Num prefix="≡" label={t('page.paperProfiles.fieldMaxLines')} value={field.maxLines ?? 1}
            normalize={(v) => Math.max(1, Math.min(20, Math.round(v)))}
            onChange={(v) => update({ maxLines: v > 1 ? v : undefined })} />
          {/* Shrink-to-fit needs a box to fit into; without W the text keeps its size. */}
          <button type="button" className="pp-props__toggle" aria-pressed={Boolean(field.shrinkToFit)}
            disabled={!field.displayWidthMm || (field.maxLines ?? 1) > 1}
            aria-label={t('page.paperProfiles.shrinkToFit')} title={t('page.paperProfiles.shrinkToFit')}
            onClick={() => update({ shrinkToFit: !field.shrinkToFit })}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 8h4M10 8h4M4 6l2 2-2 2M12 6l-2 2 2 2" />
            </svg>
          </button>
          <input type="color" className="ui-color-field__swatch" value={field.bgColor ?? '#ffffff'}
            aria-label={t('page.paperProfiles.fieldBgColor')} title={t('page.paperProfiles.fieldBgColor')}
            onChange={(event) => update({ bgColor: event.target.value })} />
          {field.bgColor && (
            <IconButton icon={<span aria-hidden="true">×</span>} label={t('page.paperProfiles.clearBgColor')}
              onClick={() => update({ bgColor: undefined })} />
          )}
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
