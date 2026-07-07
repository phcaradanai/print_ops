import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Job {
  id: string; printerCode?: string; printerId: string; status: string;
  copies: number; priorityLabel?: string; sourceSystem?: string;
  requestId?: string; latency?: { totalLatencyMs?: number };
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED: '#74c7ec', VALIDATED: '#89dceb', QUEUED: '#89b4fa',
  DISPATCHED: '#cba6f7', PRINTING: '#fab387', SUCCESS: '#a6e3a1',
  FAILED: '#f38ba8', TIMEOUT: '#f9e2af', CANCELLED: '#9399b2',
  DUPLICATE_RETURNED: '#bac2de',
};

export default function JobQueue() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Job[]>('/jobs?limit=100')
      .then((data) => { setJobs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Job Queue</h1>
      {loading ? <p style={{ color: '#888' }}>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              {['Job ID', 'Printer', 'Source', 'Status', 'Priority', 'Copies', 'Latency (ms)', 'Created'].map((h) => (
                <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.8rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No jobs</td></tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  <a href={`/jobs/${j.id}`} style={{ color: '#1e66f5' }}>{j.id.slice(0, 10)}…</a>
                </td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}>
                  {j.printerCode ?? j.printerId.slice(0, 8)}
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>{j.sourceSystem ?? '—'}</td>
                <td style={{ padding: '0.75rem' }}>
                  <span style={{ background: STATUS_COLORS[j.status] ?? '#ccc', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                    {j.status}
                  </span>
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{j.priorityLabel ?? '—'}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{j.copies}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>
                  {j.latency?.totalLatencyMs != null ? j.latency.totalLatencyMs : '—'}
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
