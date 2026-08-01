import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobStatus } from '@printerops/domain';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { EmptyState, ErrorBanner, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { FormField } from '../components/FormField.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { JobQueueControls } from '../components/JobQueueControls.js';
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

/** A complete identifier remains available on hover and in the native title,
 * while the normal table/card flow may safely ellipsize it. */
function HoverTruncated({ value, className = '' }: { value?: string; className?: string }) {
  const { t } = useLocale();
  const fallback = t('common.noData');
  const fullText = value && value.length > 0 ? value : fallback;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  return (
    <span
      className="truncate-wrap"
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ left: Math.min(rect.left, window.innerWidth - 580), top: rect.bottom + 8 });
      }}
      onMouseLeave={() => setPosition(null)}
    >
      <span className={`truncate ${className}`} title={fullText}>{fullText}</span>
      {position && fullText !== fallback && (
        <span className="hover-popover" style={{ left: Math.max(16, position.left), top: position.top }}>
          {fullText}
        </span>
      )}
    </span>
  );
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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.jobQueue.title')}</h1>
        {/* Queue rows are only trustworthy with their age attached. */}
        <Freshness
          lastSuccessAt={queue.lastSuccessAt}
          stale={queue.stale}
          refreshing={queue.refreshing}
          paused={queue.paused}
          onRefresh={queue.refresh}
        />
      </div>

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
          <strong>{t('page.jobQueue.truncatedTitle')}</strong> {t('page.jobQueue.truncatedDetail')}
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
            <>
          <table className="data-table job-queue-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    aria-label={t('page.jobQueue.selectAllPage')}
                    checked={allPageSelected}
                    onChange={toggleSelectAllPage}
                    disabled={currentPageJobIds.length === 0}
                  />
                </th>
                {[
                  t('page.jobQueue.status'),
                  t('page.jobQueue.document'),
                  t('page.jobQueue.printer'),
                  t('page.jobQueue.source'),
                  t('page.jobQueue.copies'),
                  t('page.jobQueue.latencyMs'),
                  t('page.jobQueue.created'),
                  '',
                ].map((h, i) => (
                  <th key={i} scope="col">{h}</th>
                ))}
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
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        aria-label={t('page.jobQueue.selectJob').replace('{id}', j.id.slice(0, 8))}
                        checked={isSelected}
                        onChange={() => toggleSelectJob(j.id)}
                        disabled={!isReprintable}
                      />
                    </td>
                    {/* Status badge with dot */}
                    <td className="status-cell">
                      <span>
                        <span className="status-dot" />
                        <StatusBadge status={j.status} size="sm" />
                      </span>
                    </td>
                    {/* Document summary — the key column that was missing */}
                    <td className="queue-document-cell">
                      <div className="queue-document-summary">
                        <Link to={`/jobs/${j.id}`} className="queue-document-title">
                          <HoverTruncated value={template ?? t('common.noData')} />
                        </Link>
                        {j.sourceReference && (
                          <span className="queue-document-reference">
                            {t('page.jobQueue.documentNumber')}: <HoverTruncated value={j.sourceReference} />
                          </span>
                        )}
                        {hint && (
                          <span className="queue-document-payload">{hint}</span>
                        )}
                        <HoverTruncated value={j.id} className="queue-job-id" />
                      </div>
                    </td>
                    {/* Printer */}
                    <td className="queue-printer-cell">
                      <Link to={`/printers/${j.printerId}`}>
                        <HoverTruncated value={j.printerCode ?? j.printerId} />
                      </Link>
                    </td>
                    {/* Source system */}
                    <td className="queue-source-cell">
                      {j.sourceSystem ?? t('common.noData')}
                    </td>
                    {/* Copies */}
                    <td className="queue-copies-cell">{j.copies}</td>
                    {/* Latency */}
                    <td className="queue-latency-cell">
                      {j.latency?.totalLatencyMs != null
                        ? t('page.jobQueue.latencyValue').replace('{value}', String(j.latency.totalLatencyMs))
                        : t('common.noData')}
                    </td>
                    {/* Created */}
                    <td className="queue-created-cell">{formatCreatedAt(j.createdAt)}</td>
                    {/* Actions */}
                    <td>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <ul className="job-queue-cards" aria-label={t('page.jobQueue.title')}>
            {view.rows.map((j) => {
              const template = j.resolvedTemplateCode ?? j.templateCode;
              const hint = payloadHint(j.payloadSnapshot);
              const isReprintable = offersReprint(getJobVerdict(j.status));
              const isSelected = selectedIds.has(j.id);
              return (
                <li key={j.id} className={`job-queue-card job-row ${j.status.toLowerCase()} ${isSelected ? 'is-selected' : ''}`}>
                  <div className="job-queue-card__topline">
                    <input
                      type="checkbox"
                      aria-label={t('page.jobQueue.selectJob').replace('{id}', j.id.slice(0, 8))}
                      checked={isSelected}
                      onChange={() => toggleSelectJob(j.id)}
                      disabled={!isReprintable}
                    />
                    <div className="status-cell"><span><span className="status-dot" /><StatusBadge status={j.status} size="sm" /></span></div>
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
                  </div>
                  <Link to={`/jobs/${j.id}`} className="queue-document-title">
                    <HoverTruncated value={template ?? t('common.noData')} />
                  </Link>
                  <dl className="job-queue-card__facts">
                    <div>
                      <dt>{t('page.jobQueue.printer')}</dt>
                      <dd><Link to={`/printers/${j.printerId}`}><HoverTruncated value={j.printerCode ?? j.printerId} /></Link></dd>
                    </div>
                    <div><dt>{t('page.jobQueue.source')}</dt><dd>{j.sourceSystem ?? t('common.noData')}</dd></div>
                    <div><dt>{t('page.jobQueue.copies')}</dt><dd>{j.copies}</dd></div>
                    <div><dt>{t('page.jobQueue.latencyMs')}</dt><dd>{j.latency?.totalLatencyMs != null ? t('page.jobQueue.latencyValue').replace('{value}', String(j.latency.totalLatencyMs)) : t('common.noData')}</dd></div>
                    <div><dt>{t('page.jobQueue.created')}</dt><dd>{formatCreatedAt(j.createdAt)}</dd></div>
                    {j.sourceReference && <div className="job-queue-card__wide"><dt>{t('page.jobQueue.documentNumber')}</dt><dd><HoverTruncated value={j.sourceReference} /></dd></div>}
                    {hint && <div className="job-queue-card__wide job-queue-card__payload"><dt>{t('page.jobQueue.document')}</dt><dd>{hint}</dd></div>}
                    <div className="job-queue-card__wide"><dt>{t('page.jobQueue.jobId')}</dt><dd><HoverTruncated value={j.id} /></dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
          </>
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
          <span>
            {t('page.jobQueue.pageOf')
              .replace('{page}', String(view.page))
              .replace('{total}', String(view.totalPages))}
          </span>
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
          <p className="batch-result-summary">{t('page.jobQueue.batchResultsTitle')}</p>
          <ul className="batch-result-list">
            {batchResults.map((result) => (
              <li key={result.originalJob.id}>
                <code>{result.originalJob.id.slice(0, 8)}</code>{' '}
                {result.createdJob ? (
                  <Link to={`/jobs/${result.createdJob.id}`}>
                    {t('page.jobQueue.batchResultCreated').replace('{id}', result.createdJob.id.slice(0, 8))}
                  </Link>
                ) : (
                  <span>{t('page.jobQueue.batchResultFailed').replace('{error}', result.error ?? t('common.error'))}</span>
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
          <form id="reprint-form" onSubmit={(event) => { event.preventDefault(); void confirmReprint(); }}>
            <dl className="reprint-facts">
              <dt>{t('page.jobQueue.reprintOriginalRequestId')}</dt>
              <dd><code>{reprintJob.requestId ?? t('page.jobQueue.reprintBlockedMissing')}</code></dd>
              <dt>{t('page.jobQueue.reprintOriginalJobId')}</dt>
              <dd><code>{reprintJob.id}</code></dd>
              <dt>{t('page.jobQueue.reprintPrintStatus')}</dt>
              <dd><StatusBadge status={reprintJob.status} size="sm" /></dd>
              <dt>{t('page.jobQueue.reprintDestination')}</dt>
              <dd>{reprintJob.printerCode ?? reprintJob.printerId}</dd>
              <dt>{t('page.jobQueue.reprintRunner')}</dt>
              <dd>{reprintJob.runnerId ?? t('page.jobQueue.reprintBlockedUnknown')}</dd>
              <dt>{t('page.jobQueue.reprintCompletedAt')}</dt>
              <dd>{reprintJob.completedAt ? new Date(reprintJob.completedAt).toLocaleString() : t('page.jobQueue.reprintNotRecorded')}</dd>
              <dt>{t('page.jobQueue.reprintRunnerAck')}</dt>
              <dd>{reprintJob.runnerId && reprintJob.completedAt ? t('page.jobQueue.reprintAckYes') : t('page.jobQueue.reprintAckUnknown')}</dd>
              <dt>{t('page.jobQueue.reprintCallbackDelivery')}</dt>
              <dd>{t('page.jobQueue.reprintCallbackNote')}</dd>
            </dl>

            <FormField label={t('page.jobQueue.reprintCopies')} required requiredLabel={t('common.required')}>
              {(control) => (
                <input
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
                <textarea
                  {...control}
                  value={reprintReason}
                  onChange={(e) => setReprintReason(e.target.value)}
                  required
                />
              )}
            </FormField>

            <label className="reprint-ack">
              <input
                type="checkbox"
                checked={duplicateRisk}
                onChange={(e) => setDuplicateRisk(e.target.checked)}
              />
              {t('page.jobQueue.reprintAcknowledge')}
            </label>
          </form>
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
        <form id="batch-reprint-form" onSubmit={(e) => { e.preventDefault(); void confirmBatchReprint(); }}>
          <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--neutral-text)' }}>
            {t('page.jobQueue.batchReprintIntro').replace('{count}', String(selectedJobs.length))}
          </p>
          {selectedRoutineJobs.length > 0 && <ul className="batch-reprint-jobs" aria-label={t('page.jobQueue.batchSelectedJobs')}>
            {selectedRoutineJobs.map((job) => (
              <li key={job.id}>
                <StatusBadge status={job.status} size="sm" />
                <span>{job.printerCode ?? job.printerId}</span>
                <span>{t('page.jobQueue.batchCopies').replace('{count}', String(job.copies))}</span>
              </li>
            ))}
          </ul>}
          {selectedCautionJobs.length > 0 && (
            <section className="batch-reprint-caution" aria-labelledby="batch-reprint-caution-heading">
              <h2 id="batch-reprint-caution-heading">{t('page.jobQueue.batchCautionTitle')}</h2>
              <p>{t('page.jobQueue.batchCautionDetail')}</p>
              <ul className="batch-reprint-jobs">
                {selectedCautionJobs.map((job) => (
                  <li key={job.id}>
                    <StatusBadge status={job.status} size="sm" />
                    <span>{job.printerCode ?? job.printerId}</span>
                    <span>{t('page.jobQueue.batchCopies').replace('{count}', String(job.copies))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <FormField label={t('page.jobQueue.reprintReason')} required requiredLabel={t('common.required')}>
            {(control) => (
              <textarea
                {...control}
                value={batchReason}
                onChange={(e) => setBatchReason(e.target.value)}
                placeholder={t('page.jobQueue.batchReasonPlaceholder')}
                required
              />
            )}
          </FormField>
          <label className="reprint-ack" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={batchDuplicateRisk}
              onChange={(e) => setBatchDuplicateRisk(e.target.checked)}
            />
            <span>{t('page.jobQueue.batchAcknowledge').replace('{count}', String(selectedJobs.length))}</span>
          </label>
        </form>
      </Dialog>
    </div>
  );
}
