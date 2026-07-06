import { useEffect, useState } from 'react';

interface Job {
  id: string;
  printerId: string;
  status: string;
  copies: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#ffa500',
  QUEUED: '#89b4fa',
  RUNNING: '#a6e3a1',
  SUCCESS: '#40a02b',
  FAILED: '#f38ba8',
  TIMEOUT: '#e64553',
  CANCELLED: '#9399b2',
  RETRYING: '#fab387',
};

export default function JobQueue() {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    fetch('/api/jobs', { headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` } })
      .then((r) => r.ok ? r.json() : [])
      .then((data: Job[]) => setJobs(data))
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1>Job Queue</h1>
      <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Job ID</th>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Printer</th>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Status</th>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Copies</th>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && (
            <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No jobs</td></tr>
          )}
          {jobs.map((j) => (
            <tr key={j.id} style={{ borderTop: '1px solid #eee' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}><a href={`/jobs/${j.id}`}>{j.id.slice(0, 8)}…</a></td>
              <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{j.printerId.slice(0, 8)}…</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ background: STATUS_COLORS[j.status] ?? '#ccc', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                  {j.status}
                </span>
              </td>
              <td style={{ padding: '0.75rem' }}>{j.copies}</td>
              <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{new Date(j.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
