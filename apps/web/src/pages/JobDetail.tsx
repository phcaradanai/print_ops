import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

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

interface Job {
  id: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  spoolerSentAt?: string;
  printerAckAt?: string;
  metadata?: {
    printEvidence?: PrintEvidence;
  };
  resolvedTemplateCode?: string;
  paperProfileId?: string;
  routePolicyId?: string;
  templateTiming?: {
    routeResolveMs?: number;
    renderMs?: number;
  };
}

const STEP_COLOR: Record<string, string> = {
  success: '#a6e3a1',
  failed: '#f38ba8',
  running: '#89b4fa',
  skipped: '#9399b2',
};

function formatStateReasons(reasons: IppObservedJobEvidence['stateReasons'], noData: string): string {
  if (Array.isArray(reasons)) {
    const values = reasons.filter((reason) => reason.trim().length > 0);
    return values.length > 0 ? values.join(', ') : noData;
  }
  return typeof reasons === 'string' && reasons.trim().length > 0 ? reasons : noData;
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
        <span
          className={`print-evidence__outcome ${ippConfirmed ? 'print-evidence__outcome--confirmed' : ''}`}
        >
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

export default function JobDetail() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const load = () => {
      void apiFetch<Job>(`/jobs/${id}`).then((data) => { if (active) setJob(data); }).catch(() => {});
      void apiFetch<Trace>(`/jobs/${id}/trace`).then((data) => { if (active) setTrace(data); }).catch(() => {});
    };
    load();
    const interval = window.setInterval(load, 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [id]);

  return (
    <div>
      <h1>{t('page.jobDetail.title')}</h1>
      <p className="loading-text">{t('page.jobDetail.jobId')}: <code>{id}</code></p>
      {job && (
        <div style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>{t('page.jobDetail.summary')}</h2>
          <p>Status: <strong>{job.status}</strong></p>
          {job.errorCode && <p style={{ color: '#b91c1c' }}>Error: <code>{job.errorCode}</code> — {job.errorMessage}</p>}
          {job.metadata?.printEvidence && (
            <PrinterEvidence evidence={job.metadata.printEvidence} t={t} />
          )}
          <h2 style={{ fontSize: '1rem', marginTop: '1rem' }}>{t('page.jobDetail.templateResolution')}</h2>
          <p>{t('page.jobDetail.template')}: <code>{job.resolvedTemplateCode ?? t('common.noData')}</code></p>
          <p>{t('page.jobDetail.paperProfile')}: <code>{job.paperProfileId ?? t('common.noData')}</code></p>
          <p>{t('page.jobDetail.routePolicy')}: <code>{job.routePolicyId ?? t('common.noData')}</code></p>
          <p>{t('page.jobDetail.route')}: {job.templateTiming?.routeResolveMs ?? t('common.noData')}ms · Render: {job.templateTiming?.renderMs ?? t('common.noData')}ms</p>
        </div>
      )}

      {trace && (
        <div style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem' }}>{t('page.jobDetail.traceTimeline')}</h2>
          <div style={{ marginTop: '1rem' }}>
            {trace.steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div style={{
                  width: '12px', height: '12px', borderRadius: '50%',
                  background: STEP_COLOR[step.status] ?? '#ccc',
                  marginTop: '4px', marginRight: '1rem', flexShrink: 0,
                }} />
                <div style={{ background: '#fff', padding: '0.75rem 1rem', borderRadius: '6px', flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{step.stepName}</div>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '2px' }}>
                    {step.durationMs != null ? `${step.durationMs}ms` : ''} · {step.status}
                  </div>
                  {step.outputSummary && <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>{step.outputSummary}</div>}
                  {step.error && <div style={{ fontSize: '0.75rem', color: '#f38ba8', marginTop: '4px' }}>{step.error}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!trace && <p style={{ color: '#888', marginTop: '1rem' }}>{t('page.jobDetail.noTrace')}</p>}
    </div>
  );
}
