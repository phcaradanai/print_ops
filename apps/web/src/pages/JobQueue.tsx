import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { getStatusBadgeColors } from '../statusColors.js';

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

export default function JobQueue() {
  const { t } = useLocale();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [reprinting, setReprinting] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      void apiFetch<Job[]>('/jobs?limit=100')
        .then((data) => { if (active) setJobs(data); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });
    };
    load();
    const interval = window.setInterval(load, 1_500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const handleReprint = async (job: Job) => {
    setReprinting(job.id);
    try {
      const fullJob = await apiFetch<Record<string, unknown>>(`/jobs/${job.id}`);
      const newJob = await apiFetch<Job>('/jobs', {
        method: 'POST',
        body: JSON.stringify({
          printerId: fullJob['printerId'],
          printerCode: fullJob['printerCode'],
          templateCode: fullJob['templateCode'],
          documentUrl: fullJob['documentUrl'],
          documentBase64: fullJob['documentBase64'],
          payloadSnapshot: fullJob['payloadSnapshot'],
          mimeType: fullJob['mimeType'],
          copies: fullJob['copies'],
          duplex: fullJob['duplex'],
          colorMode: fullJob['colorMode'],
          mediaType: fullJob['mediaType'],
          resolution: fullJob['resolution'],
          priority: fullJob['priority'],
          sourceSystem: fullJob['sourceSystem'],
          sourceReference: fullJob['sourceReference'],
          metadata: { ...(fullJob['metadata'] as Record<string, unknown> ?? {}), isReprintOf: fullJob['id'] },
        }),
      });
      setMessage({ tone: 'ok', text: `Successfully submitted reprint as job: ${newJob.id.slice(0, 8)}` });
    } catch {
      setMessage({ tone: 'error', text: 'Failed to reprint job. Check connection or job data.' });
    } finally {
      setReprinting(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.jobQueue.title')}</h1>
      </div>

      {message && (
        <div style={{
          padding: '1rem',
          marginBottom: '1rem',
          borderRadius: '8px',
          background: message.tone === 'ok' ? '#dcfce7' : '#fee2e2',
          color: message.tone === 'ok' ? '#166534' : '#991b1b',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: 'inherit' }}>✕</button>
        </div>
      )}

      {loading ? <p className="loading-text">{t('common.loading')}</p> : (
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
              <tr><td colSpan={8} className="loading-text" style={{ padding: '2rem', textAlign: 'center' }}>{t('page.jobQueue.noJobs')}</td></tr>
            )}
            {jobs.map((j) => {
              const statusColors = getStatusBadgeColors(j.status);
              const template = j.resolvedTemplateCode ?? j.templateCode;
              const hint = payloadHint(j.payloadSnapshot);
              return (
                <tr key={j.id}>
                  {/* Status badge */}
                  <td>
                    <span style={{
                      background: statusColors.bg, color: statusColors.text,
                      padding: '3px 10px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}>
                      {j.status}
                    </span>
                  </td>

                  {/* Document summary — the key column that was missing */}
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <Link to={`/jobs/${j.id}`} style={{ color: '#1e66f5', fontWeight: 600, fontSize: '0.85rem' }}>
                        {template ?? t('common.noData')}
                      </Link>
                      {j.sourceReference && (
                        <span style={{ fontSize: '0.7rem', color: '#666' }}>เลขที่เอกสาร: {j.sourceReference}</span>
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
                    <button
                      onClick={() => void handleReprint(j)}
                      disabled={reprinting === j.id}
                      className="btn-secondary"
                      style={{ fontSize: '0.7rem', padding: '0.35rem 0.6rem' }}
                    >
                      {reprinting === j.id ? '…' : t('page.jobQueue.reprint')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
