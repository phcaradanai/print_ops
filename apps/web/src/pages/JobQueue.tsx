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

  useEffect(() => {
    apiFetch<Job[]>('/jobs?limit=100')
      .then((data) => { setJobs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>{t('page.jobQueue.title')}</h1>
      {loading ? <p style={{ color: '#888' }}>{t('common.loading')}</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              {[t('page.jobQueue.jobId'), t('page.jobQueue.printer'), t('page.jobQueue.source'), t('page.jobQueue.status'), t('page.jobQueue.priority'), t('page.jobQueue.copies'), t('page.jobQueue.latencyMs'), t('page.jobQueue.created')].map((h) => (
                <th key={h} scope="col" style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.8rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>{t('page.jobQueue.noJobs')}</td></tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  <Link to={`/jobs/${j.id}`} style={{ color: '#1e66f5' }}>{j.id.slice(0, 10)}…</Link>
                </td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}>
                  {j.printerCode ?? j.printerId.slice(0, 8)}
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>{j.sourceSystem ?? t('common.noData')}</td>
                <td style={{ padding: '0.75rem' }}>
                  <span style={{ background: getStatusBadgeColors(j.status).bg, color: getStatusBadgeColors(j.status).text, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                    {j.status}
                  </span>
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{j.priorityLabel ?? t('common.noData')}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{j.copies}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>
                  {j.latency?.totalLatencyMs != null ? j.latency.totalLatencyMs : t('common.noData')}
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#888' }}>{new Date(j.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
