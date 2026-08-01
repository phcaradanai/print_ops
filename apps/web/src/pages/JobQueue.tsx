import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobStatus } from '@printerops/domain';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { JobQueueControls } from '../components/JobQueueControls.js';
import {
  Alert,
  Button,
  Checkbox,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  EmptyState,
  ErrorBanner,
  ErrorState,
  CardDetailItem,
  CardDetail,
  FormField,
  Freshness,
  Inline,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Stack,
  StatusBadge,
  Text,
  Textarea,
} from '../components/ui/index.js';
import {
  buildJobQueueView,
  type JobQueueStatusFilter,
} from '../lib/jobQueueView.js';
import { getJobVerdict, offersReprint, reprintButtonVariant } from '../lib/jobVerdict.js';

export interface Job {
  id: string;
  printerCode?: string;
  printerId: string;
  status: string;
  copies: number;
  priorityLabel?: string;
  sourceSystem?: string;
  sourceReference?: string;
  requestId?: string;
  templateCode?: string;
  resolvedTemplateCode?: string;
  paperProfileId?: string;
  payloadSnapshot?: string;
  mimeType?: string;
  latency?: { totalLatencyMs?: number };
  createdAt: string;
  completedAt?: string;
  runnerId?: string;
  metadata?: Record<string, unknown>;
}

interface BatchReprintResult {
  originalJob: Job;
  createdJob?: Job;
  error?: string;
}

/** Extract a short human hint about what was printed from payloadSnapshot.
 *  Snapshot format is "keys=[a,b,c] len=123" — surface the keys so an operator
 *  scanning the queue can tell a label apart from a prescription at a glance. */
function payloadHint(snapshot?: string): string | null {
  if (!snapshot) return null;
  const match = snapshot.match(/keys=\[([^\]]*)\]/);
  if (match && match[1]) return match[1];
  return null;
}

