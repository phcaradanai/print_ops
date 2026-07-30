import { useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { EmptyState, ErrorBanner, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { Button } from '../components/Button.js';

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

/** Diagnostics refresh. Suspended while hidden, never overlapping — this page
 *  is the one most likely to be left open on a second monitor for hours. */
const DIAGNOSTICS_POLL_MS = 30_000;

export default function LocalDiagnostics() {
  const { t } = useLocale();
  const [refreshingRunnerId, setRefreshingRunnerId] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<Record<string, { tone: 'ok' | 'error'; text: string }>>({});

  const relativeTime = (ts: string): string => formatRelativeTime(t, ts);

  const fetchDiagnostics = useCallback(async () => {
    const [runners, printers] = await Promise.all([
      apiFetch<Runner[]>('/runners'),
      apiFetch<DiscoveredPrinter[]>('/v1/discovered-printers'),
    ]);
    return { runners, printers };
  }, []);

  const diagnostics = useApiResource(fetchDiagnostics, { intervalMs: DIAGNOSTICS_POLL_MS });
  const runners = diagnostics.data?.runners ?? [];
  const printers = diagnostics.data?.printers ?? [];

  const discover = useApiAction(async (runnerId: string) =>
    apiFetch<{ queued: boolean; knownPrinters: number }>(
      `/v1/runners/${runnerId}/printers/discover`,
      { method: 'POST' },
    ),
  );

  async function triggerDiscover(runnerId: string) {
    setRefreshingRunnerId(runnerId);
    const res = await discover.run(runnerId);
    setRefreshingRunnerId(null);

    if (res) {
      setRefreshResult((prev) => ({
        ...prev,
        [runnerId]: {
          tone: 'ok',
          text: t('page.diagnostics.queuedKnown').replace('{n}', String(res.knownPrinters)),
        },
      }));
      // Discovery is asynchronous on the runner: give it a moment, then re-read.
      setTimeout(() => diagnostics.refresh(), 3000);
    } else {
      setRefreshResult((prev) => ({
        ...prev,
        [runnerId]: {
          tone: 'error',
          text: `${t('page.diagnostics.requestFailed')} ${errorMessage(discover.getError())}`,
        },
      }));
    }
  }

  if (diagnostics.loading && !diagnostics.data) return <LoadingState />;

  if (!diagnostics.data && diagnostics.error != null) {
    return (
      <div>
        <h1 style={{ marginBottom: '0.5rem' }}>{t('page.diagnostics.title')}</h1>
        <ErrorState error={diagnostics.error} onRetry={diagnostics.refresh} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 style={{ margin: 0 }}>{t('page.diagnostics.title')}</h1>
        <Freshness
          lastSuccessAt={diagnostics.lastSuccessAt}
          stale={diagnostics.stale}
          refreshing={diagnostics.refreshing}
          paused={diagnostics.paused}
          onRefresh={diagnostics.refresh}
        />
      </div>
      <p style={{ color: '#666', marginBottom: '2rem', fontSize: '0.9rem' }}>
        {t('page.diagnostics.description')}
      </p>

      {/* Refresh failed but runner cards are still shown: they are a snapshot. */}
      {diagnostics.stale && diagnostics.error != null && (
        <ErrorBanner
          error={diagnostics.error}
          title={t('error.refresh.title')}
          onRetry={diagnostics.refresh}
        />
      )}

      {runners.length === 0 && <EmptyState title={t('page.diagnostics.noRunners')} />}

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
                <span style={{ marginLeft: '1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#666' }}>
                  <Truncate value={computerName} className="cell-driver" />
                </span>
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
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: refreshResult[runner.id]!.tone === 'error' ? '#991b1b' : '#666',
                    }}
                    role={refreshResult[runner.id]!.tone === 'error' ? 'alert' : 'status'}
                  >
                    {refreshResult[runner.id]!.text}
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={() => void triggerDiscover(runner.id)}
                  busy={refreshingRunnerId === runner.id}
                  busyLabel={t('page.diagnostics.requesting')}
                >
                  {t('page.diagnostics.refreshDiscovery')}
                </Button>
              </div>
            </div>

            {runnerPrinters.length === 0 ? (
              <p style={{ color: '#aaa', fontSize: '0.85rem' }}>{t('page.diagnostics.noPrinters')}</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <colgroup>
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    {[t('page.diagnostics.printerName'), t('page.diagnostics.driver'), t('page.diagnostics.portUri'), t('page.diagnostics.type'), t('page.diagnostics.default'), t('page.diagnostics.lastSeen'), t('page.diagnostics.registered')].map((h) => (
                      <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#555' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runnerPrinters.map((p) => (
                    <tr key={p.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, fontSize: '0.85rem' }}>
                        <Truncate value={p.localPrinterName} className="cell-name" />
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#555' }}>
                        <Truncate value={p.driverName} className="cell-driver" />
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#666' }}>
                        <Truncate value={p.portName} className="cell-uri" />
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: CONN_COLOR[p.connectionType] ?? '#e0e0e0', color: '#1e1e2e' }}>
                          {p.connectionType}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', textAlign: 'center' }}>{p.isDefault ? '✓' : ''}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: '#888' }}>{relativeTime(p.lastSeenAt)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
                        {p.registeredPrinterId ? (
                          <span style={{ color: '#059669' }}>{t('status.registered')}</span>
                        ) : (
                          <span style={{ color: '#aaa' }}>{t('common.noData')}</span>
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
