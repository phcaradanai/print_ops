import { useCallback, useEffect, useState } from 'react';
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

interface Job {
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

/** Extract a short human hint about what was printed from payloadSnapshot.
 *  Snapshot format is "keys=[a,b,c] len=123" — surface the keys so an operator
 *  scanning the queue can tell a label apart from a prescription at a glance. */
function payloadHint(snapshot?: string): string | null {
  if (!snapshot) return null;
  const match = snapshot.match(/keys=\[([^\]]*)\]/);
  if (match && match[1]) return match[1];
  return null;
}

/** Queue cadence. Suspended while the window is hidden and never overlapping —
 *  see `lib/pollController.ts`. */
const QUEUE_POLL_MS = 1_500;

export default function JobQueue() {
  const { t } = useLocale();

  const fetchJobs = useCallback(() => apiFetch<Job[]>('/jobs?limit=100'), []);
  const queue = useApiResource(fetchJobs, { intervalMs: QUEUE_POLL_MS });
  const jobs = queue.data ?? [];

  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [reprintJob, setReprintJob] = useState<Job | null>(null);
  const [openingJobId, setOpeningJobId] = useState<string | null>(null);
  const [reprintReason, setReprintReason] = useState('');
  const [reprintCopies, setReprintCopies] = useState(1);
  const [duplicateRisk, setDuplicateRisk] = useState(false);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

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
        text: `${t('page.jobQueue.reprintLoadFailed')} ${errorMessage(loadReprintTarget.error)}`,
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
        text: `${t('page.jobQueue.reprintFailed')} ${errorMessage(submitReprint.error)}`,
      });
    }
  };

  const reprintingId = submitReprint.pending ? reprintJob?.id ?? null : null;

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

      {queue.loading && !queue.data ? <LoadingState /> : queue.error != null && !queue.data ? (
        <ErrorState error={queue.error} title={t('page.jobQueue.loadFailed')} onRetry={queue.refresh} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
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
            {jobs.length === 0 && (
              <tr><td colSpan={8}><EmptyState title={t('page.jobQueue.noJobs')} /></td></tr>
            )}
            {jobs.map((j) => {
              const template = j.resolvedTemplateCode ?? j.templateCode;
              const hint = payloadHint(j.payloadSnapshot);
              return (
                <tr key={j.id}>
                  {/* Status badge */}
                  <td>
                    <StatusBadge status={j.status} size="sm" />
                  </td>

                  {/* Document summary — the key column that was missing */}
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <Link to={`/jobs/${j.id}`} style={{ color: '#1e66f5', fontWeight: 600, fontSize: '0.85rem' }}>
                        {template ?? t('common.noData')}
                      </Link>
                      {j.sourceReference && (
                        <span style={{ fontSize: '0.7rem', color: '#666' }}>
                          {t('page.jobQueue.documentNumber')}: {j.sourceReference}
                        </span>
                      )}
                      {hint && (
                        <span style={{ fontSize: '0.65rem', color: '#999', fontFamily: 'monospace' }}>{hint}</span>
                      )}
                      <span style={{ fontSize: '0.6rem', color: '#aaa', fontFamily: 'monospace' }}>{j.id.slice(0, 12)}…</span>
                    </div>
                  </td>

                  {/* Printer */}
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    <Link to={`/printers/${j.printerId}`} style={{ color: 'var(--neutral-deep)', textDecoration: 'none' }}>
                      {j.printerCode ?? j.printerId.slice(0, 8)}
                    </Link>
                  </td>

                  {/* Source system */}
                  <td style={{ color: 'var(--neutral-text-muted)', fontSize: '0.8rem' }}>
                    {j.sourceSystem ?? t('common.noData')}
                  </td>

                  {/* Copies */}
                  <td style={{ fontWeight: 600, textAlign: 'center' }}>{j.copies}</td>

                  {/* Latency */}
                  <td style={{ color: 'var(--neutral-text-muted)', fontSize: '0.8rem' }}>
                    {j.latency?.totalLatencyMs != null ? `${j.latency.totalLatencyMs}ms` : t('common.noData')}
                  </td>

                  {/* Created */}
                  <td style={{ fontSize: '0.75rem', color: '#888' }}>
                    {new Date(j.createdAt).toLocaleString(undefined, {
                      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>

                  {/* Actions */}
                  <td>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void openReprint(j)}
                      busy={openingJobId === j.id || reprintingId === j.id}
                      busyLabel={'…'}
                    >
                      {t('page.jobQueue.reprint')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
              <dd>{reprintJob.runnerId && reprintJob.completedAt ? t('common.yes') : t('page.jobQueue.reprintAckUnknown')}</dd>
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
    </div>
  );
}
