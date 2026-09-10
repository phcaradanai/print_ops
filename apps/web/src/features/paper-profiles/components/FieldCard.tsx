import { clampFontSize } from '../model/geometry.js';
import type { DynamicField } from '../model/types.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { Checkbox, IconButton, Input, Select } from '../../../components/ui/index.js';
import { FieldBarcodePreview, FieldTypeControls } from './PaperCanvas.js';
import { DraftNumberInput } from './DraftNumberInput.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function FieldCard({ field, editor, t }: {
  field: DynamicField;
  editor: PaperProfileEditor;
  t: Translate;
}) {
  const update = (patch: Partial<DynamicField>) => editor.updateField(field.id, patch);
  const isMachineReadable = field.type === 'barcode' || field.type === 'qrcode';
  const isSelected = editor.state.selectedFieldId === field.id;
  const selectFieldFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    editor.selectField(field.id);
  };
  return (
    <div id={`paper-field-${field.id}`}
      className={`pp-field-row${isSelected ? ' is-selected' : ''}`}
      role="group"
      tabIndex={0}
      aria-label={`${field.label || field.key || t('page.paperProfiles.untitledField')}. ${t('page.paperProfiles.selectFieldHint')}`}
      aria-current={isSelected ? 'true' : undefined}
      onClick={() => editor.selectField(field.id)}
      onFocusCapture={() => editor.selectField(field.id)}
      onKeyDown={selectFieldFromKeyboard}>
      <div className="pp-field-row__header">
        <span className="pp-field-type-badge">{field.type === 'qrcode' ? 'QR' : field.type}</span>
        <Input
          controlSize="sm"
          mono
          className="pp-field-row__key"
          aria-label={t('page.paperProfiles.fieldKey')}
          placeholder={t('page.paperProfiles.fieldKey')}
          value={field.key}
          onChange={(event) => update({ key: event.target.value })}
        />
        <Input
          controlSize="sm"
          className="pp-field-row__label-input"
          aria-label={t('page.paperProfiles.fieldLabel')}
          placeholder={t('page.paperProfiles.fieldLabel')}
          value={field.label}
          onChange={(event) => update({ label: event.target.value })}
        />
        <IconButton
          variant="ghost"
          size="sm"
          className="pp-field-delete"
          label={t('page.paperProfiles.remove')}
          onClick={(event) => { event.stopPropagation(); editor.deleteField(field.id); }}
        >
          <PaperProfileIcon name="close" />
        </IconButton>
      </div>
      <div className="pp-field-row__group-label">{t('page.paperProfiles.groupContentOutput')}</div>
      <div className="pp-field-row__content">
        <Input
          controlSize="sm"
          aria-label={t('page.paperProfiles.fieldDefault')}
          placeholder={t('page.paperProfiles.fieldDefault')}
          value={field.defaultValue}
          onChange={(event) => update({ defaultValue: event.target.value })}
        />
        <div className="pp-field-row__type-controls">
          <FieldTypeControls field={field} onUpdate={update}
            selectClassName="ui-select ui-select--sm" numberClassName="ui-input ui-input--sm" />
        </div>
      </div>
      <div className="pp-field-row__group-label">{t('page.paperProfiles.groupPositionStyle')}</div>
      <div className="pp-field-row__position">
        <FieldNumber id={`pp-x-${field.id}`} label={t('page.paperProfiles.fieldXmm')} value={field.xMm}
          onChange={(xMm) => update({ xMm })} />
        <FieldNumber id={`pp-y-${field.id}`} label={t('page.paperProfiles.fieldYmm')} value={field.yMm}
          onChange={(yMm) => update({ yMm })} />
        <FieldNumber id={`pp-size-${field.id}`} label={t('page.paperProfiles.fieldFontSizePt')} value={field.fontSize}
           disabled={isMachineReadable}
           normalize={clampFontSize}
           onChange={(fontSize) => update({ fontSize })} />
        <div className="pp-field-row__cell">
          <label htmlFor={`pp-align-${field.id}`}>{t('page.paperProfiles.align')}</label>
          <Select
            id={`pp-align-${field.id}`}
            controlSize="sm"
            value={field.align}
            aria-label={t('page.paperProfiles.align')}
            onChange={(event) => update({ align: event.target.value as DynamicField['align'] })}
          >
            <option value="left">{t('page.paperProfiles.alignLeft')}</option>
            <option value="center">{t('page.paperProfiles.alignCenter')}</option>
            <option value="right">{t('page.paperProfiles.alignRight')}</option>
          </Select>
        </div>
        <div className="pp-field-row__cell">
          <label htmlFor={`pp-color-${field.id}`}>{t('page.paperProfiles.fieldColor')}</label>
          <input id={`pp-color-${field.id}`} className="ui-color-field__swatch" type="color" value={field.color}
            disabled={isMachineReadable} aria-label={t('page.paperProfiles.fieldColor')}
            onChange={(event) => update({ color: event.target.value })} />
        </div>
        <div className="pp-field-row__cell pp-field-row__cell--tight">
          <Checkbox
            label={t('page.paperProfiles.fieldBoldLabel')}
            aria-label={t('page.paperProfiles.bold')}
            checked={field.bold}
            disabled={isMachineReadable}
            onChange={(event) => update({ bold: event.target.checked })}
          />
        </div>
      </div>
      <FieldBarcodePreview field={field} />
    </div>
  );
}

function FieldNumber({ id, label, value, disabled, normalize, onChange }: {
  id: string;
  label: string;
  value: number;
  disabled?: boolean;
  normalize?: (value: number) => number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="pp-field-row__cell">
      <label htmlFor={id}>{label}</label>
      <DraftNumberInput
        id={id}
        controlSize="sm"
        aria-label={label}
        step="0.1"
        disabled={disabled}
        value={value}
        normalize={normalize}
        onValueChange={onChange}
      />
    </div>
  );
}
