import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { EmptyState, ErrorBanner, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { StatusBadge } from '../components/StatusBadge.js';

interface Job { id: string; status: string; latency?: { totalLatencyMs?: number } }
interface Printer { id: string; isActive: boolean }
interface Runner { id: string; status: string }

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: '0.5rem', color: color ?? '#1e1e2e' }}>{value}</div>
    </div>
  );
}

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.dashboard.title')}</h1>
        <Freshness
          lastSuccessAt={lastSuccessAt}
          stale={failed.length > 0}
          refreshing={resources.some((resource) => resource.refreshing)}
          onRefresh={refreshAll}
        />
      </div>

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
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
            <StatCard label={t('page.dashboard.activePrinters')} value={activePrinters} />
            <StatCard label={t('page.dashboard.runnersOnline')} value={onlineRunners} color="#40a02b" />
            <StatCard label={t('page.dashboard.jobsQueued')} value={queued} color="#1e66f5" />
            <StatCard label={t('page.dashboard.unverifiedJobs')} value={unverified} color={unverified > 0 ? '#f5c97b' : undefined} />
            <StatCard label={t('page.dashboard.failedJobs')} value={failedJobs} color={failedJobs > 0 ? '#f38ba8' : undefined} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1rem' }}>
            <StatCard label={t('page.dashboard.totalJobs')} value={jobs.length} />
            <StatCard label={t('page.dashboard.currentlyPrinting')} value={printing} color="#fab387" />
            <StatCard label={t('page.dashboard.avgLatencyMs')} value={avgMs ?? t('common.noData')} />
            <StatCard label={t('page.dashboard.p95LatencyMs')} value={p95Ms ?? t('common.noData')} />
          </div>

          <h2 style={{ marginTop: '2rem', marginBottom: '0.75rem', fontSize: '1rem' }}>{t('page.dashboard.recentJobs')}</h2>
          <table className="data-table">
            <thead>
              <tr>
                {[t('page.dashboard.jobId'), t('page.dashboard.status'), t('page.dashboard.totalLatencyMs')].map((h) => (
                  <th key={h} scope="col" style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.8rem' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 10).map((j) => (
                <tr key={j.id}>
                  <td style={{ fontFamily: "monospace" }}>
                    <Link to={`/jobs/${j.id}`} style={{ color: '#1e66f5' }}>{j.id.slice(0, 12)}…</Link>
                  </td>
                  <td>
                    <StatusBadge status={j.status} size="sm" />
                  </td>
                  <td style={{ color: "var(--neutral-text-muted)" }}>
                    {j.latency?.totalLatencyMs != null ? j.latency.totalLatencyMs : t('common.noData')}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td colSpan={3}><EmptyState title={t('page.dashboard.emptyJobs')} /></td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
