import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { EmptyState, ErrorBanner, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';
import { RunnerStatusBadge } from '../components/RunnerStatusBadge.js';
import { PageLayout } from '../components/PageLayout.js';

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

/** Diagnostics refresh. Suspended while hidden and never overlapping. */
const DIAGNOSTICS_POLL_MS = 30_000;

export default function LocalDiagnostics() {
  const { t } = useLocale();
  const [refreshingRunnerId, setRefreshingRunnerId] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<Record<string, { tone: 'ok' | 'error'; text: string }>>({});
  const discoveringRunnerRef = useRef<string | null>(null);
  const delayedRefreshesRef = useRef<Map<string, number>>(new Map());

  const relativeTime = (ts: string): string => formatRelativeTime(t, ts);
  const fetchRunners = useCallback(() => apiFetch<Runner[]>('/runners'), []);
  const fetchPrinters = useCallback(() => apiFetch<DiscoveredPrinter[]>('/v1/discovered-printers'), []);
  const runnersResource = useApiResource(fetchRunners, { intervalMs: DIAGNOSTICS_POLL_MS });
  const printersResource = useApiResource(fetchPrinters, { intervalMs: DIAGNOSTICS_POLL_MS });
  const runners = runnersResource.data ?? [];
  const printers = printersResource.data ?? [];

  const discover = useApiAction(async (runnerId: string) =>
    apiFetch<{ queued: boolean; knownPrinters: number }>(
      `/v1/runners/${runnerId}/printers/discover`,
      { method: 'POST' },
    ),
  );

  useEffect(() => () => {
    for (const timeoutId of delayedRefreshesRef.current.values()) window.clearTimeout(timeoutId);
    delayedRefreshesRef.current.clear();
  }, []);

  const refreshAll = useCallback(() => {
    runnersResource.refresh();
    printersResource.refresh();
  }, [runnersResource.refresh, printersResource.refresh]);

  async function triggerDiscover(runnerId: string) {
    // The page has one discovery command channel. This synchronous guard closes
    // the gap before React can render the busy state and prevents a second
    // runner click from receiving the first runner's single-flight result.
    if (discoveringRunnerRef.current !== null) return;
    discoveringRunnerRef.current = runnerId;
    setRefreshingRunnerId(runnerId);

    try {
      const res = await discover.run(runnerId);
      if (res) {
        setRefreshResult((prev) => ({
          ...prev,
          [runnerId]: {
            tone: 'ok',
            text: t('page.diagnostics.queuedKnown').replace('{n}', String(res.knownPrinters)),
          },
        }));

        const existing = delayedRefreshesRef.current.get(runnerId);
        if (existing !== undefined) window.clearTimeout(existing);
        const timeoutId = window.setTimeout(() => {
          delayedRefreshesRef.current.delete(runnerId);
          printersResource.refresh();
        }, 3000);
        delayedRefreshesRef.current.set(runnerId, timeoutId);
      } else {
        setRefreshResult((prev) => ({
          ...prev,
          [runnerId]: {
            tone: 'error',
            text: `${t('page.diagnostics.requestFailed')} ${errorMessage(discover.getError())}`,
          },
        }));
      }
    } finally {
      discoveringRunnerRef.current = null;
      setRefreshingRunnerId(null);
    }
  }

  const resources = [runnersResource, printersResource];
  const firstLoad = resources.some((resource) => resource.data === undefined && resource.error == null);
  const failed = resources.filter((resource) => resource.error != null);
  const lastSuccessAt = resources
    .map((resource) => resource.lastSuccessAt)
    .filter((value): value is number => value !== null)
    .reduce<number | null>((oldest, value) => (oldest === null || value < oldest ? value : oldest), null);

  if (firstLoad) return <PageLayout title={t('page.diagnostics.title')}><LoadingState /></PageLayout>;

  if (!runnersResource.data && !printersResource.data && failed.length > 0) {
    return (
      <PageLayout title={t('page.diagnostics.title')}>
        <ErrorState error={failed[0]!.error} onRetry={refreshAll} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={t('page.diagnostics.title')}
      description={t('page.diagnostics.description')}
      actions={<Freshness
          lastSuccessAt={lastSuccessAt}
          stale={failed.length > 0 || resources.some((resource) => resource.stale)}
          refreshing={resources.some((resource) => resource.refreshing)}
          paused={resources.some((resource) => resource.paused)}
          onRefresh={refreshAll}
        />}
    >

      {failed.length > 0 && (
        <ErrorBanner
          error={failed[0]!.error}
          title={`${t('state.partial.title')} (${failed.length}/${resources.length})`}
          onRetry={refreshAll}
        />
      )}

      {/* "No runners connected" is a claim about the fleet, and an operator acts
          on it by going to look at a machine. It may only be made from a
          successful response: a failed /runners request means the answer is
          unknown, and the banner above already carries the reason. */}
      {runnersResource.data !== undefined && runnersResource.data.length === 0 && (
        <EmptyState title={t('page.diagnostics.noRunners')} />
      )}
      {runnersResource.data === undefined && (
        <p style={{ color: 'var(--neutral-text-muted)', fontSize: '0.85rem' }}>{t('page.diagnostics.runnersUnavailable')}</p>
      )}

      {runners.map((runner) => {
        const runnerPrinters = printers.filter((printer) => printer.runnerId === runner.id);
        const meta = runnerPrinters[0];
        const computerName = meta?.computerName ?? runner.hostname;
        const osName = meta?.osName;
        const result = refreshResult[runner.id];

        return (
          <section key={runner.id} className="ops-surface">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{runner.name}</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--neutral-text-muted)' }}>
                  <Truncate value={computerName} className="cell-driver" />
                </span>
                {osName && (
                  <span style={{ fontSize: '0.75rem', background: 'var(--state-info-surface)', color: 'var(--state-info-text)', padding: '2px 8px', borderRadius: 'var(--rounded-sm)' }}>{osName}</span>
                )}
                <RunnerStatusBadge status={runner.status} />
              </div>
              <Button
                size="sm"
                onClick={() => void triggerDiscover(runner.id)}
                busy={refreshingRunnerId === runner.id}
                busyLabel={t('page.diagnostics.requesting')}
                disabled={refreshingRunnerId !== null && refreshingRunnerId !== runner.id}
              >
                {t('page.diagnostics.refreshDiscovery')}
              </Button>
            </div>

            {result && (
              <Alert
                tone={result.tone === 'ok' ? 'success' : 'error'}
                onDismiss={() => setRefreshResult((prev) => {
                  const next = { ...prev };
                  delete next[runner.id];
                  return next;
                })}
                dismissLabel={t('error.dismiss')}
              >
                {result.text}
              </Alert>
            )}

            {runnerPrinters.length === 0 ? (
              /* Same rule per runner: with no successful discovered-printer
                 response, an empty filter result says nothing about this
                 runner's printers, so it must not be reported as "none found". */
              <p style={{ color: 'var(--neutral-text-muted)', fontSize: '0.85rem' }}>
                {printersResource.data === undefined
                  ? t('page.diagnostics.printersUnavailable')
                  : t('page.diagnostics.noPrinters')}
              </p>
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
                  <tr style={{ background: 'var(--neutral-page)' }}>
                    {[t('page.diagnostics.printerName'), t('page.diagnostics.driver'), t('page.diagnostics.portUri'), t('page.diagnostics.type'), t('page.diagnostics.default'), t('page.diagnostics.lastSeen'), t('page.diagnostics.registered')].map((heading) => (
                      <th key={heading} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: 'var(--neutral-text)' }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runnerPrinters.map((printer) => (
                    <tr key={printer.id} style={{ borderTop: '1px solid var(--neutral-subtle)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, fontSize: '0.85rem' }}>
                        <Truncate value={printer.localPrinterName} className="cell-name" />
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: 'var(--neutral-text)' }}>
                        <Truncate value={printer.driverName} className="cell-driver" />
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--neutral-text-muted)' }}>
                        <Truncate value={printer.portName} className="cell-uri" />
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 'var(--rounded-sm)', background: CONN_COLOR[printer.connectionType] ?? 'var(--neutral-border)', color: 'var(--neutral-deep)' }}>
                          {printer.connectionType}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', textAlign: 'center' }}>{printer.isDefault ? '✓' : ''}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: 'var(--neutral-text-muted)' }}>{relativeTime(printer.lastSeenAt)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
                        {printer.registeredPrinterId ? (
                          <span style={{ color: 'var(--state-success-text)' }}>{t('status.registered')}</span>
                        ) : (
                          <span style={{ color: 'var(--neutral-text-muted)' }}>{t('common.noData')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </PageLayout>
  );
}
