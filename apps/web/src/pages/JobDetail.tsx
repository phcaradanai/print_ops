import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { useHasPermission } from '../api/session.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { shouldPollJobDetail, type JobDetailPollingInput } from '../lib/jobDetailPolling.js';
import {
  getJobVerdict,
  offersReprint,
  reprintButtonVariant,
  verdictDetailKey,
  verdictHeadlineKey,
  type JobVerdict,
} from '../lib/jobVerdict.js';
import { getErrorAdvice } from '../lib/jobErrorAdvice.js';
import { JobVerdictBand } from '../components/JobVerdict.js';
import { ReprintDialog } from '../components/ReprintDialog.js';
import {
  Alert,
  Badge,
  Button,
  DataCell,
  DataHead,
  DataTable,
  ErrorBanner,
  ErrorState,
  CardDetailItem,
  CardDetail,
  Freshness,
  Grid,
  Inline,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  RecordCard,
  RecordList,
  RecordHeader,
  Stack,
  StatusBadge,
  Text,
  Card,
  type BadgeTone,
} from '../components/ui/index.js';

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
 * SUCCESS is an application report, not device proof. Keep the prominent
 * sentence honest when the runner did not persist either confirmation signal.
 */
export function verdictCopyKeys(verdict: JobVerdict, evidence?: PrintEvidence) {
  const printerConfirmed = evidence?.deviceConfirmed === true || evidence?.ippJobConfirmed === true;
  if (verdict.copyKey === 'printed' && !printerConfirmed) {
    return {
      headline: 'page.jobDetail.verdict.reportedComplete.headline',
      detail: 'page.jobDetail.verdict.reportedComplete.detail',
    };
  }

  return {
    headline: verdictHeadlineKey(verdict),
    detail: verdictDetailKey(verdict),
  };
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
  /** Needed by the reprint safety gate — the server refuses without it. */
  runnerId?: string;
  completedAt?: string;
  metadata?: {
    printEvidence?: PrintEvidence;
    code_profile?: string;
    nats?: { clientId?: string; subject?: string; streamSequence?: number };
    /**
     * Written by `ReprintJobService` when this job was created as a reprint.
     *
     * This page previously read `metadata.isReprintOf`, a key nothing in the
     * repository has ever written — so `isReprint` was permanently false and
     * both the REPRINT chip and the "Reprint of" link were unreachable, along
     * with the `page.jobDetail.reprintOf` string in both languages.
     */
    reprintOfJobId?: string;
    reprintOfRequestId?: string;
    reprintReason?: string;
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

const STEP_TONE: Record<string, string> = {
  success: 'success',
  failed: 'failed',
  running: 'running',
  skipped: 'skipped',
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
 * Delivery state as a shared badge tone.
 *
 * This was a map of tone names to Unicode glyphs — `•`, `↻`, `✓`, `⏱`, `✕` —
 * rendered `aria-hidden` beside the label. The glyphs were never an icon system:
 * they render at different weights and baselines per platform and carried no
 * meaning the adjacent text did not already carry. The badge keeps the two
 * channels the rule actually requires: a literal label plus a contrast-safe tone.
 */
const DELIVERY_TONE: Record<CallbackDelivery['deliveryStatus'], BadgeTone> = {
  PENDING: 'neutral',
  DELIVERING: 'info',
  DELIVERED: 'success',
  RETRY_SCHEDULED: 'warning',
  FAILED: 'danger',
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
    <Panel title={t('page.jobDetail.resultDelivery')}>
      <Stack gap="lg">
        {/* The two statuses, side by side and explicitly labelled. */}
        <CardDetail>
          <CardDetailItem label={t('page.jobDetail.printResult')}>{printStatus}</CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.deliveryState')}>
            {deliveries.length === 0
              ? (configured && intent?.enabled === false
                  ? t('page.jobDetail.callbackDisabled')
                  : t('page.jobDetail.noDelivery'))
              : (
                <Inline gap="xs">
                  {deliveries.map((d) => (
                    <Badge key={d.id} tone={DELIVERY_TONE[d.deliveryStatus]}>
                      {d.transport} {d.deliveryStatus}
                    </Badge>
                  ))}
                </Inline>
              )}
          </CardDetailItem>
        </CardDetail>

        {/* Configuration, so "nothing was delivered" always has a stated reason. */}
        <CardDetail>
          <CardDetailItem label={t('page.jobDetail.callbackEnabled')}>
            {!configured ? t('page.jobDetail.callbackNotConfigured') : intent?.enabled ? t('status.enabled') : t('status.disabled')}
          </CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.callbackTrigger')}>{intent?.trigger ?? '—'}</CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.callbackTransport')}>{intent?.transports?.join(' + ') || '—'}</CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.callbackEndpoint')}>
            <Mono>{intent?.endpointCode ?? '—'}</Mono>
          </CardDetailItem>
        </CardDetail>

        {intent?.enabled === false && intent.disabledReason && (
          <Text as="p" tone="muted">
            {t('page.jobDetail.callbackDisabledReason')}: {intent.disabledReason}
          </Text>
        )}

        {deliveries.length > 0 && (
          <Stack gap="md">
            <RecordList>
              {deliveries.map((d) => (
                <RecordCard key={d.id}>
                  <Stack gap="md">
                    <RecordHeader>
                      <Inline gap="sm">
                        <Badge tone={DELIVERY_TONE[d.deliveryStatus]}>
                          {d.transport} — {d.deliveryStatus}
                        </Badge>
                        {d.guarantee === 'BEST_EFFORT' && (
                          <Badge tone="warning" title={t('page.jobDetail.bestEffortHelp')}>
                            {t('page.jobDetail.bestEffort')}
                          </Badge>
                        )}
                      </Inline>
                      <Text size="label" tone="muted" nowrap>
                        {t('page.jobDetail.attempts')}: {d.attemptCount}/{d.maxAttempts}
                      </Text>
                    </RecordHeader>

                    <CardDetail>
                      {/* Destination only — never a signing secret. */}
                      <CardDetailItem label={t('page.jobDetail.destination')}>
                        <Mono>{d.target}</Mono>
                      </CardDetailItem>
                      <CardDetailItem label={t('page.jobDetail.eventId')}>
                        <Mono>{d.eventId}</Mono>
                      </CardDetailItem>
                      <CardDetailItem label={t('page.jobDetail.lastAttempt')}>{fmtTime(d.lastAttemptAt)}</CardDetailItem>
                      <CardDetailItem label={t('page.jobDetail.nextRetry')}>{fmtTime(d.nextAttemptAt)}</CardDetailItem>
                      <CardDetailItem label={t('page.jobDetail.deliveredAt')}>{fmtTime(d.deliveredAt)}</CardDetailItem>
                      {d.requestId && (
                        <CardDetailItem label={t('page.jobDetail.requestId')}>
                          <Mono>{d.requestId}</Mono>
                        </CardDetailItem>
                      )}
                    </CardDetail>

                    {d.lastErrorCode && (
                      <Alert tone="error">
                        {d.lastErrorCode}
                        {d.lastHttpStatus ? ` (HTTP ${d.lastHttpStatus})` : ''}
                        {d.lastErrorMessage ? ` — ${d.lastErrorMessage}` : ''}
                      </Alert>
                    )}
                  </Stack>
                </RecordCard>
              ))}
            </RecordList>
            <Link className="ui-link" to="/webhooks">
              {t('page.jobDetail.viewCallbackLog')} →
            </Link>
          </Stack>
        )}
      </Stack>
    </Panel>
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

  const columns = {
    id: t('page.jobDetail.ippJobId'),
    uri: t('page.jobDetail.ippJobUri'),
    state: t('page.jobDetail.ippState'),
    reasons: t('page.jobDetail.ippReasons'),
    impressions: t('page.jobDetail.impressionsCompleted'),
  };

  return (
    <Panel
      title={t('page.jobDetail.printerEvidence')}
      actions={<Badge tone={ippConfirmed ? 'success' : 'neutral'}>{outcome}</Badge>}
    >
      <Stack gap="lg">
        <CardDetail>
          <CardDetailItem label={t('page.jobDetail.confirmationChannel')}>{confirmationChannel}</CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.ippEndpoint')}>
            <Mono>{evidence.ippEndpoint ?? noData}</Mono>
          </CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.ippExpectedJobName')}>
            <Mono>{evidence.ippExpectedJobName ?? noData}</Mono>
          </CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.windowsJobIds')}>
            <Mono>{evidence.spoolerJobIds?.join(', ') || noData}</Mono>
          </CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.spoolerStatus')}>{evidence.spoolerStatus ?? noData}</CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.deviceCounter')}>
            <Mono>{evidence.pagesBefore ?? '—'} → {evidence.pagesAfter ?? '—'}</Mono>
          </CardDetailItem>
          <CardDetailItem label={t('page.jobDetail.ippStatus')}>{evidence.ippJobStatus ?? noData}</CardDetailItem>
        </CardDetail>

        <Stack gap="sm">
          <Inline gap="xs">
            <Text size="label" tone="muted">{t('page.jobDetail.ippJobs')}</Text>
            <Text size="label" tone="muted">({ippJobs.length})</Text>
          </Inline>
          {ippJobs.length > 0 ? (
            <DataTable label={t('page.jobDetail.ippJobs')} responsive>
              <thead>
                <tr>
                  <DataHead>{columns.id}</DataHead>
                  <DataHead>{columns.uri}</DataHead>
                  <DataHead>{columns.state}</DataHead>
                  <DataHead>{columns.reasons}</DataHead>
                  <DataHead>{columns.impressions}</DataHead>
                </tr>
              </thead>
              <tbody>
                {ippJobs.map((ippJob, index) => (
                  <tr key={`${ippJob.key ?? ippJob.uri ?? ippJob.id ?? 'ipp-job'}-${index}`}>
                    <DataCell label={columns.id}>
                      <Mono weight="semibold">{ippJob.id != null ? `#${ippJob.id}` : noData}</Mono>
                    </DataCell>
                    <DataCell label={columns.uri}>
                      <Mono tone="muted">{ippJob.uri ?? noData}</Mono>
                    </DataCell>
                    <DataCell label={columns.state}>
                      {ippJob.stateName ?? (ippJob.state != null ? String(ippJob.state) : noData)}
                    </DataCell>
                    <DataCell label={columns.reasons}>
                      {formatStateReasons(ippJob.stateReasons, noData)}
                    </DataCell>
                    <DataCell label={columns.impressions}>
                      <Mono>{ippJob.impressionsCompleted ?? noData}</Mono>
                    </DataCell>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <Text as="p" tone="muted">{t('page.jobDetail.noIppJobs')}</Text>
          )}
        </Stack>
      </Stack>
    </Panel>
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
  const [searchParams] = useSearchParams();
  const debugMode = searchParams.get('debug') === 'true';

  // VIEWER holds job:read but not job:retry. Offering an action the server will
  // refuse is worse than not offering it — say why instead.
  const mayReprint = useHasPermission('job:retry');

  const [reprintOpen, setReprintOpen] = useState(false);
  const [copiedDebug, setCopiedDebug] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

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

  const handleCopyDebugJson = useCallback(() => {
    if (!job) return;
    const debugData = {
      id: job.id,
      status: job.status,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      printerId: job.printerId,
      printerCode: job.printerCode,
      copies: job.copies,
      latency: job.latency,
      metadata: job.metadata,
      trace,
      timestamps: {
        receivedAt: job.receivedAt,
        spoolerSentAt: job.spoolerSentAt,
        printerAckAt: job.printerAckAt,
        finishedAt: job.finishedAt,
      },
    };
    void navigator.clipboard.writeText(JSON.stringify(debugData, null, 2));
    setCopiedDebug(true);
    setTimeout(() => setCopiedDebug(false), 2500);
  }, [job, trace]);

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
      <PageLayout title={t('page.jobDetail.title')}>
        <LoadingState />
      </PageLayout>
    );
  }

  // First load FAILED: previously this fell through to the same spinner and the
  // page span forever, with the reason discarded by `catch(() => {})`.
  if (!job) {
    return (
      <PageLayout title={t('page.jobDetail.title')}>
        <ErrorState
          error={jobResource.error ?? new Error(t('page.jobDetail.notFound'))}
          title={t('page.jobDetail.loadFailed')}
          onRetry={refreshAll}
        />
      </PageLayout>
    );
  }

  const template = job.resolvedTemplateCode ?? job.templateCode;
  const reprintOfJobId = job.metadata?.reprintOfJobId;
  const natsInfo = job.metadata?.nats;
  const verdict = getJobVerdict(job.status);
  const verdictCopy = verdictCopyKeys(verdict, job.metadata?.printEvidence);
  // The server refuses a reprint without both. Surface that here rather than
  // letting the operator write a reason into a form that cannot submit.
  const identityComplete = Boolean(job.requestId) && Boolean(job.runnerId);
  const errorAdvice = job.errorCode ? getErrorAdvice(job.errorCode) : null;

  return (
    <PageLayout
      className="job-detail"
      title={t('page.jobDetail.title')}
      density="compact"
      actions={<>
        <Mono tone="muted" truncate title={job.id}>{job.id}</Mono>
        <Freshness
          lastSuccessAt={jobResource.lastSuccessAt}
          stale={jobResource.stale}
          refreshing={jobResource.refreshing}
          paused={jobResource.paused}
          monitoringComplete={monitoringComplete}
          onRefresh={refreshAll}
        />
      </>}
    >

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

      {notice && (
        <Alert
          tone={notice.tone === 'ok' ? 'success' : 'error'}
          onDismiss={() => setNotice(null)}
          dismissLabel={t('common.close')}
        >
          {notice.text}
        </Alert>
      )}

      <Stack gap="xl">
        {/* ── Tier 0: the verdict, and the decision that follows from it ── */}
        <JobVerdictBand
          verdict={verdict}
          headline={t(verdictCopy.headline)}
          detail={t(verdictCopy.detail)}
          badge={<StatusBadge status={job.status} size="lg" />}
          note={
            reprintOfJobId ? (
              <Text as="p" tone="muted">
                {t('page.jobDetail.reprintOf')}{' '}
                <Link className="ui-link" to={`/jobs/${reprintOfJobId}`}>{reprintOfJobId.slice(0, 12)}…</Link>
                {job.metadata?.reprintReason && <>{' — '}{job.metadata.reprintReason}</>}
              </Text>
            ) : undefined
          }
          actions={
            offersReprint(verdict) ? (
              mayReprint ? (
                identityComplete ? (
                  <Button
                    variant={reprintButtonVariant(verdict)}
                    onClick={() => setReprintOpen(true)}
                  >
                    {reprintOfJobId ? t('page.jobDetail.reprintAgain') : t('page.jobDetail.reprint')}
                  </Button>
                ) : (
                  <Text as="p" size="label" tone="muted">{t('page.jobDetail.reprintBlockedIdentity')}</Text>
                )
              ) : (
                <Text as="p" size="label" tone="muted">{t('page.jobDetail.reprintNotPermitted')}</Text>
              )
            ) : job.status === 'DUPLICATE_RETURNED' && job.requestId ? (
              <Link className="ui-link" to={`/jobs?search=${encodeURIComponent(job.requestId)}`}>
                {t('page.jobDetail.reprintOpenOriginal')} →
              </Link>
            ) : undefined
          }
        />

        {/* The failure's own words + operator physical troubleshooting advice */}
        {job.errorCode && (
          <Alert
            tone="error"
            title={errorAdvice ? `${job.errorCode} — ${t(errorAdvice.titleKey)}` : job.errorCode}
            footer={
              errorAdvice ? (
                <Stack gap="xs">
                  <Text size="label" weight="semibold">{t('page.jobDetail.operatorActionTitle')}</Text>
                  <Text>{t(errorAdvice.actionStepKey)}</Text>
                </Stack>
              ) : undefined
            }
          >
            {job.errorMessage}
          </Alert>
        )}

        {/* ── Tier 0b: what was printed ── */}
        <Panel title={t('page.jobDetail.documentInfo')}>
          <CardDetail>
            <CardDetailItem label={t('page.jobDetail.template')}><Mono wrap>{template ?? '—'}</Mono></CardDetailItem>
            <CardDetailItem label={t('page.jobDetail.sourceReference')}><Mono wrap>{job.sourceReference ?? '—'}</Mono></CardDetailItem>
            <CardDetailItem label={t('page.jobDetail.sourceSystem')}>{job.sourceSystem ?? '—'}</CardDetailItem>
            <CardDetailItem label={t('page.jobDetail.copies')}>{job.copies}</CardDetailItem>
            {job.metadata?.code_profile && (
              <CardDetailItem label={t('page.jobDetail.paperProfile')}>
                <Mono wrap>{job.metadata.code_profile}</Mono>
              </CardDetailItem>
            )}
            <CardDetailItem label={t('page.jobDetail.printer')}>
              <Link className="ui-link" to={`/printers/${job.printerId}`}>
                {job.printerCode ?? job.printerId.slice(0, 8)}
              </Link>
            </CardDetailItem>
            <CardDetailItem label={t('page.jobDetail.priority')}>{job.priorityLabel ?? '—'}</CardDetailItem>
            <CardDetailItem label={t('page.jobDetail.finished')}>{fmtTime(job.finishedAt)}</CardDetailItem>
          </CardDetail>
        </Panel>

        {/* Never let a failed deliveries fetch render as "no delivery": an
            operator reading that would conclude the callback never fired. */}
        {deliveriesResource.error != null && deliveriesResource.data === undefined && (
          <ErrorBanner
            error={deliveriesResource.error}
            title={t('page.jobDetail.deliveryLoadFailed')}
            onRetry={deliveriesResource.refresh}
          />
        )}

        {/* ── Tier 1: why the verdict says what it says ── */}
        <Grid columns={job.metadata?.printEvidence ? 2 : 1}>
          {job.metadata?.printEvidence && (
            <PrinterEvidence evidence={job.metadata.printEvidence} t={t} />
          )}
          <ResultDelivery
            intent={job.metadata?.callbackIntent}
            deliveries={deliveries}
            printStatus={job.status}
            t={t}
          />
        </Grid>

        {/* ── Tier 2: forensics. Present, findable, no longer competing. ── */}
        <details className="job-technical" open={debugMode ? true : undefined}>
          <summary className="job-technical__summary">
            <span>{t('page.jobDetail.technicalDetail')}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCopyDebugJson();
              }}
            >
              {copiedDebug ? t('page.jobDetail.debugCopied') : t('page.jobDetail.copyDebugJson')}
            </Button>
          </summary>

          <Stack gap="xl" className="job-technical__body">
            <Panel title={t('page.jobDetail.timing')} tone="subtle">
              <Stack gap="lg">
                <CardDetail>
                  <CardDetailItem label={t('page.jobDetail.totalLatency')}>{job.latency?.totalLatencyMs != null ? `${job.latency.totalLatencyMs}ms` : '—'}</CardDetailItem>
                  <CardDetailItem label={t('page.jobDetail.queueWait')}>{job.latency?.queueWaitMs != null ? `${job.latency.queueWaitMs}ms` : '—'}</CardDetailItem>
                  <CardDetailItem label={t('page.jobDetail.dispatch')}>{job.latency?.dispatchMs != null ? `${job.latency.dispatchMs}ms` : '—'}</CardDetailItem>
                  <CardDetailItem label={t('page.jobDetail.runnerExec')}>{job.latency?.runnerExecMs != null ? `${job.latency.runnerExecMs}ms` : '—'}</CardDetailItem>
                  <CardDetailItem label={t('page.jobDetail.spoolerMs')}>{job.latency?.spoolerMs != null ? `${job.latency.spoolerMs}ms` : '—'}</CardDetailItem>
                  <CardDetailItem label={t('page.jobDetail.printerAckMs')}>{job.latency?.printerAckMs != null ? `${job.latency.printerAckMs}ms` : '—'}</CardDetailItem>
                </CardDetail>
                <CardDetail>
                  <CardDetailItem label={t('page.jobDetail.received')}>{fmtTime(job.receivedAt)}</CardDetailItem>
                  <CardDetailItem label={t('page.jobDetail.spooled')}>{fmtTime(job.spoolerSentAt)}</CardDetailItem>
                  <CardDetailItem label={t('page.jobDetail.printerAck')}>{fmtTime(job.printerAckAt)}</CardDetailItem>
                  <CardDetailItem label={t('page.jobDetail.finished')}>{fmtTime(job.finishedAt)}</CardDetailItem>
                </CardDetail>
              </Stack>
            </Panel>

            <Panel title={t('page.jobDetail.provenance')} tone="subtle">
              <Stack gap="lg">
                <CardDetail>
                  {job.requestId && (
                    <CardDetailItem label={t('page.jobDetail.requestId')}><Mono wrap>{job.requestId}</Mono></CardDetailItem>
                  )}
                  {job.metadata?.reprintOfRequestId && (
                    <CardDetailItem label={t('page.jobDetail.originalRequestId')}>
                      <Mono wrap>{job.metadata.reprintOfRequestId}</Mono>
                    </CardDetailItem>
                  )}
                  <CardDetailItem label={t('page.jobDetail.mimeType')}>{job.mimeType ?? '—'}</CardDetailItem>
                </CardDetail>
                {job.payloadSnapshot && (
                  <Stack gap="xs">
                    <Text size="label" tone="muted">{t('page.jobDetail.payloadFields')}</Text>
                    <Mono wrap>{job.payloadSnapshot}</Mono>
                  </Stack>
                )}
                {natsInfo && (
                  <CardDetail>
                    <CardDetailItem label="NATS client"><Mono>{natsInfo.clientId ?? '—'}</Mono></CardDetailItem>
                    <CardDetailItem label="NATS subject"><Mono>{natsInfo.subject ?? '—'}</Mono></CardDetailItem>
                    <CardDetailItem label="NATS seq"><Mono>{natsInfo.streamSequence ?? '—'}</Mono></CardDetailItem>
                  </CardDetail>
                )}
              </Stack>
            </Panel>

            {/* ── Trace timeline ──
                Deliberately not rebuilt from shared primitives: a vertical
                timeline with connected step markers is genuine bespoke geometry,
                not a list wearing a costume, and it appears nowhere else. */}
            {trace && (
              <section aria-labelledby="job-trace-heading">
                <h3 className="ui-heading ui-heading--section" id="job-trace-heading">
                  {t('page.jobDetail.traceTimeline')}
                </h3>
                <ol className="job-trace">
                  {trace.steps.map((step, i) => (
                    <li className={`job-trace__step job-trace__step--${STEP_TONE[step.status] ?? 'unknown'}`} key={i}>
                      <div className="job-trace__marker" aria-hidden="true" />
                      <Card className="job-trace__card" tone="subtle">
                        <div className="job-trace__name">{step.stepName}</div>
                        <div className="job-trace__meta">
                          {step.durationMs != null ? `${step.durationMs}ms` : '—'} · {step.status}
                        </div>
                        {step.outputSummary && <div className="job-trace__summary">{step.outputSummary}</div>}
                        {step.error && <div className="job-trace__error">{step.error}</div>}
                      </Card>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* "No trace recorded" and "the trace could not be loaded" are different
                facts — the first is evidence about the job, the second is evidence
                about the network. They used to render identically. */}
            {!trace && traceResource.error == null && (
              <Text as="p" tone="muted">{t('page.jobDetail.noTrace')}</Text>
            )}
            {!trace && traceResource.error != null && (
              <ErrorBanner
                error={traceResource.error}
                title={t('page.jobDetail.traceLoadFailed')}
                onRetry={traceResource.refresh}
              />
            )}
          </Stack>
        </details>
      </Stack>

      <ReprintDialog
        job={job}
        open={reprintOpen}
        onClose={() => setReprintOpen(false)}
        onSuccess={(newJobId) => {
          setNotice({
            tone: 'ok',
            text: t('page.jobDetail.reprintSubmitted').replace('{id}', newJobId.slice(0, 8)),
          });
          refreshAll();
        }}
        onError={(text) => setNotice({ tone: 'error', text })}
        t={t}
      />
    </PageLayout>
  );
}
