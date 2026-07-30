import { useParams, Link } from 'react-router-dom';
import { useCallback, useEffect } from 'react';
import { apiFetch } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { shouldPollJobDetail, type JobDetailPollingInput } from '../lib/jobDetailPolling.js';
import { ErrorBanner, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { StatusBadge } from '../components/StatusBadge.js';

interface TraceStep {
  stepName: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: string;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
}

interface Trace {
  jobId: string;
  traceId: string;
  status: string;
  steps: TraceStep[];
}

export interface IppObservedJobEvidence {
  key?: string;
  id?: string | number;
  uri?: string;
  name?: string;
  state?: string | number;
  stateName?: string;
  stateReasons?: string[] | string;
  impressionsCompleted?: number;
}

export interface PrintEvidence {
  spoolerJobIds?: string[];
  spoolerStatus?: string;
  pagesBefore?: number;
  pagesAfter?: number;
  deviceConfirmed?: boolean;
  deviceConfirmation?: string;
  ippEndpoint?: string;
  ippExpectedJobName?: string;
  ippJobOutcome?: string;
  ippJobStatus?: string;
  ippJobConfirmed?: boolean;
  ippObservedJobs?: IppObservedJobEvidence[];
}

/**
 * Where this job's terminal result must be delivered. Snapshotted when the job
 * was accepted, so it reflects the configuration as it was THEN — editing the
 * endpoint afterwards does not retroactively change it.
 */
interface CallbackIntent {
  enabled: boolean;
  trigger?: string;
  transports?: string[];
  endpointCode?: string;
  httpUrl?: string;
  natsSubject?: string;
  natsMode?: 'CORE' | 'JETSTREAM';
  disabledReason?: string;
}

/**
 * Whether that delivery actually happened. Deliberately NOT the same thing as
 * the print status: a job can print successfully and fail to report, or fail to
 * print and report that failure perfectly.
 */
interface CallbackDelivery {
  id: string;
  eventId: string;
  printJobId: string;
  requestId?: string;
  transport: 'HTTP' | 'NATS';
  target: string;
  deliveryStatus: 'PENDING' | 'DELIVERING' | 'DELIVERED' | 'RETRY_SCHEDULED' | 'FAILED';
  guarantee?: 'BEST_EFFORT' | 'ACKNOWLEDGED';
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
  lastHttpStatus?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  printStatus: string;
  endpointCode?: string;
}

interface Job {
  id: string;
  status: string;
  copies: number;
  priorityLabel?: string;
  printerId: string;
  printerCode?: string;
  templateCode?: string;
  resolvedTemplateCode?: string;
  paperProfileId?: string;
  routePolicyId?: string;
  sourceSystem?: string;
  sourceReference?: string;
  requestId?: string;
  mimeType?: string;
  duplex?: boolean;
  colorMode?: string;
  errorCode?: string;
  errorMessage?: string;
  payloadSnapshot?: string;
  spoolerSentAt?: string;
  printerAckAt?: string;
  receivedAt?: string;
  finishedAt?: string;
  metadata?: {
    printEvidence?: PrintEvidence;
    code_profile?: string;
    nats?: { clientId?: string; subject?: string; streamSequence?: number };
    isReprintOf?: string;
    callbackIntent?: CallbackIntent;
  };
  templateTiming?: {
    routeResolveMs?: number;
    renderMs?: number;
  };
  latency?: {
    totalLatencyMs?: number;
    validationMs?: number;
    queueWaitMs?: number;
    dispatchMs?: number;
    runnerExecMs?: number;
    spoolerMs?: number;
    printerAckMs?: number;
  };
}

const STEP_COLOR: Record<string, string> = {
  success: '#a6e3a1',
  failed: '#f38ba8',
  running: '#89b4fa',
  skipped: '#9399b2',
};

// The page-local STATUS_COLORS map that used to live here (saturated
// backgrounds + white text) was removed in FE-01.1: it contradicted the WCAG
// contrast audit documented in `statusColors.ts`, and rendered the same status
// in different colours than the queue. Use <StatusBadge /> instead.

function formatStateReasons(reasons: IppObservedJobEvidence['stateReasons'], noData: string): string {
  if (Array.isArray(reasons)) {
    const values = reasons.filter((reason) => reason.trim().length > 0);
    return values.length > 0 ? values.join(', ') : noData;
  }
  return typeof reasons === 'string' && reasons.trim().length > 0 ? reasons : noData;
}

function fmtTime(s?: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/**
 * Delivery-state presentation. Every state carries a text label AND a symbol —
 * never colour alone, which a colour-blind operator (or a printed screenshot in
 * an incident report) cannot read.
 */
const DELIVERY_PRESENTATION: Record<
  CallbackDelivery['deliveryStatus'],
  { color: string; symbol: string }
> = {
  PENDING: { color: '#9399b2', symbol: '•' },
  DELIVERING: { color: '#1e66f5', symbol: '↻' },
  DELIVERED: { color: '#40a02b', symbol: '✓' },
  RETRY_SCHEDULED: { color: '#df8e1d', symbol: '⏱' },
  FAILED: { color: '#d20f39', symbol: '✕' },
};

/**
 * "Result Delivery" panel.
 *
 * Kept visually and textually separate from the job's print status, because the
 * two answer different questions:
 *
 *     Print result:    SUCCESS
 *     Result delivery: FAILED after 5 attempts
 *
 * Reading either one as the other is how an integrator ends up reprinting a
 * label that already came out.
 */
function ResultDelivery({
  intent,
  deliveries,
  printStatus,
  t,
}: {
  intent?: CallbackIntent;
  deliveries: CallbackDelivery[];
  printStatus: string;
  t: (key: string) => string;
}) {
  const configured = intent !== undefined;

  return (
    <section
      aria-labelledby="result-delivery-heading"
      style={{ background: '#fff', borderRadius: '10px', padding: '1.25rem 1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
    >
      <h2
        id="result-delivery-heading"
        style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 1rem 0' }}
      >
        {t('page.jobDetail.resultDelivery')}
      </h2>

      {/* The two statuses, side by side and explicitly labelled. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <Fact label={t('page.jobDetail.printResult')} value={printStatus} />
        <Fact
          label={t('page.jobDetail.deliveryState')}
          value={
            deliveries.length === 0
              ? (configured && intent?.enabled === false
                  ? t('page.jobDetail.callbackDisabled')
                  : t('page.jobDetail.noDelivery'))
              : deliveries
                  .map((d) => `${DELIVERY_PRESENTATION[d.deliveryStatus].symbol} ${d.transport} ${d.deliveryStatus}`)
                  .join(' · ')
          }
        />
      </div>

      {/* Configuration, so "nothing was delivered" always has a stated reason. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
        <Fact
          label={t('page.jobDetail.callbackEnabled')}
          value={!configured ? t('page.jobDetail.callbackNotConfigured') : intent?.enabled ? t('common.yes') : t('common.no')}
        />
        <Fact label={t('page.jobDetail.callbackTrigger')} value={intent?.trigger ?? '—'} />
        <Fact label={t('page.jobDetail.callbackTransport')} value={intent?.transports?.join(' + ') || '—'} />
        <Fact label={t('page.jobDetail.callbackEndpoint')} value={intent?.endpointCode ?? '—'} mono />
      </div>

      {intent?.enabled === false && intent.disabledReason && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#666' }}>
          {t('page.jobDetail.callbackDisabledReason')}: {intent.disabledReason}
        </p>
      )}

      {deliveries.length > 0 && (
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {deliveries.map((d) => {
            const presentation = DELIVERY_PRESENTATION[d.deliveryStatus];
            return (
              <div key={d.id} style={{ border: '1px solid #eee', borderRadius: '6px', padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span
                    style={{ color: presentation.color, fontWeight: 700, fontSize: '0.8rem' }}
                    /* The symbol is decorative; the adjacent text carries the meaning. */
                    aria-hidden="true"
                  >
                    {presentation.symbol}
                  </span>
                  <strong style={{ fontSize: '0.8rem' }}>
                    {d.transport} — {d.deliveryStatus}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: '#666' }}>
                    {t('page.jobDetail.attempts')}: {d.attemptCount}/{d.maxAttempts}
                  </span>
                  {d.guarantee === 'BEST_EFFORT' && (
                    <span
                      title={t('page.jobDetail.bestEffortHelp')}
                      style={{ fontSize: '0.65rem', background: '#fff4e0', color: '#8a5a00', padding: '2px 6px', borderRadius: '3px' }}
                    >
                      {t('page.jobDetail.bestEffort')}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#555', marginTop: '4px', wordBreak: 'break-all' }}>
                  {/* Destination only — never a signing secret. */}
                  {t('page.jobDetail.destination')}: <code>{d.target}</code>
                </div>
                <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.7rem', color: '#888', marginTop: '4px' }}>
                  <span>{t('page.jobDetail.lastAttempt')}: {fmtTime(d.lastAttemptAt)}</span>
                  <span>{t('page.jobDetail.nextRetry')}: {fmtTime(d.nextAttemptAt)}</span>
                  <span>{t('page.jobDetail.deliveredAt')}: {fmtTime(d.deliveredAt)}</span>
                </div>
                <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.65rem', color: '#999', marginTop: '4px' }}>
                  <span>{t('page.jobDetail.eventId')}: <code>{d.eventId}</code></span>
                  {d.requestId && <span>{t('page.jobDetail.requestId')}: <code>{d.requestId}</code></span>}
                </div>
                {d.lastErrorCode && (
                  <div style={{ fontSize: '0.7rem', color: '#d20f39', marginTop: '4px' }}>
                    {d.lastErrorCode}
                    {d.lastHttpStatus ? ` (HTTP ${d.lastHttpStatus})` : ''}
                    {d.lastErrorMessage ? ` — ${d.lastErrorMessage}` : ''}
                  </div>
                )}
              </div>
            );
          })}
          <Link to="/webhooks" style={{ fontSize: '0.72rem', color: '#1e66f5' }}>
            {t('page.jobDetail.viewCallbackLog')} →
          </Link>
        </div>
      )}
    </section>
  );
}

