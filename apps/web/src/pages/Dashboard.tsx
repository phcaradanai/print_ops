import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { getStatusBadgeColors } from '../statusColors.js';
import { EmptyState, ErrorBanner, LoadingState } from '../components/PageState.js';

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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed endpoint used to degrade to an empty array and log to the console.
  // On screen that is indistinguishable from a genuinely idle site: zero queued
  // jobs, zero failures, zero runners — the most dangerous lie this page can
  // tell. Partial failures are now named on the page itself.
  const [failures, setFailures] = useState<unknown[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    const collected: unknown[] = [];
    const tolerate = <T,>(fallback: T) => (err: unknown): T => {
      collected.push(err);
      return fallback;
    };

    void Promise.all([
      apiFetch<Job[]>('/jobs?limit=500').catch(tolerate<Job[]>([])),
      apiFetch<Printer[]>('/printers').catch(tolerate<Printer[]>([])),
      apiFetch<Runner[]>('/runners').catch(tolerate<Runner[]>([])),
    ]).then(([j, p, r]) => {
      setJobs(j);
      setPrinters(p);
      setRunners(r);
      setFailures(collected);
      setLoading(false);
    });
  }, []);

  useEffect(load, [load]);

  const failed = jobs.filter((j) => j.status === 'FAILED').length;
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
      <h1 className="page-title">{t('page.dashboard.title')}</h1>

      {failures.length > 0 && (
        <ErrorBanner
          error={failures[0]}
          title={t('state.partial.title')}
          onRetry={load}
        />
      )}

      {loading ? <LoadingState /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
            <StatCard label={t('page.dashboard.activePrinters')} value={activePrinters} />
            <StatCard label={t('page.dashboard.runnersOnline')} value={onlineRunners} color="#40a02b" />
            <StatCard label={t('page.dashboard.jobsQueued')} value={queued} color="#1e66f5" />
            <StatCard label={t('page.dashboard.unverifiedJobs')} value={unverified} color={unverified > 0 ? '#f5c97b' : undefined} />
            <StatCard label={t('page.dashboard.failedJobs')} value={failed} color={failed > 0 ? '#f38ba8' : undefined} />
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
                    <span style={{ background: getStatusBadgeColors(j.status).bg, color: getStatusBadgeColors(j.status).text, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                      {j.status}
                    </span>
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
