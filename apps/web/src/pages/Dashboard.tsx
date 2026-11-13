import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { printerHealth, runnerHealth } from '../lib/deviceHealth.js';
import { formatCreatedAt } from '../lib/formatCreatedAt.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import {
  Button,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Freshness,
  Inline,
  LoadingState,
  MetricGrid,
  MetricTile,
  Mono,
  PageLayout,
  Panel,
  SectionHeading,
  Stack,
  StateBadge,
  StatusBadge,
  StatusDot,
  StatusIndicator,
  TableEmpty,
  Text,
} from '../components/ui/index.js';
import { ClientControlStatusBadge } from '../App.js';
import './dashboard.css';

interface Job {
  id: string;
  printerId?: string;
  printerCode?: string;
  status: string;
  createdAt?: string;
  latency?: { totalLatencyMs?: number };
}
interface Printer {
  id: string;
  code: string;
  name?: string;
  location?: string;
  isActive: boolean;
  status?: { code?: string | null; checkedAt?: string | null };
}
interface Runner { id: string; status: string }

/** One count in the attention strip, each linking into the exact filtered view. */
interface AttentionItem {
  key: string;
  to: string;
  count: number;
  label: string;
  tone: 'unverified' | 'timeout' | 'failed' | 'device';
  /* Optional honest-ambiguity hint (e.g. what UNVERIFIED actually means). */
  hint?: string;
}

