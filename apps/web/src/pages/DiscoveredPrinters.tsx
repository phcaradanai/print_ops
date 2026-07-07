import { useState, useEffect } from 'react';
import { apiFetch } from '../api/client.js';

interface DiscoveredPrinter {
  id: string;
  runnerId: string;
  localPrinterName: string;
  driverName?: string;
  portName?: string;
  connectionType: string;
  isDefault: boolean;
  isShared: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  registeredPrinterId?: string;
}

const CONNECTION_BADGE: Record<string, { label: string; color: string }> = {
  usb: { label: 'USB', color: '#7c3aed' },
  tcp_ip: { label: 'TCP/IP', color: '#0369a1' },
  wsd: { label: 'WSD', color: '#0891b2' },
  lpt_com: { label: 'LPT/COM', color: '#b45309' },
  network_share: { label: 'Network Share', color: '#15803d' },
  unknown: { label: 'Unknown', color: '#6b7280' },
};

export default function DiscoveredPrinters() {
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchPrinters = async () => {
    setLoading(true);
    setError(null);
    try {
      setPrinters(await apiFetch<DiscoveredPrinter[]>('/v1/discovered-printers'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchPrinters(); }, []);

  const handleRegister = async (id: string, name: string) => {
    if (!confirm(`Register "${name}" as a printer in the registry?`)) return;
    setRegistering(id);
    setMessage(null);
    try {
      await apiFetch(`/v1/discovered-printers/${id}/register`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setMessage(`"${name}" registered successfully.`);
      void fetchPrinters();
    } catch (e) {
      setMessage(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setRegistering(null);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#1e1e2e' }}>Discovered Printers</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            Printers found on runner machines — read-only discovery. Register to add to Printer Registry.
          </p>
        </div>
        <button
          onClick={() => void fetchPrinters()}
          style={{ padding: '0.5rem 1rem', background: '#1e1e2e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' }}
        >
          Refresh
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 6, background: message.startsWith('Error') ? '#fee2e2' : '#dcfce7', color: message.startsWith('Error') ? '#dc2626' : '#16a34a', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      {loading && <p style={{ color: '#6b7280' }}>Loading...</p>}
      {error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}

      {!loading && !error && printers.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          No discovered printers yet. Start a runner on a Windows machine to populate this list.
        </div>
      )}

      {!loading && printers.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Printer Name', 'Driver', 'Port', 'Connection', 'Runner', 'Last Seen', 'Status', 'Action'].map((h) => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {printers.map((p, i) => {
                const badge = CONNECTION_BADGE[p.connectionType] ?? CONNECTION_BADGE['unknown']!;
                return (
                  <tr key={p.id} style={{ borderBottom: i < printers.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: '#111827' }}>
                      {p.localPrinterName}
                      {p.isDefault && <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#6b7280' }}>(default)</span>}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280' }}>{p.driverName ?? '—'}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280', fontFamily: 'monospace' }}>{p.portName ?? '—'}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ padding: '0.25rem 0.5rem', borderRadius: 4, background: badge.color + '20', color: badge.color, fontSize: '0.75rem', fontWeight: 600 }}>
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {p.runnerId.slice(0, 8)}…
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatTime(p.lastSeenAt)}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {p.registeredPrinterId ? (
                        <span style={{ color: '#16a34a', fontSize: '0.75rem', fontWeight: 600 }}>Registered</span>
                      ) : (
                        <span style={{ color: '#d97706', fontSize: '0.75rem', fontWeight: 600 }}>Unregistered</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {!p.registeredPrinterId && (
                        <button
                          disabled={registering === p.id}
                          onClick={() => void handleRegister(p.id, p.localPrinterName)}
                          style={{ padding: '0.375rem 0.75rem', background: '#1e1e2e', color: '#fff', border: 'none', borderRadius: 4, cursor: registering === p.id ? 'not-allowed' : 'pointer', fontSize: '0.75rem', opacity: registering === p.id ? 0.6 : 1 }}
                        >
                          {registering === p.id ? 'Registering…' : 'Register'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