function formatCreatedAt(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Queue cadence. Suspended while the window is hidden and never overlapping —
 *  see `lib/pollController.ts`. */
const QUEUE_POLL_MS = 1_500;
const QUEUE_PAGE_SIZE = 20;

export default function JobQueue() {
  const { t } = useLocale();

  const fetchJobs = useCallback(() => apiFetch<Job[]>('/jobs?limit=1000'), []);
  const queue = useApiResource(fetchJobs, { intervalMs: QUEUE_POLL_MS });
  const jobs = queue.data ?? [];

  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [batchResults, setBatchResults] = useState<BatchReprintResult[] | null>(null);
  const [reprintJob, setReprintJob] = useState<Job | null>(null);
  const [openingJobId, setOpeningJobId] = useState<string | null>(null);
  const [reprintReason, setReprintReason] = useState('');
  const [reprintCopies, setReprintCopies] = useState(1);
  const [duplicateRisk, setDuplicateRisk] = useState(false);
  const [statusFilter, setStatusFilter] = useState<JobQueueStatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchModal, setBatchModal] = useState<'reprint' | null>(null);
  const [batchReason, setBatchReason] = useState('');
  const [batchDuplicateRisk, setBatchDuplicateRisk] = useState(false);

  const view = useMemo(
    () => buildJobQueueView(jobs, {
      status: statusFilter,
      search: searchQuery,
      page,
      pageSize: QUEUE_PAGE_SIZE,
    }),
    [jobs, page, searchQuery, statusFilter],
  );

  // Auto-refresh may remove the last row on the current page. Clamp the page,
  // but preserve the operator's selected filter and search query.
  useEffect(() => {
    if (page !== view.page) setPage(view.page);
  }, [page, view.page]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    setSelectedIds((previous) => new Set(
      [...previous].filter((id) => {
        const job = jobs.find((candidate) => candidate.id === id);
        return job != null && offersReprint(getJobVerdict(job.status));
      }),
    ));
  }, [jobs]);

  // Loading the FULL job is a safety step, not a convenience: the dialog
  // refuses to submit without requestId and runnerId, which the list payload
  // does not carry.
  const loadReprintTarget = useApiAction(async (job: Job) => {
    const fullJob = await apiFetch<Job>(`/jobs/${job.id}`);
    setReprintCopies(fullJob.copies || 1);
    setReprintReason('');
    setDuplicateRisk(false);
    setReprintJob(fullJob);
    return fullJob;
  });

  // Request body unchanged: printerId, copies, reason, confirmedDuplicateRisk.
  const submitReprint = useApiAction(async (job: Job, copies: number, reason: string, confirmed: boolean) => {
    const newJob = await apiFetch<Job>(`/jobs/${job.id}/reprint`, {
      method: 'POST',
      body: JSON.stringify({
        printerId: job.printerId,
        copies,
        reason,
        confirmedDuplicateRisk: confirmed,
      }),
    });
    setReprintJob(null);
    return newJob;
  });

  const openReprint = async (job: Job) => {
    setOpeningJobId(job.id);
    const loaded = await loadReprintTarget.run(job);
    setOpeningJobId(null);
    if (!loaded) {
      setMessage({
        tone: 'error',
        text: `${t('page.jobQueue.reprintLoadFailed')} ${errorMessage(loadReprintTarget.getError())}`,
      });
    }
  };

  const confirmReprint = async () => {
    if (!reprintJob) return;
    const newJob = await submitReprint.run(reprintJob, reprintCopies, reprintReason, duplicateRisk);
    if (newJob) {
      setMessage({
        tone: 'ok',
        text: t('page.jobQueue.reprintSubmitted').replace('{id}', newJob.id.slice(0, 8)),
      });
    } else {
      setMessage({
        tone: 'error',
        text: `${t('page.jobQueue.reprintFailed')} ${errorMessage(submitReprint.getError())}`,
      });
    }
  };

  const reprintingId = submitReprint.pending ? reprintJob?.id ?? null : null;

  const currentPageJobIds = useMemo(
    () => view.rows.filter((job) => offersReprint(getJobVerdict(job.status))).map((job) => job.id),
    [view.rows],
  );
  const allPageSelected = currentPageJobIds.length > 0 && currentPageJobIds.every(id => selectedIds.has(id));

  const toggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        currentPageJobIds.forEach(id => next.delete(id));
      } else {
        view.rows
          .filter((job) => offersReprint(getJobVerdict(job.status)))
          .forEach((job) => next.add(job.id));
      }
      return next;
    });
  };

  const toggleSelectJob = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const batchReprintAction = useApiAction(async (selectedJobs: Job[], reason: string, confirmed: boolean) => {
    const results: BatchReprintResult[] = [];
    for (const selectedJob of selectedJobs) {
      try {
        const fullJob = await apiFetch<Job>(`/jobs/${selectedJob.id}`);
        if (!offersReprint(getJobVerdict(fullJob.status)) || !fullJob.runnerId || !fullJob.requestId) {
          results.push({ originalJob: fullJob, error: t('page.jobQueue.batchReprintUnavailable') });
          continue;
        }
        const createdJob = await apiFetch<Job>(`/jobs/${fullJob.id}/reprint`, {
          method: 'POST',
          body: JSON.stringify({
            printerId: fullJob.printerId,
            copies: fullJob.copies || 1,
            reason,
            confirmedDuplicateRisk: confirmed,
          }),
        });
        results.push({ originalJob: fullJob, createdJob });
      } catch (error) {
        results.push({ originalJob: selectedJob, error: errorMessage(error) });
      }
    }
    setSelectedIds(new Set());
    setBatchModal(null);
    return results;
  });

  const confirmBatchReprint = async () => {
    const selectedJobs = jobs.filter((job) => selectedIds.has(job.id) && offersReprint(getJobVerdict(job.status)));
    if (selectedJobs.length === 0) return;
    const results = await batchReprintAction.run(selectedJobs, batchReason, batchDuplicateRisk);
    if (results) {
      setBatchResults(results);
      queue.refresh();
    }
  };

  const selectedJobs = useMemo(
    () => jobs.filter((job) => selectedIds.has(job.id) && offersReprint(getJobVerdict(job.status))),
    [jobs, selectedIds],
  );
  const selectedCautionJobs = useMemo(
    () => selectedJobs.filter((job) => getJobVerdict(job.status).reprint === 'caution'),
    [selectedJobs],
  );
  const selectedRoutineJobs = useMemo(
    () => selectedJobs.filter((job) => getJobVerdict(job.status).reprint !== 'caution'),
    [selectedJobs],
  );

  return (
    <PageLayout
      title={t('page.jobQueue.title')}
      density="compact"
      actions={<Freshness
          lastSuccessAt={queue.lastSuccessAt}
          stale={queue.stale}
          refreshing={queue.refreshing}
          paused={queue.paused}
          onRefresh={queue.refresh}
        />}
    >

      {message && (
        <Alert
          tone={message.tone === 'ok' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('error.dismiss')}
        >
          {message.text}
        </Alert>
      )}

      {/* Refresh failed but rows are still on screen: they are a snapshot.
          Manual retry, because the loop may be backing off behind a dead API. */}
      {queue.stale && queue.error != null && (
        <ErrorBanner error={queue.error} title={t('error.refresh.title')} onRetry={queue.refresh} />
      )}

      {jobs.length >= 1000 && (
        <Alert
          tone="warning"
          dismissLabel={t('error.dismiss')}
        >
          <Text weight="semibold">{t('page.jobQueue.truncatedTitle')}</Text> {t('page.jobQueue.truncatedDetail')}
        </Alert>
      )}

      <JobQueueControls
        status={statusFilter}
        search={searchQuery}
        counts={view.counts as Record<JobStatus, number>}
        totalCount={jobs.length}
        labels={{
          status: t('page.jobQueue.statusFilter'),
          all: t('page.jobQueue.statusAll'),
          search: t('page.jobQueue.search'),
          searchPlaceholder: t('page.jobQueue.searchPlaceholder'),
        }}
        onStatusChange={(next) => { setStatusFilter(next); setPage(1); }}
        onSearchChange={(next) => { setSearchQuery(next); setPage(1); }}
      />

      {queue.loading && !queue.data ? <LoadingState /> : queue.error != null && !queue.data ? (
        <ErrorState error={queue.error} title={t('page.jobQueue.loadFailed')} onRetry={queue.refresh} />
      ) : (
        <>
          {view.rows.length === 0 ? (
            <EmptyState title={jobs.length === 0 ? t('page.jobQueue.noJobs') : t('page.jobQueue.noMatchingJobs')} />
          ) : (
            /* One semantic table that becomes labelled cards under 1024px.
               Previously a `<table>` and a parallel `<ul>` of the same rows were
               both mounted, so every selection checkbox and every Reprint button
               existed twice in the accessibility tree — on a page whose buttons
               put paper through a physical device. */
            <DataTable label={t('page.jobQueue.title')} responsive>
              <thead>
                <tr>
                  <DataHead>
                    <Checkbox
                      hideLabel
                      label={t('page.jobQueue.selectAllPage')}
                      checked={allPageSelected}
                      onChange={toggleSelectAllPage}
                      disabled={currentPageJobIds.length === 0}
                    />
                  </DataHead>
                  <DataHead>{t('page.jobQueue.status')}</DataHead>
                  <DataHead>{t('page.jobQueue.document')}</DataHead>
                  <DataHead>{t('page.jobQueue.printer')}</DataHead>
                  <DataHead>{t('page.jobQueue.source')}</DataHead>
                  <DataHead>{t('page.jobQueue.copies')}</DataHead>
                  <DataHead>{t('page.jobQueue.latencyMs')}</DataHead>
                  <DataHead>{t('page.jobQueue.created')}</DataHead>
                  <DataHead><span className="ui-visually-hidden">{t('page.jobQueue.batchActions')}</span></DataHead>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((j) => {
                  const template = j.resolvedTemplateCode ?? j.templateCode;
                  const hint = payloadHint(j.payloadSnapshot);
                  const isReprintable = offersReprint(getJobVerdict(j.status));
                  const isSelected = selectedIds.has(j.id);
                  return (
                    <tr key={j.id} className={`job-row ${j.status.toLowerCase()} ${isSelected ? 'is-selected' : ''}`}>
                      <DataCell label={t('page.jobQueue.selectAllPage')}>
                        <Checkbox
                          hideLabel
                          label={t('page.jobQueue.selectJob').replace('{id}', j.id.slice(0, 8))}
                          checked={isSelected}
                          onChange={() => toggleSelectJob(j.id)}
                          disabled={!isReprintable}
                        />
                      </DataCell>
                      {/* The empty `status-dot` that used to sit here carried no
                          tone and no meaning — the badge already states the status. */}
                      <DataCell label={t('page.jobQueue.status')}>
                        <StatusBadge status={j.status} size="sm" />
                      </DataCell>
                      {/* Document summary — the key column that was missing */}
                      <DataCell label={t('page.jobQueue.document')}>
                        <Stack gap="xs">
                          <Link to={`/jobs/${j.id}`} className="ui-link" title={template ?? t('common.noData')}>
                            <Text weight="semibold" truncate>{template ?? t('common.noData')}</Text>
                          </Link>
                          {j.sourceReference && (
                            <Text size="label" tone="muted" truncate title={j.sourceReference}>
                              {t('page.jobQueue.documentNumber')}: {j.sourceReference}
                            </Text>
                          )}
                          {hint && <Text size="label" tone="muted" truncate title={hint}>{hint}</Text>}
                          <Mono tone="muted" truncate title={j.id}>{j.id}</Mono>
                        </Stack>
                      </DataCell>
                      <DataCell label={t('page.jobQueue.printer')}>
                        <Link
                          to={`/printers/${j.printerId}`}
                          className="ui-link"
                          title={j.printerCode ?? j.printerId}
                        >
                          <Text truncate>{j.printerCode ?? j.printerId}</Text>
                        </Link>
                      </DataCell>
                      <DataCell label={t('page.jobQueue.source')}>
                        <Text tone="muted">{j.sourceSystem ?? t('common.noData')}</Text>
                      </DataCell>
                      <DataCell label={t('page.jobQueue.copies')}>
                        <Mono>{j.copies}</Mono>
                      </DataCell>
                      <DataCell label={t('page.jobQueue.latencyMs')}>
                        <Text tone="muted" mono>
                          {j.latency?.totalLatencyMs != null
                            ? t('page.jobQueue.latencyValue').replace('{value}', String(j.latency.totalLatencyMs))
                            : t('common.noData')}
                        </Text>
                      </DataCell>
                      <DataCell label={t('page.jobQueue.created')}>
                        <Text size="label" tone="muted" nowrap>{formatCreatedAt(j.createdAt)}</Text>
                      </DataCell>
                      <DataCell label={t('page.jobQueue.batchActions')} actions>
                        {isReprintable && <Button
                          variant={reprintButtonVariant(getJobVerdict(j.status))}
                          size="sm"
                          onClick={() => void openReprint(j)}
                          busy={openingJobId === j.id || reprintingId === j.id}
                          busyLabel={t('page.jobQueue.reprintSubmitting')}
                          aria-label={t('page.jobQueue.reprintJob').replace('{id}', j.id.slice(0, 8))}
                        >
                          {t('page.jobQueue.reprint')}
                        </Button>}
                      </DataCell>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}

          {selectedJobs.length > 0 && (
            <div className="batch-action-bar" role="region" aria-label={t('page.jobQueue.batchActions')}>
              <div className="batch-action-count">
                <span className="batch-action-badge">{selectedJobs.length}</span>
                <span>{t('page.jobQueue.selectedCount').replace('{count}', String(selectedJobs.length))}</span>
              </div>
              <div className="batch-action-buttons">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setBatchReason('');
                    setBatchDuplicateRisk(false);
                    setBatchModal('reprint');
                  }}
                >
                  {t('page.jobQueue.batchReprint').replace('{count}', String(selectedJobs.length))}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                >
                  {t('page.jobQueue.clearSelection')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {view.filteredCount > 0 && (
        <nav className="job-queue-pagination" aria-label={t('page.jobQueue.pagination')}>
          <Button
            variant="secondary"
            size="sm"
            disabled={view.page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            {t('page.jobQueue.previous')}
          </Button>
          <Text size="label" tone="muted" nowrap>
            {t('page.jobQueue.pageOf')
              .replace('{page}', String(view.page))
              .replace('{total}', String(view.totalPages))}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            disabled={view.page >= view.totalPages}
            onClick={() => setPage((current) => Math.min(view.totalPages, current + 1))}
          >
            {t('page.jobQueue.next')}
          </Button>
        </nav>
      )}
      {batchResults && (
        <Alert
          tone={batchResults.every((result) => result.createdJob) ? 'success' : 'error'}
          onDismiss={() => setBatchResults(null)}
          dismissLabel={t('error.dismiss')}
        >
          <Text as="p" weight="semibold">{t('page.jobQueue.batchResultsTitle')}</Text>
          <ul className="batch-result-list">
            {batchResults.map((result) => (
              <li key={result.originalJob.id}>
                <Mono>{result.originalJob.id.slice(0, 8)}</Mono>{' '}
                {result.createdJob ? (
                  <Link className="ui-link" to={`/jobs/${result.createdJob.id}`}>
                    {t('page.jobQueue.batchResultCreated').replace('{id}', result.createdJob.id.slice(0, 8))}
                  </Link>
                ) : (
                  <Text tone="danger">{t('page.jobQueue.batchResultFailed').replace('{error}', result.error ?? t('common.error'))}</Text>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {/* Reprint confirmation. Safety semantics are unchanged: the submit stays
          blocked without an explicit duplicate-risk acknowledgement, a reason,
          a runner id and the original request id. Only the wording moved into
          i18n — a Thai-default hospital app was showing this English-only. */}
      <Dialog
        open={reprintJob !== null}
        onClose={() => setReprintJob(null)}
        title={t('page.jobQueue.reprintTitle')}
        warning={t('page.jobQueue.reprintWarning')}
        footer={
          reprintJob && (
            <>
              <Button variant="secondary" onClick={() => setReprintJob(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                form="reprint-form"
                type="submit"
                busy={reprintingId === reprintJob.id}
                busyLabel={t('page.jobQueue.reprintSubmitting')}
                disabled={
                  !duplicateRisk ||
                  !reprintReason.trim() ||
                  !reprintJob.runnerId ||
                  !reprintJob.requestId
                }
              >
                {t('page.jobQueue.reprintConfirm')}
              </Button>
            </>
          )
        }
      >
        {reprintJob && (
          <Stack as="form" gap="lg" id="reprint-form" onSubmit={(event) => { event.preventDefault(); void confirmReprint(); }}>
            <CardDetail>
              <CardDetailItem label={t('page.jobQueue.reprintOriginalRequestId')}>
                <Mono>{reprintJob.requestId ?? t('page.jobQueue.reprintBlockedMissing')}</Mono>
              </CardDetailItem>
              <CardDetailItem label={t('page.jobQueue.reprintOriginalJobId')}>
                <Mono>{reprintJob.id}</Mono>
              </CardDetailItem>
              <CardDetailItem label={t('page.jobQueue.reprintPrintStatus')}>
                <StatusBadge status={reprintJob.status} size="sm" />
              </CardDetailItem>
              <CardDetailItem label={t('page.jobQueue.reprintDestination')}>
                {reprintJob.printerCode ?? reprintJob.printerId}
              </CardDetailItem>
              <CardDetailItem label={t('page.jobQueue.reprintRunner')}>
                {reprintJob.runnerId ?? t('page.jobQueue.reprintBlockedUnknown')}
              </CardDetailItem>
              <CardDetailItem label={t('page.jobQueue.reprintCompletedAt')}>
                {reprintJob.completedAt ? new Date(reprintJob.completedAt).toLocaleString() : t('page.jobQueue.reprintNotRecorded')}
              </CardDetailItem>
              <CardDetailItem label={t('page.jobQueue.reprintRunnerAck')}>
                {reprintJob.runnerId && reprintJob.completedAt ? t('page.jobQueue.reprintAckYes') : t('page.jobQueue.reprintAckUnknown')}
              </CardDetailItem>
              <CardDetailItem label={t('page.jobQueue.reprintCallbackDelivery')}>
                {t('page.jobQueue.reprintCallbackNote')}
              </CardDetailItem>
            </CardDetail>

            <FormField label={t('page.jobQueue.reprintCopies')} required requiredLabel={t('common.required')}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  step={1}
                  value={reprintCopies}
                  onChange={(e) => setReprintCopies(Number(e.target.value))}
                  required
                />
              )}
            </FormField>

            <FormField label={t('page.jobQueue.reprintReason')} required requiredLabel={t('common.required')}>
              {(control) => (
                <Textarea
                  {...control}
                  value={reprintReason}
                  onChange={(e) => setReprintReason(e.target.value)}
                  required
                />
              )}
            </FormField>

            <Checkbox
              label={t('page.jobQueue.reprintAcknowledge')}
              checked={duplicateRisk}
              onChange={(e) => setDuplicateRisk(e.target.checked)}
            />
          </Stack>
        )}
      </Dialog>

      <Dialog
        open={batchModal === 'reprint'}
        onClose={() => setBatchModal(null)}
        title={t('page.jobQueue.batchReprintTitle').replace('{count}', String(selectedJobs.length))}
        warning={t('page.jobQueue.reprintWarning')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBatchModal(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              form="batch-reprint-form"
              type="submit"
              busy={batchReprintAction.pending}
              busyLabel={t('page.jobQueue.batchReprintSubmitting')}
              disabled={!batchDuplicateRisk || !batchReason.trim() || selectedJobs.length === 0}
            >
              {t('page.jobQueue.batchReprintConfirm').replace('{count}', String(selectedJobs.length))}
            </Button>
          </>
        }
      >
        <Stack as="form" gap="lg" id="batch-reprint-form" onSubmit={(e) => { e.preventDefault(); void confirmBatchReprint(); }}>
          <Text as="p">
            {t('page.jobQueue.batchReprintIntro').replace('{count}', String(selectedJobs.length))}
          </Text>
          {selectedRoutineJobs.length > 0 && (
            <ul className="batch-reprint-jobs" aria-label={t('page.jobQueue.batchSelectedJobs')}>
              {selectedRoutineJobs.map((job) => (
                <li key={job.id}>
                  <StatusBadge status={job.status} size="sm" />
                  <Text>{job.printerCode ?? job.printerId}</Text>
                  <Text tone="muted">{t('page.jobQueue.batchCopies').replace('{count}', String(job.copies))}</Text>
                </li>
              ))}
            </ul>
          )}
          {/* Caution jobs may already be on paper. They stay in their own labelled
              region so a bulk acknowledgement is never given to them by accident. */}
          {selectedCautionJobs.length > 0 && (
            <Alert tone="warning" title={t('page.jobQueue.batchCautionTitle')}>
              <Stack gap="sm">
                <Text>{t('page.jobQueue.batchCautionDetail')}</Text>
                <ul className="batch-reprint-jobs">
                  {selectedCautionJobs.map((job) => (
                    <li key={job.id}>
                      <StatusBadge status={job.status} size="sm" />
                      <Text>{job.printerCode ?? job.printerId}</Text>
                      <Text tone="muted">{t('page.jobQueue.batchCopies').replace('{count}', String(job.copies))}</Text>
                    </li>
                  ))}
                </ul>
              </Stack>
            </Alert>
          )}
          <FormField label={t('page.jobQueue.reprintReason')} required requiredLabel={t('common.required')}>
            {(control) => (
              <Textarea
                {...control}
                value={batchReason}
                onChange={(e) => setBatchReason(e.target.value)}
                placeholder={t('page.jobQueue.batchReasonPlaceholder')}
                required
              />
            )}
          </FormField>
          <Checkbox
            label={t('page.jobQueue.batchAcknowledge').replace('{count}', String(selectedJobs.length))}
            checked={batchDuplicateRisk}
            onChange={(e) => setBatchDuplicateRisk(e.target.checked)}
          />
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
