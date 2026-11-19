/**
 * The job summary drawer for Incoming Jobs.
 *
 * Short answer first, evidence behind two collapsed sections: an operator opening a
 * row wants to know what happened and what to do next, not to read a payload dump.
 * Everything here derives from the job it is given, so the component owns its own
 * copy-to-clipboard state and cannot drift from the row that opened it.
 *
 * The footer is the action surface: acknowledge (or take it back), reprint when the
 * verdict allows it, close.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  CardDetail,
  CardDetailItem,
  CodeBlock,
  CollapsibleSection,
  Drawer,
  Inline,
  Mono,
  Stack,
  StatusBadge,
  Text,
} from '../../components/ui/index.js';
import { useLocale } from '../../i18n/index.js';
import { copyTextToClipboard } from '../../lib/clipboard.js';
import { formatCreatedAt } from '../../lib/formatCreatedAt.js';
import { formatMessage } from '../../lib/formatMessage.js';
import { extractJobPayload } from '../../lib/jobPayload.js';
import { jobNeedsAttention } from '../../lib/jobQueueView.js';
import './jobDetailDrawer.css';
import {
  REPORTED_COMPLETE_COPY,
  getJobVerdict,
  offersReprint,
  reprintButtonVariant,
  verdictDetailKey,
  verdictHeadlineKey,
} from '../../lib/jobVerdict.js';

/** The subset of a job the drawer reads. */
export interface DrawerJob {
  id: string;
  requestId?: string;
  /**
   * The station that mirrored the job. Absent on a station's own queue, where
   * every row belongs to this installation by definition.
   */
  deviceId?: string;
  status: string;
  copies: number;
  createdAt: string;
  printerId: string;
  printerCode?: string;
  templateCode?: string;
  resolvedTemplateCode?: string;
  paperProfileId?: string;
  sourceSystem?: string;
  runnerId?: string;
  errorCode?: string;
  errorMessage?: string;
  completedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewedOutcome?: 'PRINTED' | 'NOT_PRINTED';
  payload?: Record<string, unknown>;
  payloadSnapshot?: string;
}

/**
 * The job type is a type parameter so a caller can keep its own richer row type:
 * the control plane passes its mirrored station job, the station queue passes the
 * job list row, and both get their own callbacks back without a cast.
 */
export interface JobDetailDrawerProps<T extends DrawerJob = DrawerJob> {
  job: T | null;
  /**
   * Already-localized name of the station that mirrored the job. Empty on a
   * station's own queue, where the destination is simply the printer.
   */
  stationName?: string;
  canReprint: boolean;
  /**
   * Whether a human can acknowledge the physical outcome from here.
   *
   * The acknowledgement is a control-plane triage fact stored on the mirror
   * (`control_device_jobs.reviewed_at`) and it never rewrites the station's own
   * status. A station has no such record, so its queue passes `false` and the
   * drawer offers no review actions at all rather than buttons that do nothing.
   */
  canReview?: boolean;
  /** A review request for this job is in flight. */
  reviewBusy?: boolean;
  onClose: () => void;
  onToggleReview?: (job: T) => void;
  /** Confirm what actually happened to the paper, when the station could not. */
  onResolve?: (job: T, outcome: 'PRINTED' | 'NOT_PRINTED') => void;
  onReprint: (job: T) => void;
  /**
   * Open the full detail page for this job. The station's queue has one; the
   * control plane's drawer reads the mirrored summary and stops there.
   */
  onOpenFullDetail?: () => void;
  openFullDetailLabel?: string;
}

interface CopyValueButtonProps {
  value: string;
  /** Human field name, used verbatim in the accessible name. */
  label: string;
  copied: boolean;
  onCopy: (value: string) => void;
}

/** Copy affordance for one field. The confirmation is announced by the drawer. */
function CopyValueButton({ value, label, copied, onCopy }: CopyValueButtonProps) {
  const { t } = useLocale();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={formatMessage(t('control.jobs.detailCopyField'), { field: label })}
      onClick={() => onCopy(value)}
    >
      {copied ? t('control.jobs.detailCopied') : t('control.jobs.detailCopy')}
    </Button>
  );
}

