import { clampFontSize } from '../model/geometry.js';
import type { DynamicField } from '../model/types.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { FieldBarcodePreview, FieldTypeControls } from './PaperCanvas.js';
import type { Translate } from './types.js';

export function FieldCard({ field, editor, t }: {
  field: DynamicField;
  editor: PaperProfileEditor;
  t: Translate;
}) {
  const update = (patch: Partial<DynamicField>) => editor.updateField(field.id, patch);
  return (
    <div id={`paper-field-${field.id}`}
      className={`pp-field-row${editor.state.selectedFieldId === field.id ? ' is-selected' : ''}`}
      onClick={() => editor.selectField(field.id)}>
      <div className="pp-field-row__header">
        <span className="pp-field-type-badge">{field.type === 'qrcode' ? 'QR' : field.type}</span>
        <input className="pp-input pp-input--sm pp-input--mono pp-field-row__key"
          aria-label={t('page.paperProfiles.fieldKey')} placeholder={t('page.paperProfiles.fieldKey')}
          value={field.key} onChange={(event) => update({ key: event.target.value })} />
        <input className="pp-input pp-input--sm pp-field-row__label-input"
          aria-label={t('page.paperProfiles.fieldLabel')} placeholder={t('page.paperProfiles.fieldLabel')}
          value={field.label} onChange={(event) => update({ label: event.target.value })} />
        <button type="button" className="pp-field-delete"
          onClick={(event) => { event.stopPropagation(); editor.deleteField(field.id); }}
          title={t('page.paperProfiles.remove')} aria-label={t('page.paperProfiles.remove')}>✕</button>
      </div>
      <div className="pp-field-row__group-label">{t('page.paperProfiles.groupContentOutput')}</div>
      <div className="pp-field-row__content">
        <input className="pp-input pp-input--sm" aria-label={t('page.paperProfiles.fieldDefault')}
          placeholder={t('page.paperProfiles.fieldDefault')} value={field.defaultValue}
          onChange={(event) => update({ defaultValue: event.target.value })} />
        <div className="pp-field-row__type-controls">
          <FieldTypeControls field={field} onUpdate={update}
            selectClassName="pp-select pp-select--sm" numberClassName="pp-number pp-input--sm" />
        </div>
      </div>
      <div className="pp-field-row__group-label">{t('page.paperProfiles.groupPositionStyle')}</div>
      <div className="pp-field-row__position">
        <FieldNumber id={`pp-x-${field.id}`} label={t('page.paperProfiles.fieldXmm')} value={field.xMm}
          onChange={(xMm) => update({ xMm })} />
        <FieldNumber id={`pp-y-${field.id}`} label={t('page.paperProfiles.fieldYmm')} value={field.yMm}
          onChange={(yMm) => update({ yMm })} />
        <FieldNumber id={`pp-size-${field.id}`} label={t('page.paperProfiles.fieldFontSizePt')} value={field.fontSize}
          onChange={(fontSize) => update({ fontSize: clampFontSize(fontSize) })} />
        <div className="pp-field-row__cell">
          <label htmlFor={`pp-align-${field.id}`}>{t('page.paperProfiles.align')}</label>
          <select id={`pp-align-${field.id}`} className="pp-select pp-select--sm" value={field.align}
            aria-label={t('page.paperProfiles.align')}
            onChange={(event) => update({ align: event.target.value as DynamicField['align'] })}>
            <option value="left">{t('page.paperProfiles.alignLeft')}</option>
            <option value="center">{t('page.paperProfiles.alignCenter')}</option>
            <option value="right">{t('page.paperProfiles.alignRight')}</option>
          </select>
        </div>
        <div className="pp-field-row__cell">
          <label htmlFor={`pp-color-${field.id}`}>{t('page.paperProfiles.fieldColor')}</label>
          <input id={`pp-color-${field.id}`} className="pp-color" type="color" value={field.color}
            aria-label={t('page.paperProfiles.fieldColor')} onChange={(event) => update({ color: event.target.value })} />
        </div>
        <div className="pp-field-row__cell pp-field-row__cell--tight">
          <label className="pp-checkbox-label">
            <input aria-label={t('page.paperProfiles.bold')} type="checkbox" checked={field.bold}
              onChange={(event) => update({ bold: event.target.checked })} /> {t('page.paperProfiles.fieldBoldLabel')}
          </label>
        </div>
      </div>
      <FieldBarcodePreview field={field} />
    </div>
  );
}

function FieldNumber({ id, label, value, onChange }: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="pp-field-row__cell">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="pp-number pp-input--sm" aria-label={label} type="number" step="0.1"
        value={value} onChange={(event) => {
          const next = Number.parseFloat(event.target.value);
          if (!Number.isNaN(next)) onChange(next);
        }} />
    </div>
  );
}
