import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useHasPermission } from '../api/session.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { runnerHealth, type RunnerHealth } from '../lib/deviceHealth.js';
import {
  canRemoveRunner,
  isRunnerTerminated,
} from '../lib/runnerLifecycle.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { RunnerStatusBadge } from '../components/RunnerStatusBadge.js';
import {
  Alert,
  Badge,
  Button,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Freshness,
  Inline,
  LoadingState,
  Mono,
  PageLayout,
  ResourceToolbar,
  SelectFilter,
  SearchField,
  Stack,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

interface Runner {
  id: string; name: string; hostname: string; ipAddress?: string;
  status: string; supportedProtocols: string[];
  lastHeartbeatAt?: string; registeredAt: string;
  metadata?: Record<string, unknown>;
}

type RunnerAction = 'terminate' | 'delete';

/** Runner health refresh. Suspended while the window is hidden and never
 *  overlapping — see `lib/pollController.ts`. */
const RUNNERS_POLL_MS = 15_000;

export default function Runners() {
  const { t } = useLocale();
  const fetchRunners = useCallback(() => apiFetch<Runner[]>('/runners'), []);
  const runnersResource = useApiResource(fetchRunners, { intervalMs: RUNNERS_POLL_MS });
  const runners = runnersResource.data ?? [];
  const canManageRunners = useHasPermission('runner:manage');

  const [search, setSearch] = useState('');
  const heartbeatAge = (ts?: string): string => formatRelativeTime(t, ts);

  // Terminate / delete flow. The server refuses to remove the last runner able to
  // claim work; the page disables the action in the same case and says why.
  const [actionTarget, setActionTarget] = useState<{ runner: Runner; action: RunnerAction } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const closeAction = () => {
    if (actionBusy) return;
    setActionTarget(null);
    setActionError(null);
  };

  const runAction = async () => {
    if (!actionTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (actionTarget.action === 'terminate') {
        await apiFetch(`/runners/${encodeURIComponent(actionTarget.runner.id)}/terminate`, { method: 'POST' });
        setNotice(t('page.runners.terminateDone'));
      } else {
        await apiFetch(`/runners/${encodeURIComponent(actionTarget.runner.id)}`, { method: 'DELETE' });
        setNotice(t('page.runners.deleteDone'));
      }
      runnersResource.refresh();
      setActionTarget(null);
    } catch (err) {
      // The API returns 409 with the "at least one runner must remain" explanation.
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const columns = {
    name: t('page.runners.name'),
    hostname: t('page.runners.hostname'),
    protocols: t('page.runners.protocols'),
    status: t('page.runners.status'),
    heartbeat: t('page.runners.lastHeartbeat'),
    registered: t('page.runners.registered'),
    health: t('page.runners.filterHealth'),
    actions: t('page.runners.actions'),
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
  const columnCount = canManageRunners ? 7 : 6;
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

      {notice && (
        <Alert tone="success" onDismiss={() => setNotice(null)} dismissLabel={t('common.close')}>
          {notice}
        </Alert>
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
              {canManageRunners && <DataHead>{columns.actions}</DataHead>}
            </tr>
          </thead>
          <tbody>
            {visibleRunners.map((runner) => {
              const terminated = isRunnerTerminated(runner);
              const removable = canRemoveRunner(runners, runner);
              return (
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
                    <Inline gap="xs">
                      <RunnerStatusBadge status={runner.status} />
                      {terminated && (
                        <Badge tone="danger" title={t('page.runners.terminatedHint')}>
                          {t('page.runners.terminated')}
                        </Badge>
                      )}
                    </Inline>
                  </DataCell>
                  <DataCell label={columns.heartbeat}>
                    <Text tone="muted">{heartbeatAge(runner.lastHeartbeatAt)}</Text>
                  </DataCell>
                  <DataCell label={columns.registered}>
                    <Text tone="muted">{new Date(runner.registeredAt).toLocaleString()}</Text>
                  </DataCell>
                  {canManageRunners && (
                    <DataCell label={columns.actions}>
                      <Inline gap="xs">
                        {!terminated && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!removable}
                            title={removable ? undefined : t('page.runners.lastRunnerBlocked')}
                            onClick={() => { setActionError(null); setActionTarget({ runner, action: 'terminate' }); }}
                          >
                            {t('page.runners.terminate')}
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={!removable}
                          title={removable ? undefined : t('page.runners.lastRunnerBlocked')}
                          onClick={() => { setActionError(null); setActionTarget({ runner, action: 'delete' }); }}
                        >
                          {t('page.runners.delete')}
                        </Button>
                      </Inline>
                    </DataCell>
                  )}
                </tr>
              );
            })}
            {visibleRunners.length === 0 && (
              <TableEmpty columns={columnCount}>
                <EmptyState
                  title={runners.length === 0 ? t('page.runners.noRunners') : t('page.runners.noMatch')}
                />
              </TableEmpty>
            )}
          </tbody>
        </DataTable>
        </div>
      )}

      <Dialog
        open={actionTarget != null}
        onClose={closeAction}
        title={actionTarget?.action === 'delete' ? t('page.runners.deleteTitle') : t('page.runners.terminateTitle')}
        warning={
          actionTarget?.action === 'delete' ? t('page.runners.deleteWarning') : undefined
        }
        dismissOnBackdrop={false}
        footer={
          <Inline gap="sm">
            <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={actionTarget?.action === 'delete' ? 'danger' : 'primary'}
              busy={actionBusy}
              busyLabel={t('common.saving')}
              onClick={() => { void runAction(); }}
            >
              {actionTarget?.action === 'delete' ? t('page.runners.delete') : t('page.runners.terminate')}
            </Button>
          </Inline>
        }
      >
        <Stack gap="md">
          <Text size="body" tone="muted">
            {actionTarget?.action === 'delete' ? t('page.runners.deleteHint') : t('page.runners.terminateHint')}
          </Text>
          {actionTarget && (
            <Text size="body" tone="strong">
              {actionTarget.runner.name} · <Mono>{actionTarget.runner.hostname}</Mono>
            </Text>
          )}
          {actionError && <Alert tone="error">{actionError}</Alert>}
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
