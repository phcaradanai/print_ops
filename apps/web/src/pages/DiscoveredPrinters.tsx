import { useState, useEffect } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

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

function Truncate({ value, display, className = '' }: { value?: string; display?: string; className?: string }) {
  const fullText = value && value.length > 0 ? value : '—';
  const displayText = display ?? fullText;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  return (
    <span
      className="truncate-wrap"
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ left: Math.min(rect.left, window.innerWidth - 580), top: rect.bottom + 8 });
      }}
      onMouseLeave={() => setPosition(null)}
    >
      <span className={`truncate ${className}`} title={fullText}>{displayText}</span>
      {position && fullText !== '—' && (
        <span className="hover-popover" style={{ left: Math.max(16, position.left), top: position.top }}>
          {fullText}
        </span>
      )}
    </span>
  );
}

export default function DiscoveredPrinters() {
  const { t } = useLocale();
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
      setError(e instanceof Error ? e.message : t('page.discovery.failedToFetch'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchPrinters(); }, []);

  const handleRegister = async (id: string, name: string) => {
    if (!confirm(t('page.discovery.confirmRegister').replace('{name}', name))) return;
    setRegistering(id);
    setMessage(null);
    try {
      await apiFetch(`/v1/discovered-printers/${id}/register`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setMessage(t('page.discovery.registerSuccess').replace('{name}', name));
      void fetchPrinters();
    } catch (e) {
      setMessage(t('page.discovery.registerError').replace('{message}', e instanceof Error ? e.message : t('page.discovery.unknownError')));
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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#1e1e2e' }}>{t('page.discovery.title')}</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            {t('page.discovery.description')}
          </p>
        </div>
        <button
          onClick={() => void fetchPrinters()}
          style={{ padding: '0.5rem 1rem', background: '#1e1e2e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' }}
        >
          {t('common.refresh')}
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 6, background: message.startsWith(t('page.discovery.error')) ? '#fee2e2' : '#dcfce7', color: message.startsWith(t('page.discovery.error')) ? '#dc2626' : '#16a34a', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      {loading && <p style={{ color: '#6b7280' }}>{t('page.discovery.loading')}</p>}
      {error && <p style={{ color: '#dc2626' }}>{t('page.discovery.error')}: {error}</p>}

      {!loading && !error && printers.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          {t('page.discovery.empty')}
        </div>
      )}

      {!loading && printers.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <colgroup>
              <col style={{ width: '21%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {[t('page.discovery.printerName'), t('page.discovery.driver'), t('page.discovery.port'), t('page.discovery.connection'), t('page.discovery.runner'), t('page.discovery.lastSeen'), t('page.discovery.status'), t('page.discovery.action')].map((h) => (
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
                      <Truncate value={p.localPrinterName} className="cell-name" />
                      {p.isDefault && <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#6b7280' }}>{t('page.discovery.default')}</span>}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280' }}>
                      <Truncate value={p.driverName} className="cell-driver" />
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280', fontFamily: 'monospace' }}>
                      <Truncate value={p.portName} className="cell-uri" />
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ padding: '0.25rem 0.5rem', borderRadius: 4, background: badge.color + '20', color: badge.color, fontSize: '0.75rem', fontWeight: 600 }}>
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      <Truncate value={p.runnerId} display={`${p.runnerId.slice(0, 8)}...`} className="cell-id" />
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                      <Truncate value={formatTime(p.lastSeenAt)} className="cell-time" />
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {p.registeredPrinterId ? (
                        <span style={{ color: '#16a34a', fontSize: '0.75rem', fontWeight: 600 }}>{t('status.registered')}</span>
                      ) : (
                        <span style={{ color: '#d97706', fontSize: '0.75rem', fontWeight: 600 }}>{t('status.unregistered')}</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {!p.registeredPrinterId && (
                        <button
                          disabled={registering === p.id}
                          onClick={() => void handleRegister(p.id, p.localPrinterName)}
                          style={{ padding: '0.375rem 0.75rem', background: '#1e1e2e', color: '#fff', border: 'none', borderRadius: 4, cursor: registering === p.id ? 'not-allowed' : 'pointer', fontSize: '0.75rem', opacity: registering === p.id ? 0.6 : 1 }}
                        >
                          {registering === p.id ? t('page.discovery.registering') : t('page.discovery.register')}
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
