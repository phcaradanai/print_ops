import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import {
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Freshness,
  LoadingState,
  MetricGrid,
  MetricTile,
  Mono,
  PageLayout,
  SectionHeading,
  Stack,
  StatusBadge,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

interface Job { id: string; status: string; latency?: { totalLatencyMs?: number } }
interface Printer { id: string; isActive: boolean }
interface Runner { id: string; status: string }

export default function Dashboard() {
  const { t } = useLocale();
  // Each endpoint is its own resource. A failure no longer degrades to `[]` —
  // that rendered an outage as a healthy idle site (0 queued, 0 failed, 0
  // runners), the most dangerous lie this page can tell — and a retry no longer
  // wipes the panels that are still good.
  const fetchJobs = useCallback(() => apiFetch<Job[]>('/jobs?limit=500'), []);
  const fetchPrinters = useCallback(() => apiFetch<Printer[]>('/printers'), []);
  const fetchRunners = useCallback(() => apiFetch<Runner[]>('/runners'), []);

  const jobsResource = useApiResource(fetchJobs);
  const printersResource = useApiResource(fetchPrinters);
  const runnersResource = useApiResource(fetchRunners);

  const jobs = jobsResource.data ?? [];
  const printers = printersResource.data ?? [];
  const runners = runnersResource.data ?? [];

  const resources = [jobsResource, printersResource, runnersResource];
  const failed = resources.filter((resource) => resource.error != null);
  // Blocks until EVERY resource has settled once (data or error). `every(loading)`
  // would clear as soon as the first endpoint answered, and a total outage
  // resolves them one by one — leaving a render where the tiles show zeroes for
  // the endpoints that had already failed. Zeroes are the exact lie this page
  // must not tell, even for one frame.
  const firstLoad = resources.some(
    (resource) => resource.data === undefined && resource.error == null,
  );
  const lastSuccessAt = resources
    .map((resource) => resource.lastSuccessAt)
    .filter((value): value is number => value !== null)
    .reduce<number | null>((oldest, value) => (oldest === null || value < oldest ? value : oldest), null);

  // Depends on the `refresh` functions, not the resource objects: those are new
  // on every snapshot, so an effect keyed on them would re-run continuously.
  const refreshAll = useCallback(() => {
    jobsResource.refresh();
    printersResource.refresh();
    runnersResource.refresh();
  }, [jobsResource.refresh, printersResource.refresh, runnersResource.refresh]);

  const failedJobs = jobs.filter((j) => j.status === 'FAILED').length;
  // UNVERIFIED is a terminal status an operator must act on (paper may have
  // come out — do NOT blind-retry). Without a tile it appeared in no counter,
  // so the status that most needs eyes was invisible on the dashboard (LOW-3).
  const unverified = jobs.filter((j) => j.status === 'UNVERIFIED').length;
  const printing = jobs.filter((j) => ['DISPATCHED', 'PRINTING'].includes(j.status)).length;
  const queued = jobs.filter((j) => j.status === 'QUEUED').length;
  const onlineRunners = runners.filter((r) => r.status === 'online').length;
  const activePrinters = printers.filter((p) => p.isActive).length;
  const latencies = jobs.flatMap((j) => j.latency?.totalLatencyMs != null ? [j.latency.totalLatencyMs] : []);
  const avgMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95Ms = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] ?? null : null;

  const recentJobs = jobs.slice(0, 10);

  return (
    <PageLayout
      title={t('page.dashboard.title')}
      actions={<Freshness
          lastSuccessAt={lastSuccessAt}
          stale={failed.length > 0}
          refreshing={resources.some((resource) => resource.refreshing)}
          onRefresh={refreshAll}
        />}
    >

      {/* Names WHICH endpoint is down. Tiles fed by a failed endpoint are still
          the last known values, not zeroes, and the timestamp above says how
          old they are. */}
      {failed.length > 0 && (
        <ErrorBanner
          error={failed[0]!.error}
          title={`${t('state.partial.title')} (${failed.length}/${resources.length})`}
          onRetry={refreshAll}
        />
      )}

      {firstLoad ? <LoadingState /> : failed.length === resources.length && jobs.length === 0 ? (
        <ErrorState error={failed[0]!.error} title={t('page.dashboard.loadFailed')} onRetry={refreshAll} />
      ) : (
        <Stack gap="2xl">
          <MetricGrid label={t('page.dashboard.title')}>
            <MetricTile label={t('page.dashboard.activePrinters')} value={activePrinters} tone="accent" />
            <MetricTile label={t('page.dashboard.runnersOnline')} value={onlineRunners} tone="ok" />
            <MetricTile label={t('page.dashboard.jobsQueued')} value={queued} tone="accent" />
            {/* Tone is driven by the count, not the concept: a zero UNVERIFIED
                count is good news and must not sit there looking like an alarm. */}
            <MetricTile
              label={t('page.dashboard.unverifiedJobs')}
              value={unverified}
              tone={unverified > 0 ? 'attention' : 'neutral'}
            />
            <MetricTile
              label={t('page.dashboard.failedJobs')}
              value={failedJobs}
              tone={failedJobs > 0 ? 'critical' : 'neutral'}
            />
          </MetricGrid>

          <MetricGrid emphasis="secondary">
            <MetricTile label={t('page.dashboard.totalJobs')} value={jobs.length} />
            <MetricTile label={t('page.dashboard.currentlyPrinting')} value={printing} tone={printing > 0 ? 'accent' : 'neutral'} />
            <MetricTile label={t('page.dashboard.avgLatencyMs')} value={avgMs ?? t('common.noData')} />
            <MetricTile label={t('page.dashboard.p95LatencyMs')} value={p95Ms ?? t('common.noData')} />
          </MetricGrid>

          <Stack gap="md">
            <SectionHeading title={t('page.dashboard.recentJobs')} />
            <DataTable label={t('page.dashboard.recentJobs')} responsive>
              <thead>
                <tr>
                  <DataHead>{t('page.dashboard.jobId')}</DataHead>
                  <DataHead>{t('page.dashboard.status')}</DataHead>
                  <DataHead>{t('page.dashboard.totalLatencyMs')}</DataHead>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((j) => (
                  <tr key={j.id}>
                    <DataCell label={t('page.dashboard.jobId')}>
                      <Link to={`/jobs/${j.id}`} className="ui-link" title={j.id}>
                        <Mono>{j.id.slice(0, 12)}…</Mono>
                      </Link>
                    </DataCell>
                    <DataCell label={t('page.dashboard.status')}>
                      <StatusBadge status={j.status} size="sm" />
                    </DataCell>
                    <DataCell label={t('page.dashboard.totalLatencyMs')}>
                      <Text tone="muted" mono>
                        {j.latency?.totalLatencyMs ?? t('common.noData')}
                      </Text>
                    </DataCell>
                  </tr>
                ))}
                {recentJobs.length === 0 && (
                  <TableEmpty columns={3}>
                    <EmptyState title={t('page.dashboard.emptyJobs')} />
                  </TableEmpty>
                )}
              </tbody>
            </DataTable>
          </Stack>
        </Stack>
      )}
    </PageLayout>
  );
}
