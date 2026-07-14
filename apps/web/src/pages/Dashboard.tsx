import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Job { id: string; status: string; latency?: { totalLatencyMs?: number } }
interface Printer { id: string; isActive: boolean }
interface Runner { id: string; status: string }

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED: '#74c7ec', VALIDATED: '#89dceb', QUEUED: '#89b4fa',
  DISPATCHED: '#cba6f7', PRINTING: '#fab387', SUCCESS: '#a6e3a1',
  FAILED: '#f38ba8', TIMEOUT: '#f9e2af', CANCELLED: '#9399b2',
  DUPLICATE_RETURNED: '#bac2de',
};

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: '0.5rem', color: color ?? '#1e1e2e' }}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<Job[]>('/jobs?limit=500').catch((e) => { console.error('[Dashboard] /jobs failed', e); return [] as Job[]; }),
      apiFetch<Printer[]>('/printers').catch((e) => { console.error('[Dashboard] /printers failed', e); return [] as Printer[]; }),
      apiFetch<Runner[]>('/runners').catch((e) => { console.error('[Dashboard] /runners failed', e); return [] as Runner[]; }),
    ]).then(([j, p, r]) => { setJobs(j); setPrinters(p); setRunners(r); setLoading(false); });
  }, []);

  const failed = jobs.filter((j) => j.status === 'FAILED').length;
  const printing = jobs.filter((j) => ['DISPATCHED', 'PRINTING'].includes(j.status)).length;
  const queued = jobs.filter((j) => j.status === 'QUEUED').length;
  const onlineRunners = runners.filter((r) => r.status === 'online').length;
  const activePrinters = printers.filter((p) => p.isActive).length;
  const latencies = jobs.flatMap((j) => j.latency?.totalLatencyMs != null ? [j.latency.totalLatencyMs] : []);
  const avgMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95Ms = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] ?? null : null;

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Dashboard</h1>
      {loading ? <p style={{ color: '#888' }}>Loading…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <StatCard label="Active Printers" value={activePrinters} />
            <StatCard label="Runners Online" value={onlineRunners} color="#40a02b" />
            <StatCard label="Jobs Queued" value={queued} color="#1e66f5" />
            <StatCard label="Failed Jobs" value={failed} color={failed > 0 ? '#f38ba8' : undefined} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1rem' }}>
            <StatCard label="Total Jobs" value={jobs.length} />
            <StatCard label="Currently Printing" value={printing} color="#fab387" />
            <StatCard label="Avg Latency (ms)" value={avgMs ?? '—'} />
            <StatCard label="P95 Latency (ms)" value={p95Ms ?? '—'} />
          </div>

          <h2 style={{ marginTop: '2rem', marginBottom: '0.75rem', fontSize: '1rem' }}>Recent Jobs</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                {['Job ID', 'Status', 'Total Latency (ms)'].map((h) => (
                  <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.8rem' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 10).map((j) => (
                <tr key={j.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    <a href={`/jobs/${j.id}`} style={{ color: '#1e66f5' }}>{j.id.slice(0, 12)}…</a>
                  </td>
                  <td style={{ padding: '0.75rem' }}>
                    <span style={{ background: STATUS_COLORS[j.status] ?? '#ccc', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                      {j.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>
                    {j.latency?.totalLatencyMs != null ? j.latency.totalLatencyMs : '—'}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td colSpan={3} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No jobs yet. Send a print job via the API.</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
