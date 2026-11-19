/**
 * The job-list column picker.
 *
 * Split out of `WebControlJobs.tsx` because it is pure presentation: it holds no
 * state, only renders the current selection and reports toggles upward. The page
 * keeps ownership of the selection (and of the localStorage write) so the table
 * and the dialog can never disagree about which columns exist.
 *
 * The two groups are deliberately separate. Built-in fields are a fixed list;
 * incoming values come from whatever the current scope's jobs actually carry, so
 * a key that vanished with a station change still appears (at count 0) while it
 * is selected, and can always be removed again.
 */

import { Button, Checkbox, Dialog, Mono, Stack, Text } from '../../components/ui/index.js';
import { useLocale } from '../../i18n/index.js';
import {
  MAX_PAYLOAD_COLUMNS,
  OPTIONAL_JOB_COLUMNS,
  isPayloadColumnId,
  payloadColumnId,
  type JobColumnOption,
} from '../../lib/jobColumns.js';
import { formatMessage } from '../../lib/formatMessage.js';
import type { CinemaFieldOption } from '../cinema/cinemaModel.js';

export interface JobColumnsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Selected column ids, payload columns included (`payload:<key>`). */
  columns: readonly string[];
  /** Incoming keys the current scope carries, selected ones first. */
  incomingChoices: readonly CinemaFieldOption[];
  /** Toggle one column id on or off. */
  onToggle: (id: string) => void;
  /** Restore the default column set. */
  onReset: () => void;
  /**
   * Built-in fields offered as choices. Defaults to every optional column.
   * A single-station queue passes the same list without `station`: every row is
   * that station, so the column would repeat one value for the whole table.
   */
  options?: readonly JobColumnOption[];
}

export function JobColumnsDialog({
  open,
  onClose,
  columns,
  incomingChoices,
  onToggle,
  onReset,
  options = OPTIONAL_JOB_COLUMNS,
}: JobColumnsDialogProps) {
  const { t } = useLocale();
  const payloadSelected = columns.filter((entry) => isPayloadColumnId(entry)).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('control.jobs.columnsTitle')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onReset}>
            {t('control.jobs.columnsReset')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <Stack gap="md">
        <Text size="body" tone="muted">
          {t('control.jobs.columnsHint')}
        </Text>
        <Stack gap="xs">
          {options.map((option) => (
            <Checkbox
              key={option.id}
              checked={columns.includes(option.id)}
              onChange={() => onToggle(option.id)}
              label={t(option.labelKey)}
            />
          ))}
        </Stack>
        <Stack gap="xs">
          <Text size="label" weight="semibold" tone="muted">
            {t('control.jobs.columnsIncoming')}
          </Text>
          {incomingChoices.length === 0 ? (
            <Text size="label" tone="muted">
              {t('control.jobs.columnsNoIncoming')}
            </Text>
          ) : (
            incomingChoices.map((option) => {
              const id = payloadColumnId(option.key);
              const checked = columns.includes(id);
              return (
                <Checkbox
                  key={option.key}
                  checked={checked}
                  disabled={!checked && payloadSelected >= MAX_PAYLOAD_COLUMNS}
                  onChange={() => onToggle(id)}
                  label={<Mono size="label">{option.key}</Mono>}
                  description={
                    option.count === 0
                      ? t('control.jobs.columnsNoValue')
                      : `${option.sample} · ${formatMessage(t('control.jobs.columnsValueCount'), {
                          count: option.count,
                        })}`
                  }
                />
              );
            })
          )}
        </Stack>
      </Stack>
    </Dialog>
  );
}
