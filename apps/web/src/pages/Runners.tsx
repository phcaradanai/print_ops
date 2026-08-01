import { useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { EmptyState, ErrorBanner, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { RunnerStatusBadge } from '../components/RunnerStatusBadge.js';
import { PageLayout } from '../components/PageLayout.js';

interface Runner {
  id: string; name: string; hostname: string; ipAddress?: string;
  status: string; supportedProtocols: string[];
  lastHeartbeatAt?: string; registeredAt: string;
}

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
    <PageLayout
      title={t('page.runners.title')}
      density="compact"
      actions={<Freshness
          lastSuccessAt={runnersResource.lastSuccessAt}
          stale={runnersResource.stale}
          refreshing={runnersResource.refreshing}
          paused={runnersResource.paused}
          onRefresh={runnersResource.refresh}
        />}
    >

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
        <>
        <table className="data-table runner-table">
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
            {runners.map((runner) => (
              <tr key={runner.id}>
                <td style={{ padding: '0.75rem', fontWeight: 600 }}>{runner.name}</td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{runner.hostname}</td>
                <td style={{ color: 'var(--neutral-text-muted)' }}>{runner.supportedProtocols.join(', ')}</td>
                <td><RunnerStatusBadge status={runner.status} /></td>
                <td style={{ color: 'var(--neutral-text-muted)' }}>{heartbeatAge(runner.lastHeartbeatAt)}</td>
                <td style={{ color: 'var(--neutral-text-muted)' }}>{new Date(runner.registeredAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="resource-record-list runner-record-list" aria-label={t('page.runners.title')}>
          {runners.length === 0 ? (
            <li><EmptyState title={t('page.runners.noRunners')} /></li>
          ) : runners.map((runner) => (
            <li key={runner.id} className="resource-record">
              <div className="resource-record__heading">
                <strong>{runner.name}</strong>
                <RunnerStatusBadge status={runner.status} />
              </div>
              <dl className="resource-record__facts">
                <div><dt>{t('page.runners.hostname')}</dt><dd><code>{runner.hostname}</code></dd></div>
                <div><dt>{t('page.runners.protocols')}</dt><dd>{runner.supportedProtocols.join(', ')}</dd></div>
                <div><dt>{t('page.runners.lastHeartbeat')}</dt><dd>{heartbeatAge(runner.lastHeartbeatAt)}</dd></div>
                <div><dt>{t('page.runners.registered')}</dt><dd>{new Date(runner.registeredAt).toLocaleString()}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        </>
      )}
    </PageLayout>
  );
}
