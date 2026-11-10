import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { runnerHealth, type RunnerHealth } from '../lib/deviceHealth.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { RunnerStatusBadge } from '../components/RunnerStatusBadge.js';
import {
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Freshness,
  LoadingState,
  Mono,
  PageLayout,
  ResourceToolbar,
  SelectFilter,
  SearchField,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

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

  const [search, setSearch] = useState('');
  const heartbeatAge = (ts?: string): string => formatRelativeTime(t, ts);

  const columns = {
    name: t('page.runners.name'),
    hostname: t('page.runners.hostname'),
    protocols: t('page.runners.protocols'),
    status: t('page.runners.status'),
    heartbeat: t('page.runners.lastHeartbeat'),
    registered: t('page.runners.registered'),
    health: t('page.runners.filterHealth'),
  };

  // Health buckets share lib/deviceHealth with the dashboard attention strip.
  // `busy`/`draining` are working states, not problems; offline and anything
  // unknown needs eyes. Counts are last-known data when the endpoint errors.
  const [healthFilter, setHealthFilter] = useState<'ALL' | RunnerHealth>('ALL');
  const problemCount = runners.filter((r) => runnerHealth(r.status) === 'attention').length;
  const healthyCount = runners.length - problemCount;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleRunners = runners.filter((r) => {
    if (healthFilter !== 'ALL' && runnerHealth(r.status) !== healthFilter) return false;
    if (!normalizedSearch) return true;
    return `${r.name} ${r.hostname} ${r.supportedProtocols?.join(' ') ?? ''}`.toLowerCase().includes(normalizedSearch);
  });
  return (
    <PageLayout
      title={t('page.runners.title')}
      description={t('page.runners.subtitle')}
      density="compact"
      width="full"
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
        // One semantic table that becomes labelled cards under 1024px. This page
        // used to mount a `<table>` AND a parallel `<ul>` of the same runners,
        // so every row existed twice in the accessibility tree and the two
        // copies had already drifted apart in what they showed.
        <div className="ui-table-card">
          <ResourceToolbar ariaLabel={columns.health}>
            <SearchField
              label={t('page.runners.search')}
              placeholder={t('page.runners.searchPlaceholder')}
              value={search}
              onValueChange={setSearch}
            />
            <SelectFilter
              label={columns.health}
              value={healthFilter}
              onValueChange={(value) => setHealthFilter(value as 'ALL' | RunnerHealth)}
            >
              <option value="ALL">{t('page.runners.filterAll')} ({runners.length})</option>
              <option value="healthy">{t('page.runners.filterHealthy')} ({healthyCount})</option>
              <option value="attention">{t('page.runners.filterProblem')} ({problemCount})</option>
            </SelectFilter>
          </ResourceToolbar>
          <DataTable label={t('page.runners.title')} responsive>
          <thead>
            <tr>
              <DataHead>{columns.name}</DataHead>
              <DataHead>{columns.hostname}</DataHead>
              <DataHead>{columns.protocols}</DataHead>
              <DataHead>{columns.status}</DataHead>
              <DataHead>{columns.heartbeat}</DataHead>
              <DataHead>{columns.registered}</DataHead>
            </tr>
          </thead>
          <tbody>
            {visibleRunners.map((runner) => (
              <tr key={runner.id}>
                <DataCell label={columns.name}>
                  <Text weight="semibold" tone="strong">{runner.name}</Text>
                </DataCell>
                <DataCell label={columns.hostname}>
                  <Mono>{runner.hostname}</Mono>
                </DataCell>
                <DataCell label={columns.protocols}>
                  <Text tone="muted">{runner.supportedProtocols.join(', ')}</Text>
                </DataCell>
                <DataCell label={columns.status}>
                  <RunnerStatusBadge status={runner.status} />
                </DataCell>
                <DataCell label={columns.heartbeat}>
                  <Text tone="muted">{heartbeatAge(runner.lastHeartbeatAt)}</Text>
                </DataCell>
                <DataCell label={columns.registered}>
                  <Text tone="muted">{new Date(runner.registeredAt).toLocaleString()}</Text>
                </DataCell>
              </tr>
            ))}
            {visibleRunners.length === 0 && (
              <TableEmpty columns={6}>
                <EmptyState
                  title={runners.length === 0 ? t('page.runners.noRunners') : t('page.runners.noMatch')}
                />
              </TableEmpty>
            )}
          </tbody>
        </DataTable>
        </div>
      )}
    </PageLayout>
  );
}