/** Card for a single key-value fact. */
function Fact({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '6px', padding: '0.75rem 1rem',
      border: '1px solid #eee',
    }}>
      <div style={{ fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.875rem', fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

export function PrinterEvidence({
  evidence,
  t,
}: {
  evidence: PrintEvidence;
  t: (key: string) => string;
}) {
  const noData = t('common.noData');
  const ippJobs = evidence.ippObservedJobs ?? [];
  const ippConfirmed = evidence.ippJobConfirmed === true || evidence.ippJobOutcome === 'confirmed';
  const outcome = evidence.ippJobOutcome ?? (ippConfirmed ? 'confirmed' : noData);
  const confirmationChannel = evidence.deviceConfirmation === 'ipp-job'
    ? `${t('page.jobDetail.ippJob')} (ipp-job)`
    : evidence.deviceConfirmation ?? noData;

  return (
    <section className="print-evidence" aria-labelledby="print-evidence-heading">
      <div className="print-evidence__header">
        <h2 id="print-evidence-heading">{t('page.jobDetail.printerEvidence')}</h2>
        <span className={`print-evidence__outcome ${ippConfirmed ? 'print-evidence__outcome--confirmed' : ''}`}>
          {outcome}
        </span>
      </div>

      <dl className="print-evidence__facts">
        <div className="print-evidence__fact">
          <dt>{t('page.jobDetail.confirmationChannel')}</dt>
          <dd>{confirmationChannel}</dd>
        </div>
        <div className="print-evidence__fact">
          <dt>{t('page.jobDetail.ippEndpoint')}</dt>
          <dd><code>{evidence.ippEndpoint ?? noData}</code></dd>
        </div>
        <div className="print-evidence__fact">
          <dt>{t('page.jobDetail.ippExpectedJobName')}</dt>
          <dd><code>{evidence.ippExpectedJobName ?? noData}</code></dd>
        </div>
        <div className="print-evidence__fact">
          <dt>{t('page.jobDetail.windowsJobIds')}</dt>
          <dd><code>{evidence.spoolerJobIds?.join(', ') || noData}</code></dd>
        </div>
        <div className="print-evidence__fact">
          <dt>{t('page.jobDetail.spoolerStatus')}</dt>
          <dd>{evidence.spoolerStatus ?? noData}</dd>
        </div>
        <div className="print-evidence__fact">
          <dt>{t('page.jobDetail.deviceCounter')}</dt>
          <dd>{evidence.pagesBefore ?? '—'} → {evidence.pagesAfter ?? '—'}</dd>
        </div>
        <div className="print-evidence__fact print-evidence__fact--wide">
          <dt>{t('page.jobDetail.ippStatus')}</dt>
          <dd>{evidence.ippJobStatus ?? noData}</dd>
        </div>
      </dl>

      <div className="print-evidence__jobs-heading">
        {t('page.jobDetail.ippJobs')} <span>({ippJobs.length})</span>
      </div>
      {ippJobs.length > 0 ? (
        <div className="print-evidence__table-wrap">
          <table className="print-evidence__table">
            <thead>
              <tr>
                <th scope="col">{t('page.jobDetail.ippJobId')}</th>
                <th scope="col">{t('page.jobDetail.ippJobUri')}</th>
                <th scope="col">{t('page.jobDetail.ippState')}</th>
                <th scope="col">{t('page.jobDetail.ippReasons')}</th>
                <th scope="col">{t('page.jobDetail.impressionsCompleted')}</th>
              </tr>
            </thead>
            <tbody>
              {ippJobs.map((ippJob, index) => (
                <tr key={`${ippJob.key ?? ippJob.uri ?? ippJob.id ?? 'ipp-job'}-${index}`}>
                  <td><code>{ippJob.id != null ? `#${ippJob.id}` : noData}</code></td>
                  <td><code>{ippJob.uri ?? noData}</code></td>
                  <td>{ippJob.stateName ?? (ippJob.state != null ? String(ippJob.state) : noData)}</td>
                  <td>{formatStateReasons(ippJob.stateReasons, noData)}</td>
                  <td>{ippJob.impressionsCompleted ?? noData}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="print-evidence__empty">{t('page.jobDetail.noIppJobs')}</p>
      )}
    </section>
  );
}

/** Live view of one job. 1s cadence, but only while the window is visible,
 *  never with two requests of the same kind open at once, and only while the
 *  job can still change — see `lib/pollController.ts` and
 *  `lib/jobDetailPolling.ts`. */
const JOB_POLL_MS = 1_000;

/**
 * Maps what this page has on screen onto the polling policy's input.
 *
 * Exported so the mapping itself is covered: the policy is only correct if it is
 * fed the right facts, and `transports` (what the job intended to notify) is a
 * different thing from `deliveries` (what actually happened).
 *
 * A `job` that has not loaded yields no print status, which the policy reads as
 * "still live" — an unknown job is never treated as finished.
 */
export function jobDetailPollingInput(
  job: Pick<Job, 'status' | 'metadata'> | null,
  deliveries: Pick<CallbackDelivery, 'deliveryStatus'>[],
): JobDetailPollingInput {
  const callbackIntent = job?.metadata?.callbackIntent;
  return {
    printStatus: job?.status,
    callbackEnabled: callbackIntent?.enabled,
    expectedDeliveryCount: callbackIntent?.transports?.length ?? 0,
    deliveryStatuses: deliveries.map((delivery) => delivery.deliveryStatus),
  };
}

export default function JobDetail() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();

  const fetchJob = useCallback(() => apiFetch<Job>(`/jobs/${id}`), [id]);
  // A job with no trace yet answers 404. That is a fact about the job, not a
  // transport failure, so it resolves to `null` instead of becoming an error —
  // otherwise every young job would show "could not load the trace".
  const fetchTrace = useCallback(
    async (): Promise<Trace | null> => {
      try {
        return await apiFetch<Trace>(`/jobs/${id}/trace`);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    [id],
  );
  // Server-side filter, so this stays one job's deliveries rather than
  // downloading the whole callback log to find them.
  const fetchDeliveries = useCallback(
    () => apiFetch<CallbackDelivery[]>(`/v1/callback-deliveries?printJobId=${encodeURIComponent(id ?? '')}`),
    [id],
  );

  const jobResource = useApiResource(fetchJob, { intervalMs: JOB_POLL_MS, enabled: Boolean(id) });
  const traceResource = useApiResource(fetchTrace, { intervalMs: JOB_POLL_MS, enabled: Boolean(id) });
  const deliveriesResource = useApiResource(fetchDeliveries, { intervalMs: JOB_POLL_MS, enabled: Boolean(id) });

  const job = jobResource.data ?? null;
  const trace = traceResource.data ?? null;
  const deliveries = deliveriesResource.data ?? [];

  // Three endpoints at 1s each ran forever on a job that could no longer
  // change — a finished job left open on a screen was ~180 requests/minute of
  // pure noise. Polling now follows the job's own lifecycle: it continues while
  // the print is live, and while a callback is still pending, delivering or
  // retry-scheduled, and stops once every expected delivery is terminal (or
  // callbacks were disabled for this job).
  //
  // Stopping is not resetting: `setPollingEnabled(false)` leaves the retained
  // job, trace and delivery data on screen and keeps manual refresh working.
  const automaticPollingNeeded = shouldPollJobDetail(jobDetailPollingInput(job, deliveries));
  // Presentation counterpart of the same decision. `job !== null` keeps a page
  // that has not loaded yet from claiming a final state — an unloaded job has no
  // status, which the policy already reads as "still live".
  const monitoringComplete = job !== null && automaticPollingNeeded === false;

  // Deps are the boolean and the three stable setters — never the resource
  // objects, which are new on every snapshot. A route change to another job id
  // rebuilds the resources with a fresh generation, and the new controller's
  // first snapshot has no data yet, so this re-evaluates from scratch.
  useEffect(() => {
    jobResource.setPollingEnabled(automaticPollingNeeded);
    traceResource.setPollingEnabled(automaticPollingNeeded);
    deliveriesResource.setPollingEnabled(automaticPollingNeeded);
  }, [
    automaticPollingNeeded,
    jobResource.setPollingEnabled,
    traceResource.setPollingEnabled,
    deliveriesResource.setPollingEnabled,
  ]);

  // Depends on the `refresh` functions, not the resource objects: those are new
  // on every 1s snapshot, so an effect keyed on them would re-run continuously.
  const refreshAll = useCallback(() => {
    jobResource.refresh();
    traceResource.refresh();
    deliveriesResource.refresh();
  }, [jobResource.refresh, traceResource.refresh, deliveriesResource.refresh]);

  // First load still running: a spinner is honest here.
  if (!job && jobResource.loading) {
    return (
      <div>
        <h1 className="page-title">{t('page.jobDetail.title')}</h1>
        <LoadingState />
      </div>
    );
  }

  // First load FAILED: previously this fell through to the same spinner and the
  // page span forever, with the reason discarded by `catch(() => {})`.
  if (!job) {
    return (
      <div>
        <h1 className="page-title">{t('page.jobDetail.title')}</h1>
        <ErrorState
          error={jobResource.error ?? new Error(t('page.jobDetail.notFound'))}
          title={t('page.jobDetail.loadFailed')}
          onRetry={refreshAll}
        />
      </div>
    );
  }

  const template = job.resolvedTemplateCode ?? job.templateCode;
  const isReprint = Boolean(job.metadata?.isReprintOf);
  const natsInfo = job.metadata?.nats;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ── Header: title + status + ID ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.jobDetail.title')}</h1>
        <StatusBadge status={job.status} size="lg" />
        {isReprint && (
          <span style={{
            background: '#f0f0f0', color: '#666', padding: '4px 10px',
            borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600,
          }}>
            ↻ REPRINT
          </span>
        )}
        <code style={{ fontSize: '0.7rem', color: '#999' }}>{job.id}</code>
        <Freshness
          lastSuccessAt={jobResource.lastSuccessAt}
          stale={jobResource.stale}
          refreshing={jobResource.refreshing}
          paused={jobResource.paused}
          monitoringComplete={monitoringComplete}
          onRefresh={refreshAll}
        />
      </div>

      {/* Refresh failed while the job is already on screen: the panels below
          are a snapshot, not the live state. Say so instead of letting the
          page look current. */}
      {jobResource.stale && jobResource.error != null && (
        <ErrorBanner
          error={jobResource.error}
          title={t('error.refresh.title')}
          onRetry={refreshAll}
        />
      )}

      {/* ── Error banner ── */}
      {job.errorCode && (
        <div style={{
          background: '#fee2e2', border: '1px solid #f38ba8', borderRadius: '8px',
          padding: '0.75rem 1rem', color: '#991b1b',
        }}>
          <strong>⚠ {job.errorCode}</strong>
          {job.errorMessage && <span style={{ marginLeft: '0.5rem' }}>— {job.errorMessage}</span>}
        </div>
      )}

      {/* ── Document summary card — the "what was printed" panel ── */}
      <section style={{
        background: '#fff', borderRadius: '10px', padding: '1.25rem 1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        <h2 style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 1rem 0' }}>
          {t('page.jobDetail.documentInfo')}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
          <Fact label={t('page.jobDetail.template')} value={template ?? '—'} mono />
          <Fact label={t('page.jobDetail.sourceReference')} value={job.sourceReference ?? '—'} mono />
          <Fact label={t('page.jobDetail.sourceSystem')} value={job.sourceSystem ?? '—'} />
          <Fact label={t('page.jobDetail.copies')} value={job.copies} />
          {job.metadata?.code_profile && (
            <Fact label={t('page.jobDetail.paperProfile')} value={job.metadata.code_profile} mono />
          )}
          <Fact label={t('page.jobDetail.mimeType')} value={job.mimeType ?? '—'} />
          <Fact
            label={t('page.jobDetail.printer')}
            value={
              <Link to={`/printers/${job.printerId}`} style={{ color: '#1e66f5', textDecoration: 'none' }}>
                {job.printerCode ?? job.printerId.slice(0, 8)}
              </Link>
            }
          />
          <Fact label={t('page.jobDetail.priority')} value={job.priorityLabel ?? '—'} />
          {job.requestId && <Fact label={t('page.jobDetail.requestId')} value={job.requestId} mono />}
        </div>

        {/* Payload snapshot — shows what data fields were in the print payload */}
        {job.payloadSnapshot && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#666' }}>
            <span style={{ fontWeight: 600 }}>{t('page.jobDetail.payloadFields')}:</span>{' '}
            <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>
              {job.payloadSnapshot}
            </code>
          </div>
        )}

        {/* NATS provenance */}
        {natsInfo && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#8839ef' }}>
            ↦ NATS: client={natsInfo.clientId ?? '—'} · subject={natsInfo.subject ?? '—'} · seq={natsInfo.streamSequence ?? '—'}
          </div>
        )}

        {/* Reprint provenance */}
        {isReprint && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#666' }}>
            ↻ {t('page.jobDetail.reprintOf')}{' '}
            <Link to={`/jobs/${job.metadata!.isReprintOf}`} style={{ color: '#1e66f5' }}>
              {job.metadata!.isReprintOf!.slice(0, 12)}…
            </Link>
          </div>
        )}
      </section>

      {/* ── Timing & Latency ── */}
      <section style={{
        background: '#fff', borderRadius: '10px', padding: '1.25rem 1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        <h2 style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 1rem 0' }}>
          {t('page.jobDetail.timing')}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
          <Fact label={t('page.jobDetail.totalLatency')} value={job.latency?.totalLatencyMs != null ? `${job.latency.totalLatencyMs}ms` : '—'} />
          <Fact label={t('page.jobDetail.queueWait')} value={job.latency?.queueWaitMs != null ? `${job.latency.queueWaitMs}ms` : '—'} />
          <Fact label={t('page.jobDetail.dispatch')} value={job.latency?.dispatchMs != null ? `${job.latency.dispatchMs}ms` : '—'} />
          <Fact label={t('page.jobDetail.runnerExec')} value={job.latency?.runnerExecMs != null ? `${job.latency.runnerExecMs}ms` : '—'} />
          <Fact label={t('page.jobDetail.spoolerMs')} value={job.latency?.spoolerMs != null ? `${job.latency.spoolerMs}ms` : '—'} />
          <Fact label={t('page.jobDetail.printerAckMs')} value={job.latency?.printerAckMs != null ? `${job.latency.printerAckMs}ms` : '—'} />
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', fontSize: '0.75rem', color: '#888' }}>
          <span>{t('page.jobDetail.received')}: {fmtTime(job.receivedAt)}</span>
          <span>{t('page.jobDetail.spooled')}: {fmtTime(job.spoolerSentAt)}</span>
          <span>{t('page.jobDetail.printerAck')}: {fmtTime(job.printerAckAt)}</span>
          <span>{t('page.jobDetail.finished')}: {fmtTime(job.finishedAt)}</span>
        </div>
      </section>

      {/* Never let a failed deliveries fetch render as "no delivery": an
          operator reading that would conclude the callback never fired. */}
      {deliveriesResource.error != null && deliveriesResource.data === undefined && (
        <ErrorBanner
          error={deliveriesResource.error}
          title={t('page.jobDetail.deliveryLoadFailed')}
          onRetry={deliveriesResource.refresh}
        />
      )}

      {/* ── Result delivery — the callback side, kept apart from print status ── */}
      <ResultDelivery
        intent={job.metadata?.callbackIntent}
        deliveries={deliveries}
        printStatus={job.status}
        t={t}
      />

      {/* ── Print evidence (if any) ── */}
      {job.metadata?.printEvidence && (
        <PrinterEvidence evidence={job.metadata.printEvidence} t={t} />
      )}

      {/* ── Trace timeline ── */}
      {trace && (
        <section>
          <h2 style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 1rem 0' }}>
            {t('page.jobDetail.traceTimeline')}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {trace.steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: STEP_COLOR[step.status] ?? '#ccc',
                  marginTop: '6px', flexShrink: 0,
                }} />
                <div style={{
                  background: '#fff', padding: '0.6rem 1rem', borderRadius: '6px',
                  flex: 1, border: '1px solid #eee',
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{step.stepName}</div>
                  <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '2px' }}>
                    {step.durationMs != null ? `${step.durationMs}ms` : '—'} · {step.status}
                  </div>
                  {step.outputSummary && <div style={{ fontSize: '0.7rem', marginTop: '4px', color: '#555' }}>{step.outputSummary}</div>}
                  {step.error && <div style={{ fontSize: '0.7rem', color: '#f38ba8', marginTop: '4px' }}>{step.error}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* "No trace recorded" and "the trace could not be loaded" are different
          facts — the first is evidence about the job, the second is evidence
          about the network. They used to render identically. */}
      {!trace && traceResource.error == null && (
        <p style={{ color: '#888' }}>{t('page.jobDetail.noTrace')}</p>
      )}
      {!trace && traceResource.error != null && (
        <ErrorBanner
          error={traceResource.error}
          title={t('page.jobDetail.traceLoadFailed')}
          onRetry={traceResource.refresh}
        />
      )}
    </div>
  );
}
