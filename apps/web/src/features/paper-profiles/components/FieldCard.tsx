import { useRef } from 'react';
import { clampFontSize } from '../model/geometry.js';
import type { DynamicField, PaperForm } from '../model/types.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { Alert, Checkbox, IconButton, Input, Select } from '../../../components/ui/index.js';
import { FieldBarcodePreview, FieldTypeControls } from './PaperCanvas.js';
import { DraftNumberInput } from './DraftNumberInput.js';
import type { Translate } from './types.js';
import { formatMessage, formatValidationIssue, getDynamicFieldLimits, validateDynamicFieldDiagnostics } from '../model/validation.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function FieldCard({ field, editor, t }: {
  field: DynamicField;
  editor: PaperProfileEditor;
  t: Translate;
}) {
  const update = (patch: Partial<DynamicField>) => editor.updateField(field.id, patch);
  const modifierPressRef = useRef(false);
  // Fixed-size boxes: no font, no text format. A shape still uses `color` for its outline.
  const isMachineReadable = field.type === 'barcode' || field.type === 'qrcode' || field.type === 'shape' || field.type === 'image';
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
      onClick={(event) => {
        // Shift/Cmd/Ctrl-click builds a selection here too, like on the canvas.
        if (event.shiftKey || event.metaKey || event.ctrlKey) editor.toggleFieldSelection(field.id);
        else editor.selectField(field.id);
      }}
      // Focus lands before click: a modifier press must not collapse the selection first.
      onPointerDownCapture={(event) => { modifierPressRef.current = event.shiftKey || event.metaKey || event.ctrlKey; }}
      onFocusCapture={() => { if (!modifierPressRef.current && !editor.state.selectedFieldIds.includes(field.id)) editor.selectField(field.id); }}
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
      {!isMachineReadable && (
        <>
          <div className="pp-field-row__group-label">{t('page.paperProfiles.groupFormat')}</div>
          {/* One per row: text boxes need room to be readable. */}
          <div className="pp-field-row__content">
            <FieldText id={`pp-prefix-${field.id}`} label={t('page.paperProfiles.fieldPrefix')} value={field.prefix}
              onChange={(prefix) => update({ prefix })} />
            <FieldText id={`pp-suffix-${field.id}`} label={t('page.paperProfiles.fieldSuffix')} value={field.suffix}
              onChange={(suffix) => update({ suffix })} />
            {field.type === 'date' && (
              <FieldText id={`pp-datefmt-${field.id}`} label={t('page.paperProfiles.fieldDateFormat')} value={field.dateFormat}
                placeholder="DD/MM/BBBB" onChange={(dateFormat) => update({ dateFormat })} />
            )}
            {field.type === 'number' && (
              <>
                <FieldNumber id={`pp-decimals-${field.id}`} label={t('page.paperProfiles.fieldDecimals')} value={field.decimals ?? 0}
                  normalize={(v) => Math.max(0, Math.min(6, Math.round(v)))}
                  onChange={(decimals) => update({ decimals })} />
                <div className="pp-field-row__cell pp-field-row__cell--tight">
                  <Checkbox label={t('page.paperProfiles.fieldThousands')} checked={Boolean(field.thousands)}
                    onChange={(event) => update({ thousands: event.target.checked || undefined })} />
                </div>
              </>
            )}
          </div>
        </>
      )}
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
            disabled={isMachineReadable && field.type !== 'shape'} aria-label={t('page.paperProfiles.fieldColor')}
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
      <FieldLimits form={editor.form} field={field} t={t} />
      <FieldBarcodePreview field={field} />
    </div>
  );
}

function FieldText({ id, label, value, placeholder, onChange }: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder?: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="pp-field-row__cell">
      <label htmlFor={id}>{label}</label>
      {/* Empty clears the setting so it isn't stored. */}
      <Input id={id} controlSize="sm" maxLength={40} aria-label={label} value={value ?? ''} placeholder={placeholder}
        onChange={(event) => onChange(event.target.value || undefined)} />
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

/**
 * How much this field still prints at its position, rotation and font size —
 * the character budget operators ask for — plus the warning when the configured
 * content is already longer than that.
 */
function FieldLimits({ form, field, t }: {
  form: PaperForm;
  field: DynamicField;
  t: Translate;
}) {
  const limits = getDynamicFieldLimits(form, field);
  if (!limits || !limits.anchorInsidePaper) return null;
  const warning = validateDynamicFieldDiagnostics(form, [field]).warnings[0];
  return (
    <>
      <p className="pp-field-row__limits">
        {limits.maxChars === null
          ? formatMessage(t('page.paperProfiles.fieldLimitBox'), {
            maxWidthMm: limits.maxWidthMm,
            maxHeightMm: limits.maxHeightMm,
          })
          : formatMessage(t('page.paperProfiles.fieldLimitText'), {
            maxChars: limits.maxChars,
            charWidthMm: Number((limits.charWidthMm ?? 0).toFixed(2)),
            fontSize: field.fontSize,
          })}
      </p>
      {warning && (
        <div className="pp-field-row__warning"><Alert tone="warning">{formatValidationIssue(t, warning)}</Alert></div>
      )}
    </>
  );
}
