import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Runner {
  id: string; name: string; hostname: string; ipAddress?: string;
  status: string; supportedProtocols: string[];
  lastHeartbeatAt?: string; registeredAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  online: '#a6e3a1', offline: '#f38ba8', busy: '#fab387', draining: '#f9e2af',
};

function heartbeatAge(ts?: string): string {
  if (!ts) return 'never';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}

export default function Runners() {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Runner[]>('/runners')
      .then((data) => { setRunners(data); setLoading(false); })
      .catch(() => setLoading(false));
    const iv = setInterval(() => {
      apiFetch<Runner[]>('/runners').then(setRunners).catch(() => {});
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Runners</h1>
      {loading ? <p style={{ color: '#888' }}>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              {['Name', 'Hostname', 'Protocols', 'Status', 'Last Heartbeat', 'Registered'].map((h) => (
                <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.8rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runners.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No runners registered. Start the runner app to connect.</td></tr>
            )}
            {runners.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{r.hostname}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>{r.supportedProtocols.join(', ')}</td>
                <td style={{ padding: '0.75rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[r.status] ?? '#9399b2', display: 'inline-block' }} />
                    {r.status}
                  </span>
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>{heartbeatAge(r.lastHeartbeatAt)}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>{new Date(r.registeredAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
