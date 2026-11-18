/**
 * The cinema display settings: which incoming values label a row, whether the
 * job reference follows them, how wide that label sits, and which optional
 * panels the board carries.
 *
 * Pure presentation, like the column picker: the page owns the URL state, this
 * component only renders it and reports intent. The feed is never offered as a
 * choice - a board without the job list is not a cinema board.
 */

import { Button, Checkbox, Dialog, FormField, Mono, Select, Stack, Text } from '../../components/ui/index.js';
import { useLocale } from '../../i18n/index.js';
import { formatMessage } from '../../lib/formatMessage.js';
import {
  CINEMA_MAX_FIELDS,
  CINEMA_PANELS,
  type CinemaFieldOption,
  type CinemaPanel,
} from './cinemaModel.js';

export type CinemaLabelWidth = 'narrow' | 'balanced' | 'wide';

export interface CinemaDisplayDialogProps {
  open: boolean;
  onClose: () => void;
  /** Selected payload keys, in row order. */
  fields: readonly string[];
  /** Keys the current scope carries, selected ones first. */
  fieldChoices: readonly CinemaFieldOption[];
  showReference: boolean;
  onShowReferenceChange: (next: boolean) => void;
  labelWidth: CinemaLabelWidth;
  onLabelWidthChange: (next: CinemaLabelWidth) => void;
  /** Optional panels currently switched on. */
  panels: readonly CinemaPanel[];
  onToggleField: (key: string) => void;
  onClearFields: () => void;
  onTogglePanel: (panel: CinemaPanel) => void;
  maxFields?: number;
}

export function CinemaDisplayDialog({
  open,
  onClose,
  fields,
  fieldChoices,
  showReference,
  onShowReferenceChange,
  labelWidth,
  onLabelWidthChange,
  panels,
  onToggleField,
  onClearFields,
  onTogglePanel,
  maxFields = CINEMA_MAX_FIELDS,
}: CinemaDisplayDialogProps) {
  const { t } = useLocale();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('control.cinema.fieldsTitle')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClearFields} disabled={fields.length === 0}>
            {t('control.cinema.fieldsClear')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <Stack gap="md">
        <Text size="body" tone="muted">
          {formatMessage(t('control.cinema.fieldsHint'), { max: maxFields })}
        </Text>
        <Text size="label" weight="semibold" tone="muted">
          {formatMessage(t('control.cinema.fieldsLimit'), {
            count: fields.length,
            max: maxFields,
          })}
        </Text>
        {fieldChoices.length === 0 ? (
          <Text tone="muted">{t('control.cinema.fieldsEmpty')}</Text>
        ) : (
          <Stack gap="xs">
            {fieldChoices.map((option) => {
              const checked = fields.includes(option.key);
              return (
                <Checkbox
                  key={option.key}
                  checked={checked}
                  disabled={!checked && fields.length >= maxFields}
                  onChange={() => onToggleField(option.key)}
                  label={<Mono size="label">{option.key}</Mono>}
                  description={
                    option.count === 0
                      ? t('control.cinema.fieldsMissing')
                      : `${option.sample} · ${formatMessage(t('control.cinema.fieldsCount'), {
                          count: option.count,
                        })}`
                  }
                />
              );
            })}
          </Stack>
        )}
        {/* Independent of the value list: a site can hide references even when it
            shows no incoming values at all, and one that shows values can still
            keep the reference if support needs to find the job. */}
        <Checkbox
          label={t('control.cinema.showReference')}
          description={t('control.cinema.showReferenceHint')}
          checked={showReference}
          onChange={(event) => onShowReferenceChange(event.target.checked)}
        />
        <FormField label={t('control.cinema.labelWidth')}>
          {(control) => (
            <Select
              {...control}
              value={labelWidth}
              onChange={(event) => onLabelWidthChange(event.target.value as CinemaLabelWidth)}
            >
              <option value="narrow">{t('control.cinema.widthNarrow')}</option>
              <option value="balanced">{t('control.cinema.widthBalanced')}</option>
              <option value="wide">{t('control.cinema.widthWide')}</option>
            </Select>
          )}
        </FormField>
        <Stack gap="xs">
          <Text size="label" weight="semibold" tone="muted">
            {t('control.cinema.panelsTitle')}
          </Text>
          <Text size="label" tone="muted">
            {t('control.cinema.panelsHint')}
          </Text>
          {CINEMA_PANELS.map((panel) => {
            const checked = panels.includes(panel);
            return (
              <Checkbox
                key={panel}
                checked={checked}
                disabled={checked && panels.length === 1}
                onChange={() => onTogglePanel(panel)}
                label={t(`control.cinema.panel.${panel}`)}
              />
            );
          })}
        </Stack>
      </Stack>
    </Dialog>
  );
}