export function JobDetailDrawer<T extends DrawerJob = DrawerJob>({
  job,
  stationName = '',
  canReprint,
  canReview = true,
  reviewBusy = false,
  onClose,
  onToggleReview,
  onResolve,
  onReprint,
  onOpenFullDetail,
  openFullDetailLabel,
}: JobDetailDrawerProps<T>) {
  const { t } = useLocale();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(async (value: string, field: string) => {
    const copied = await copyTextToClipboard(value);
    if (!copied) return;
    setCopiedField(field);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const payload = useMemo(() => (job ? extractJobPayload(job as never) : {}), [job]);
  const payloadEntries = useMemo(() => Object.entries(payload), [payload]);
  const payloadJson = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const logText = useMemo(() => {
    if (!job) return '';
    return [job.errorCode, job.errorMessage]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join('\n');
  }, [job]);

  const verdict = job ? getJobVerdict(job.status) : null;
  const headlineKey =
    job?.status === 'SUCCESS'
      ? REPORTED_COMPLETE_COPY.headline
      : verdict
        ? verdictHeadlineKey(verdict)
        : '';
  const detailKey =
    job?.status === 'SUCCESS'
      ? REPORTED_COMPLETE_COPY.detail
      : verdict
        ? verdictDetailKey(verdict)
        : '';
  const hasTechnical = Boolean(
    job &&
      (job.id ||
        job.requestId ||
        job.sourceSystem ||
        job.resolvedTemplateCode ||
        job.templateCode ||
        job.paperProfileId ||
        job.printerCode ||
        job.printerId ||
        job.runnerId ||
        job.errorCode ||
        job.errorMessage ||
        job.createdAt ||
        job.finishedAt ||
        job.completedAt ||
        job.updatedAt),
  );

  const renderTechnicalField = (
    fieldKey: string,
    label: string,
    value: string | undefined | null,
    copyable = false,
  ) => {
    if (value == null || value === '') return null;
    return (
      <Stack key={fieldKey} gap="xs">
        <Text size="label" weight="semibold" tone="muted">
          {label}
        </Text>
        <Inline gap="sm">
          <Mono size="label" wrap style={{ flex: '1 1 14rem', minWidth: 0 }}>
            {value}
          </Mono>
          {copyable && (
            <CopyValueButton
              value={value}
              label={label}
              copied={copiedField === fieldKey}
              onCopy={(next) => void handleCopy(next, fieldKey)}
            />
          )}
        </Inline>
      </Stack>
    );
  };

  const reviewable = canReview && job !== null && (jobNeedsAttention(job.status) || Boolean(job.reviewedAt));

  return (
    <Drawer
      open={job !== null}
      onClose={onClose}
      title={t('control.jobs.detailTitle')}
      closeLabel={t('common.close')}
      className="wcj-detail-drawer"
      footer={
        <>
          {onOpenFullDetail && (
            <Button variant="secondary" onClick={onOpenFullDetail}>
              {openFullDetailLabel ?? t('control.jobs.detailOpenFull')}
            </Button>
          )}
          {job && reviewable && (job.reviewedAt ? (
            <Button variant="secondary" busy={reviewBusy} onClick={() => onToggleReview?.(job)}>
              {t('control.jobs.unmarkReviewed')}
            </Button>
          ) : (
            <>
              {/* The answer only a person can give: did paper come out? Two
                  buttons, because "reviewed" alone left the operator guessing
                  what the next shift should do with the row. */}
              <Button
                variant="secondary"
                busy={reviewBusy && job.reviewedOutcome !== 'PRINTED'}
                onClick={() => onResolve?.(job, 'PRINTED')}
              >
                {t('control.jobs.confirmPrinted')}
              </Button>
              <Button
                variant="secondary"
                busy={reviewBusy && job.reviewedOutcome !== 'NOT_PRINTED'}
                onClick={() => onResolve?.(job, 'NOT_PRINTED')}
              >
                {t('control.jobs.confirmNotPrinted')}
              </Button>
            </>
          ))}
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          {job && canReprint && offersReprint(getJobVerdict(job.status)) && (
            <Button
              variant={reprintButtonVariant(getJobVerdict(job.status))}
              onClick={() => onReprint(job)}
            >
              {t('control.jobs.reprint')}
            </Button>
          )}
        </>
      }
    >
      {job && (
        <Stack gap="lg">
          <Stack gap="sm">
            <Inline gap="sm">
              <Mono size="body" weight="semibold" wrap style={{ flex: '1 1 12rem', minWidth: 0 }}>
                {job.requestId || job.id}
              </Mono>
              <CopyValueButton
                value={job.requestId || job.id}
                label={
                  job.requestId
                    ? t('control.jobs.detailRequestId')
                    : t('control.jobs.detailJobId')
                }
                copied={copiedField === 'reference'}
                onCopy={(value) => void handleCopy(value, 'reference')}
              />
            </Inline>
            <CardDetail columns={2}>
              <CardDetailItem label={t('control.jobs.detailDestination')}>
                <Text wrap>
                  {stationName
                    ? formatMessage(t('control.jobs.destinationOnStation'), {
                        printer: job.printerCode || job.printerId,
                        station: stationName,
                      })
                    : job.printerCode || job.printerId}
                </Text>
              </CardDetailItem>
              <CardDetailItem label={t('control.jobs.colStatus')}>
                <StatusBadge status={job.status} size="sm" />
              </CardDetailItem>
              <CardDetailItem label={t('control.jobs.detailReceived')}>
                <Text title={job.createdAt}>{formatCreatedAt(job.createdAt)}</Text>
              </CardDetailItem>
              <CardDetailItem label={t('control.jobs.detailCopies')}>
                <Text>{job.copies}</Text>
              </CardDetailItem>
            </CardDetail>
          </Stack>

          <Stack gap="xs">
            <Text size="label" weight="semibold" tone="muted">
              {t('control.jobs.detailWhatHappened')}
            </Text>
            <Text wrap>{t(headlineKey)}</Text>
          </Stack>

          <Stack gap="xs">
            <Text size="label" weight="semibold" tone="muted">
              {t('control.jobs.detailNextStep')}
            </Text>
            <Text wrap tone="muted">
              {t(detailKey)}
            </Text>
          </Stack>

          {reviewable && (
            <Text size="label" tone="muted" wrap>
              {job.reviewedAt
                ? job.reviewedOutcome
                  ? formatMessage(t('control.jobs.resolvedTransition'), {
                      from: job.status,
                      to:
                        job.reviewedOutcome === 'PRINTED'
                          ? t('control.jobs.outcomePrinted')
                          : t('control.jobs.outcomeNotPrinted'),
                      name: job.reviewedBy ?? '',
                    })
                  : formatMessage(t('control.jobs.reviewedByHint'), {
                      name: job.reviewedBy ?? '',
                    })
                : t('control.jobs.reviewedHint')}
            </Text>
          )}

          {/* The warning answers a question the operator has now answered, so it
              stops being shown once an outcome is confirmed. */}
          {verdict?.outcomeUnknown && !job.reviewedOutcome && (
            <Alert tone="warning" title={t('control.jobs.detailUnconfirmedTitle')}>
              {t('control.jobs.detailUnconfirmedBody')}
            </Alert>
          )}

          <CollapsibleSection title={t('control.jobs.detailIncomingData')} defaultOpen={false}>
            {payloadEntries.length === 0 ? (
              <Text size="label" tone="muted">
                {t('control.jobs.detailNoIncoming')}
              </Text>
            ) : (
              <Stack gap="md">
                {payloadEntries.map(([key, value]) => (
                  <Stack key={key} gap="xs">
                    <Mono size="label" tone="muted" wrap>
                      {key}
                    </Mono>
                    <Inline gap="sm">
                      <Mono size="label" wrap style={{ flex: '1 1 14rem', minWidth: 0 }}>
                        {value}
                      </Mono>
                      <CopyValueButton
                        value={value}
                        label={key}
                        copied={copiedField === `payload:${key}`}
                        onCopy={(next) => void handleCopy(next, `payload:${key}`)}
                      />
                    </Inline>
                  </Stack>
                ))}
              </Stack>
            )}
          </CollapsibleSection>

          <CollapsibleSection title={t('control.jobs.detailTechnical')} defaultOpen={false}>
            {hasTechnical ? (
              <Stack gap="md">
                {renderTechnicalField('jobId', t('control.jobs.detailJobId'), job.id, true)}
                {renderTechnicalField(
                  'requestId',
                  t('control.jobs.detailRequestId'),
                  job.requestId,
                  true,
                )}
                {renderTechnicalField('source', t('control.jobs.detailSource'), job.sourceSystem)}
                {renderTechnicalField(
                  'template',
                  t('control.jobs.detailTemplate'),
                  job.resolvedTemplateCode ?? job.templateCode,
                )}
                {renderTechnicalField(
                  'paperProfile',
                  t('control.jobs.detailPaperProfile'),
                  job.paperProfileId,
                )}
                {renderTechnicalField(
                  'printer',
                  t('control.jobs.detailPrinter'),
                  job.printerCode || job.printerId,
                )}
                {renderTechnicalField('runner', t('control.jobs.detailRunner'), job.runnerId)}
                {renderTechnicalField(
                  'errorCode',
                  t('control.jobs.detailErrorCode'),
                  job.errorCode,
                  true,
                )}
                {renderTechnicalField(
                  'errorMessage',
                  t('control.jobs.detailErrorMessage'),
                  job.errorMessage,
                  true,
                )}
                {renderTechnicalField('created', t('page.jobDetail.created'), job.createdAt)}
                {renderTechnicalField(
                  'finished',
                  t('page.jobDetail.finished'),
                  job.finishedAt ?? job.completedAt,
                )}
                {renderTechnicalField('updated', t('page.jobDetail.updated'), job.updatedAt)}

                <Stack gap="xs">
                  <Inline gap="sm">
                    <Text size="label" weight="semibold" tone="muted">
                      {t('control.jobs.detailRawJson')}
                    </Text>
                    <CopyValueButton
                      value={payloadJson}
                      label={t('control.jobs.detailRawJson')}
                      copied={copiedField === 'rawJson'}
                      onCopy={(value) => void handleCopy(value, 'rawJson')}
                    />
                  </Inline>
                  <CodeBlock label={t('control.jobs.detailRawJson')} scroll={false}>
                    {payloadJson}
                  </CodeBlock>
                </Stack>

                <Stack gap="xs">
                  <Inline gap="sm">
                    <Text size="label" weight="semibold" tone="muted">
                      {t('control.jobs.detailLogs')}
                    </Text>
                    {logText && (
                      <CopyValueButton
                        value={logText}
                        label={t('control.jobs.detailLogs')}
                        copied={copiedField === 'logs'}
                        onCopy={(value) => void handleCopy(value, 'logs')}
                      />
                    )}
                  </Inline>
                  {logText ? (
                    <CodeBlock label={t('control.jobs.detailLogs')} scroll={false}>
                      {logText}
                    </CodeBlock>
                  ) : (
                    <Text size="label" tone="muted">
                      {t('control.jobs.detailNoLogs')}
                    </Text>
                  )}
                </Stack>
              </Stack>
            ) : (
              <Text size="label" tone="muted">
                {t('control.jobs.detailNoTechnical')}
              </Text>
            )}
          </CollapsibleSection>

          <span className="ui-visually-hidden" role="status" aria-live="polite">
            {copiedField ? t('control.jobs.detailCopied') : ''}
          </span>
        </Stack>
      )}
    </Drawer>
  );
}
