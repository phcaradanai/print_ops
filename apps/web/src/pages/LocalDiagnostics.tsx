import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';

interface Runner {
  id: string;
  name: string;
  hostname: string;
  status: string;
  lastHeartbeatAt?: string;
}

interface DiscoveredPrinter {
  id: string;
  runnerId: string;
  localPrinterName: string;
  driverName?: string;
  portName?: string;
  connectionType: string;
  isDefault: boolean;
  isShared: boolean;
  computerName?: string;
  osName?: string;
  lastSeenAt: string;
  registeredPrinterId?: string;
}

const CONN_COLOR: Record<string, string> = {
  usb: '#89dceb', tcp_ip: '#a6e3a1', wsd: '#f9e2af', network_share: '#cba6f7',
  lpt_com: '#fab387', unknown: '#9399b2',
};

function relativeTime(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}

export default function LocalDiagnostics() {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [refreshResult, setRefreshResult] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    Promise.all([
      apiFetch<Runner[]>('/runners'),
      apiFetch<DiscoveredPrinter[]>('/v1/discovered-printers'),
    ])
      .then(([r, p]) => { setRunners(r); setPrinters(p); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  async function triggerDiscover(runnerId: string) {
    setRefreshing((prev) => ({ ...prev, [runnerId]: true }));
    try {
      const res = await apiFetch<{ queued: boolean; knownPrinters: number }>(
        `/v1/runners/${runnerId}/printers/discover`,
        { method: 'POST' }
      );
      setRefreshResult((prev) => ({ ...prev, [runnerId]: `Queued — ${res.knownPrinters} known printers` }));
      setTimeout(() => load(), 3000);
    } catch {
      setRefreshResult((prev) => ({ ...prev, [runnerId]: 'Request failed' }));
    } finally {
      setRefreshing((prev) => ({ ...prev, [runnerId]: false }));
    }
  }

  if (loading) return <p style={{ color: '#888' }}>Loading…</p>;

  return (
    <div>
      <h1 style={{ marginBottom: '0.5rem' }}>Local Diagnostics</h1>
      <p style={{ color: '#666', marginBottom: '2rem', fontSize: '0.9rem' }}>
        Printers discovered on each runner machine. Refreshes automatically every 30s.
      </p>

      {runners.length === 0 && (
        <p style={{ color: '#888' }}>No runners connected. Start the runner app to see diagnostics.</p>
      )}

      {runners.map((runner) => {
        const runnerPrinters = printers.filter((p) => p.runnerId === runner.id);
        const meta = runnerPrinters[0];
        const computerName = meta?.computerName ?? runner.hostname;
        const osName = meta?.osName;

        return (
          <div key={runner.id} style={{ marginBottom: '2rem', background: '#fff', borderRadius: '10px', padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{runner.name}</span>
                <span style={{ marginLeft: '1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#666' }}>{computerName}</span>
                {osName && (
                  <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', background: '#e8eaf6', color: '#3949ab', padding: '2px 8px', borderRadius: '12px' }}>{osName}</span>
                )}
                <span style={{
                  marginLeft: '0.75rem', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px',
                  background: runner.status === 'online' ? '#d1fae5' : '#fee2e2',
                  color: runner.status === 'online' ? '#065f46' : '#991b1b',
                }}>
                  {runner.status}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {refreshResult[runner.id] && (
                  <span style={{ fontSize: '0.8rem', color: '#666' }}>{refreshResult[runner.id]}</span>
                )}
                <button
                  onClick={() => void triggerDiscover(runner.id)}
                  disabled={refreshing[runner.id]}
                  style={{
                    padding: '0.4rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
                    background: refreshing[runner.id] ? '#e0e0e0' : '#89b4fa', color: '#1e1e2e',
                    fontSize: '0.8rem', fontWeight: 600,
                  }}
                >
                  {refreshing[runner.id] ? 'Requesting…' : 'Refresh Discovery'}
                </button>
              </div>
            </div>

            {runnerPrinters.length === 0 ? (
              <p style={{ color: '#aaa', fontSize: '0.85rem' }}>No printers discovered yet. Waits up to 60s for next discovery cycle.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    {['Printer Name', 'Driver', 'Port / URI', 'Type', 'Default', 'Last Seen', 'Registered'].map((h) => (
                      <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#555' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runnerPrinters.map((p) => (
                    <tr key={p.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, fontSize: '0.85rem' }}>{p.localPrinterName}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#555' }}>{p.driverName ?? '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#666' }}>{p.portName ?? '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: CONN_COLOR[p.connectionType] ?? '#e0e0e0', color: '#1e1e2e' }}>
                          {p.connectionType}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', textAlign: 'center' }}>{p.isDefault ? '✓' : ''}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: '#888' }}>{relativeTime(p.lastSeenAt)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
                        {p.registeredPrinterId ? (
                          <span style={{ color: '#059669' }}>Registered</span>
                        ) : (
                          <span style={{ color: '#aaa' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
