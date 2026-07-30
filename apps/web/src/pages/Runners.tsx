import { useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { EmptyState, ErrorBanner, ErrorState, Freshness, LoadingState } from '../components/PageState.js';

interface Runner {
  id: string; name: string; hostname: string; ipAddress?: string;
  status: string; supportedProtocols: string[];
  lastHeartbeatAt?: string; registeredAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  online: '#a6e3a1', offline: '#f38ba8', busy: '#fab387', draining: '#f9e2af',
};

/** Runner health refresh. Suspended while the window is hidden and never
 *  overlapping — see `lib/pollController.ts`. */
const RUNNERS_POLL_MS = 15_000;

export default function Runners() {
  const { t } = useLocale();
  const fetchRunners = useCallback(() => apiFetch<Runner[]>('/runners'), []);
  const runnersResource = useApiResource(fetchRunners, { intervalMs: RUNNERS_POLL_MS });
  const runners = runnersResource.data ?? [];

  const heartbeatAge = (ts?: string): string => formatRelativeTime(t, ts);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.runners.title')}</h1>
        {/* "Runner online" is only meaningful with the age of that claim next
            to it: a frozen table of green dots during an API outage is exactly
            how an operator concludes printing is healthy when it is not. */}
        <Freshness
          lastSuccessAt={runnersResource.lastSuccessAt}
          stale={runnersResource.stale}
          refreshing={runnersResource.refreshing}
          paused={runnersResource.paused}
          onRefresh={runnersResource.refresh}
        />
      </div>

      {runnersResource.stale && runnersResource.error != null && (
        <ErrorBanner
          error={runnersResource.error}
          title={t('error.refresh.title')}
          onRetry={runnersResource.refresh}
        />
      )}

      {runnersResource.loading && !runnersResource.data ? (
        <LoadingState />
      ) : runnersResource.error != null && !runnersResource.data ? (
        <ErrorState error={runnersResource.error} onRetry={runnersResource.refresh} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {[t('page.runners.name'), t('page.runners.hostname'), t('page.runners.protocols'), t('page.runners.status'), t('page.runners.lastHeartbeat'), t('page.runners.registered')].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runners.length === 0 && (
              <tr><td colSpan={6}><EmptyState title={t('page.runners.noRunners')} /></td></tr>
            )}
            {runners.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: '0.75rem', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{r.hostname}</td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{r.supportedProtocols.join(', ')}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[r.status] ?? '#9399b2', display: 'inline-block' }} />
                    {r.status}
                  </span>
                </td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{heartbeatAge(r.lastHeartbeatAt)}</td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{new Date(r.registeredAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