export default function Dashboard() {
  const { t } = useLocale();
  const navigate = useNavigate();
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
  const timeoutJobs = jobs.filter((j) => j.status === 'TIMEOUT').length;
  const printing = jobs.filter((j) => ['DISPATCHED', 'PRINTING'].includes(j.status)).length;
  const queued = jobs.filter((j) => j.status === 'QUEUED').length;
  const onlineRunners = runners.filter((r) => r.status === 'online').length;
  const activePrinters = printers.filter((p) => p.isActive).length;
  // Same buckets the /runners and /printers pages filter on (lib/deviceHealth).
  const runnersAttention = runners.filter((r) => runnerHealth(r.status) === 'attention').length;
  const printersAttention = printers.filter(
    (p) => printerHealth(p.isActive, p.status?.code) === 'attention',
  ).length;
  const latencies = jobs.flatMap((j) => j.latency?.totalLatencyMs != null ? [j.latency.totalLatencyMs] : []);
  const avgMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95Ms = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] ?? null : null;

  const recentJobs = jobs.slice(0, 10);

  // The attention strip REPLACES the big status cards: the counts that need
  // eyes lead the page as compact links into the exact filtered view (e.g.
  // /jobs?status=UNVERIFIED renders the queue pre-filtered). Counts are
  // last-known data — the banner above and Freshness tell the operator how
  // fresh, so the strip never claims more certainty than it has.
  // Each entry is conditional; zero-count rows collapse into nothing below so
  // the strip shows only real work.
  const attentionCandidates: (AttentionItem | false)[] = [
    unverified > 0 && {
      key: 'unverified',
      to: '/jobs?status=UNVERIFIED',
      count: unverified,
      label: t('page.dashboard.unverifiedJobs'),
      tone: 'unverified',
      // UNVERIFIED must be explained at every entry point: the job was
      // reported complete, but physical output was never confirmed.
      hint: t('page.dashboard.unverifiedHint'),
    },
    timeoutJobs > 0 && {
      key: 'timeout',
      to: '/jobs?status=TIMEOUT',
      count: timeoutJobs,
      label: t('page.dashboard.timeoutJobs'),
      tone: 'timeout',
    },
    failedJobs > 0 && {
      key: 'failed',
      to: '/jobs?status=FAILED',
      count: failedJobs,
      label: t('page.dashboard.failedJobs'),
      tone: 'failed',
    },
    runnersAttention > 0 && {
      key: 'runners',
      to: '/runners',
      count: runnersAttention,
      label: t('page.dashboard.runnersProblem'),
      tone: 'device',
    },
    printersAttention > 0 && {
      key: 'printers',
      to: '/printers',
      count: printersAttention,
      label: t('page.dashboard.printersProblem'),
      tone: 'device',
    },
  ];
  const attentionItems: AttentionItem[] = attentionCandidates.filter(
    (item): item is AttentionItem => item !== false,
  );

  return (
    <PageLayout
      title={t('page.dashboard.title')}
      description={t('page.dashboard.subtitle')}
      width="full"
      actions={
        <Inline gap="sm">
          <Button onClick={() => navigate('/jobs')}>
            {t('page.dashboard.viewJobQueue')} →
          </Button>
          <Freshness
            lastSuccessAt={lastSuccessAt}
            stale={failed.length > 0}
            refreshing={resources.some((resource) => resource.refreshing)}
            onRefresh={refreshAll}
          />
        </Inline>
      }
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
          <Panel padding="md" className="ops-attention" aria-label={t('page.dashboard.attention')}>
            <div className="ops-attention__row">
              <Text as="span" size="label" weight="semibold" tone="muted" className="ops-attention__title">
                {t('page.dashboard.attention')}
              </Text>
              {attentionItems.length > 0 ? (
                attentionItems.map((item) => (
                  <Link
                    key={item.key}
                    to={item.to}
                    className={`ops-attention__item ops-attention__item--${item.tone}`}
                    title={item.hint}
                  >
                    <span className="ops-attention__count">{item.count}</span>
                    <span className="ops-attention__label">{item.label}</span>
                  </Link>
                ))
              ) : (
                <span className="ops-attention__all-clear">
                  <StatusDot tone="ok" />
                  {t('page.dashboard.attentionNone')}
                </span>
              )}
            </div>
            {/* Counts derive from the rows we have; when an endpoint is down,
                the banner above names it and Freshness dates the data. */}
            <Text as="p" size="label" tone="muted" className="ops-attention__hint">
              {t('page.dashboard.attentionHint')}
            </Text>
          </Panel>

          <Panel padding="md">
            <Stack gap="xs">
              <Inline gap="xs" className="dashboard-control__row" style={{ alignItems: 'center' }}>
                <Text size="body" weight="semibold">{t('client.control.indicator')}</Text>
                <ClientControlStatusBadge />
              </Inline>
              <Text size="label" tone="muted">
                {t('client.control.visibleDesc')}
              </Text>
            </Stack>
          </Panel>

          {/* Compact live summary. Statuses that need eyes moved up into the
              attention strip; these tiles stay secondary so they never read
              as the primary thing to do next. */}
          <MetricGrid label={t('page.dashboard.title')} emphasis="secondary">
            <MetricTile label={t('page.dashboard.activePrinters')} value={activePrinters} tone="accent" />
            <MetricTile label={t('page.dashboard.runnersOnline')} value={onlineRunners} tone="ok" />
            <MetricTile label={t('page.dashboard.jobsQueued')} value={queued} tone="accent" />
            <MetricTile label={t('page.dashboard.currentlyPrinting')} value={printing} tone={printing > 0 ? 'accent' : 'neutral'} />
            <MetricTile label={t('page.dashboard.totalJobs')} value={jobs.length} />
            <MetricTile label={t('page.dashboard.avgLatencyMs')} value={avgMs ?? t('common.noData')} />
            <MetricTile label={t('page.dashboard.p95LatencyMs')} value={p95Ms ?? t('common.noData')} />
          </MetricGrid>
          <div className="dashboard-grid">
            <Stack gap="md" className="dashboard-grid__jobs">
              <SectionHeading title={t('page.dashboard.recentJobs')} />
            <DataTable label={t('page.dashboard.recentJobs')} responsive>
              <thead>
                <tr>
                  <DataHead>{t('page.dashboard.jobId')}</DataHead>
                  <DataHead>{t('page.dashboard.status')}</DataHead>
                  <DataHead>{t('page.dashboard.printer')}</DataHead>
                  <DataHead>{t('page.dashboard.created')}</DataHead>
                  <DataHead align="right">{t('page.dashboard.totalLatencyMs')}</DataHead>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((j) => (
                  <tr key={j.id}>
                    <DataCell label={t('page.dashboard.jobId')}>
                      <Link to={`/jobs/${j.id}`} className="ui-link dashboard-cell-link dashboard-cell-link--id" title={j.id}>
                        <Mono truncate>{j.id}</Mono>
                      </Link>
                    </DataCell>
                    <DataCell label={t('page.dashboard.status')}>
                      <StatusBadge status={j.status} size="sm" />
                    </DataCell>
                    <DataCell label={t('page.dashboard.printer')}>
                      {j.printerId ? (
                        <Link
                          to={`/printers/${j.printerId}`}
                          className="ui-link dashboard-cell-link dashboard-cell-link--printer"
                          title={j.printerCode ?? j.printerId}
                        >
                          <Text truncate>{j.printerCode ?? j.printerId}</Text>
                        </Link>
                      ) : (
                        <Text tone="muted">{t('common.noData')}</Text>
                      )}
                    </DataCell>
                    <DataCell label={t('page.dashboard.created')}>
                      <Text size="label" tone="muted" nowrap>
                        {j.createdAt ? formatCreatedAt(j.createdAt) : t('common.noData')}
                      </Text>
                    </DataCell>
                    <DataCell label={t('page.dashboard.totalLatencyMs')} align="right">
                      <Text tone="muted" mono>
                        {j.latency?.totalLatencyMs ?? t('common.noData')}
                      </Text>
                    </DataCell>
                  </tr>
                ))}
                {recentJobs.length === 0 && (
                  <TableEmpty columns={5}>
                    <EmptyState title={t('page.dashboard.emptyJobs')} />
                  </TableEmpty>
                )}
              </tbody>
            </DataTable>
          </Stack>
            <Stack gap="md" className="dashboard-grid__printers">
              <SectionHeading title={t('page.dashboard.printerHealth')} />
            <DataTable label={t('page.dashboard.printerHealth')}>
              <thead>
                <tr>
                  <DataHead>{t('page.printers.name')}</DataHead>
                  <DataHead align="right">{t('page.printers.status')}</DataHead>
                </tr>
              </thead>
              <tbody>
                {printers.map((p) => (
                  <tr key={p.id}>
                    <DataCell label={t('page.printers.name')} className="dashboard-printer-health__name">
                      <Link to={`/printers/${p.id}`} className="ui-link dashboard-cell-link" title={`${p.code}${p.name ? ` · ${p.name}` : ''}`}>
                        <Text weight="semibold" truncate>{p.code}</Text>
                        {p.name && <Text size="label" tone="muted" truncate>{p.name}{p.location ? ` · ${p.location}` : ''}</Text>}
                      </Link>
                    </DataCell>
                    <DataCell label={t('page.printers.status')} align="right" className="dashboard-printer-health__status">
                      {p.status?.code
                        ? <StatusIndicator condition={p.status.code} />
                        : <Text tone="muted">{t('common.noData')}</Text>}
                    </DataCell>
                  </tr>
                ))}
                {printers.length === 0 && (
                  <TableEmpty columns={2}>
                    <EmptyState title={t('page.printers.noPrinters')} />
                  </TableEmpty>
                )}
              </tbody>
            </DataTable>
            </Stack>
          </div>
        </Stack>
      )}
    </PageLayout>
  );
}