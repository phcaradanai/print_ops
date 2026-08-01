import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { EmptyState, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { PageLayout } from '../components/PageLayout.js';

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
  usb: { label: 'USB', color: '#6d28d9' },
  tcp_ip: { label: 'TCP/IP', color: '#0e7490' },
  wsd: { label: 'WSD', color: '#0891b2' },
  lpt_com: { label: 'LPT/COM', color: '#92400e' },
  network_share: { label: 'Network Share', color: '#166534' },
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
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pendingRegister, setPendingRegister] = useState<DiscoveredPrinter | null>(null);

  const fetchPrinters = useCallback(() => apiFetch<DiscoveredPrinter[]>('/v1/discovered-printers'), []);
  const printersResource = useApiResource(fetchPrinters);
  const printers = printersResource.data ?? [];

  const register = useApiAction(async (printer: DiscoveredPrinter) => {
    await apiFetch(`/v1/discovered-printers/${printer.id}/register`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    printersResource.refresh();
    return printer.localPrinterName;
  });

  const confirmRegister = async () => {
    if (!pendingRegister) return;
    const printer = pendingRegister;
    setPendingRegister(null);
    const name = await register.run(printer);
    setMessage(
      name
        ? { tone: 'ok', text: t('page.discovery.registerSuccess').replace('{name}', name) }
        : {
            tone: 'error',
            text: t('page.discovery.registerError').replace('{message}', errorMessage(register.getError(), t('page.discovery.unknownError'))),
          },
    );
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <PageLayout
      title={t('page.discovery.title')}
      description={t('page.discovery.description')}
      density="compact"
      actions={<Freshness
          lastSuccessAt={printersResource.lastSuccessAt}
          stale={printersResource.stale}
          refreshing={printersResource.refreshing}
          onRefresh={printersResource.refresh}
        />}
    >

      {/* Tone was previously inferred by string-matching the message against a
          translated prefix — it broke the moment either string changed. */}
      {message && (
        <Alert
          tone={message.tone === 'ok' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('error.dismiss')}
        >
          {message.text}
        </Alert>
      )}

      {printersResource.loading && !printersResource.data && <LoadingState label={t('page.discovery.loading')} />}

      {printersResource.error != null && !printersResource.data && (
        <ErrorState
          error={printersResource.error}
          title={t('page.discovery.failedToFetch')}
          onRetry={printersResource.refresh}
        />
      )}

      {!printersResource.loading && printersResource.error == null && printers.length === 0 && (
        <EmptyState title={t('page.discovery.empty')} />
      )}

      {printers.length > 0 && (
        <div className="ops-surface ops-surface--flush">
          <table className="data-table">
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
                        <span style={{ color: '#166534', fontSize: '0.75rem', fontWeight: 600 }}>{t('status.registered')}</span>
                      ) : (
                        <span style={{ color: '#92400e', fontSize: '0.75rem', fontWeight: 600 }}>{t('status.unregistered')}</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {!p.registeredPrinterId && (
                        <Button
                          size="sm"
                          busy={register.pending}
                          busyLabel={t('page.discovery.registering')}
                          onClick={() => setPendingRegister(p)}
                        >
                          {t('page.discovery.register')}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Replaces window.confirm(): a native modal blocks the whole WebView,
          cannot be styled or translated consistently, and is invisible to the
          rest of the app's state. */}
      <Dialog
        open={pendingRegister !== null}
        onClose={() => setPendingRegister(null)}
        title={t('page.discovery.register')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingRegister(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmRegister()} busy={register.pending}>
              {t('page.discovery.register')}
            </Button>
          </>
        }
      >
        {pendingRegister && (
          <p>{t('page.discovery.confirmRegister').replace('{name}', pendingRegister.localPrinterName)}</p>
        )}
      </Dialog>
    </PageLayout>
  );
}
