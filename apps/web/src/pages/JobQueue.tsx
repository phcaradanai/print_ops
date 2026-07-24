import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { getStatusBadgeColors } from '../statusColors.js';

interface Job {
  id: string; printerCode?: string; printerId: string; status: string;
  copies: number; priorityLabel?: string; sourceSystem?: string;
  requestId?: string; latency?: { totalLatencyMs?: number };
  createdAt: string;
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
      // Fetch full job data
      const fullJob = await apiFetch<any>(`/jobs/${job.id}`);
      
      // Resubmit as new job
      const newJob = await apiFetch<Job>('/jobs', {
        method: 'POST',
        body: JSON.stringify({
          printerId: fullJob.printerId,
          printerCode: fullJob.printerCode,
          templateCode: fullJob.templateCode,
          documentUrl: fullJob.documentUrl,
          documentBase64: fullJob.documentBase64,
          payloadSnapshot: fullJob.payloadSnapshot,
          mimeType: fullJob.mimeType,
          copies: fullJob.copies,
          duplex: fullJob.duplex,
          colorMode: fullJob.colorMode,
          mediaType: fullJob.mediaType,
          resolution: fullJob.resolution,
          priority: fullJob.priority,
          sourceSystem: fullJob.sourceSystem,
          sourceReference: fullJob.sourceReference,
          metadata: { ...fullJob.metadata, isReprintOf: fullJob.id }
        })
      });
      setMessage({ tone: 'ok', text: `Successfully submitted reprint as job: ${newJob.id.slice(0, 8)}` });
    } catch (e) {
      console.error(e);
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
          justifyContent: 'space-between'
        }}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: 'inherit' }}>✕</button>
        </div>
      )}

      {loading ? <p className="loading-text">{t('common.loading')}</p> : (
        <table className="data-table">
          <thead>
            <tr>
              {[t('page.jobQueue.jobId'), t('page.jobQueue.printer'), t('page.jobQueue.source'), t('page.jobQueue.status'), t('page.jobQueue.priority'), t('page.jobQueue.copies'), t('page.jobQueue.latencyMs'), t('page.jobQueue.created'), 'Actions'].map((h) => (
                <th key={h} scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={9} className="loading-text" style={{ padding: "2rem", textAlign: "center" }}>{t('page.jobQueue.noJobs')}</td></tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id}>
                <td style={{ fontFamily: "monospace" }}>
                  <Link to={`/jobs/${j.id}`} style={{ color: '#1e66f5', fontWeight: 600 }}>{j.id.slice(0, 10)}…</Link>
                </td>
                <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  <Link to={`/printers/${j.printerId}`} style={{ color: 'var(--neutral-deep)', textDecoration: 'none' }}>
                    {j.printerCode ?? j.printerId.slice(0, 8)}
                  </Link>
                </td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{j.sourceSystem ?? t('common.noData')}</td>
                <td>
                  <span style={{ background: getStatusBadgeColors(j.status).bg, color: getStatusBadgeColors(j.status).text, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                    {j.status}
                  </span>
                </td>
                <td>{j.priorityLabel ?? t('common.noData')}</td>
                <td>{j.copies}</td>
                <td style={{ color: "var(--neutral-text-muted)" }}>
                  {j.latency?.totalLatencyMs != null ? `${j.latency.totalLatencyMs}ms` : t('common.noData')}
                </td>
                <td style={{ fontSize: '0.75rem', color: '#888' }}>
                  {new Date(j.createdAt).toLocaleString(undefined, {
                    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
                  })}
                </td>
                <td>
                  <button 
                    onClick={() => void handleReprint(j)}
                    disabled={reprinting === j.id}
                    className="btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.4rem 0.6rem' }}
                  >
                    {reprinting === j.id ? '...' : 'Re-print'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
