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

interface Job {
  id: string;
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

export default function JobDetail() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    if (!id) return;
    apiFetch<Job>(`/jobs/${id}`).then(setJob).catch(() => {});
    apiFetch<Trace>(`/jobs/${id}/trace`)
      .then(setTrace)
      .catch(() => {});
  }, [id]);

  return (
    <div>
      <h1>{t('page.jobDetail.title')}</h1>
      <p style={{ color: '#888' }}>{t('page.jobDetail.jobId')}: <code>{id}</code></p>
      {job && (
        <div style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>{t('page.jobDetail.templateResolution')}</h2>
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
