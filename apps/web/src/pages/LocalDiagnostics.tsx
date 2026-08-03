import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { RunnerStatusBadge } from '../components/RunnerStatusBadge.js';
import {
  Alert,
  Badge,
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
  Mono,
  PageLayout,
  Panel,
  Stack,
  Text,
} from '../components/ui/index.js';

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

  const columns = {
    name: t('page.diagnostics.printerName'),
    driver: t('page.diagnostics.driver'),
    port: t('page.diagnostics.portUri'),
    type: t('page.diagnostics.type'),
    default: t('page.diagnostics.default'),
    lastSeen: t('page.diagnostics.lastSeen'),
    registered: t('page.diagnostics.registered'),
  };

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
      density="compact"
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
        <Text as="p" tone="muted">{t('page.diagnostics.runnersUnavailable')}</Text>
      )}

      <Stack gap="xl">
        {runners.map((runner) => {
          const runnerPrinters = printers.filter((printer) => printer.runnerId === runner.id);
          const meta = runnerPrinters[0];
          const computerName = meta?.computerName ?? runner.hostname;
          const osName = meta?.osName;
          const result = refreshResult[runner.id];

          return (
            <Panel
              key={runner.id}
              title={
                <Inline gap="md">
                  <Text size="title" tone="strong" weight="bold">{runner.name}</Text>
                  <Mono tone="muted" truncate title={computerName}>{computerName}</Mono>
                  {osName && <Badge tone="info">{osName}</Badge>}
                  <RunnerStatusBadge status={runner.status} />
                </Inline>
              }
              actions={
                <Button
                  size="sm"
                  onClick={() => void triggerDiscover(runner.id)}
                  busy={refreshingRunnerId === runner.id}
                  busyLabel={t('page.diagnostics.requesting')}
                  disabled={refreshingRunnerId !== null && refreshingRunnerId !== runner.id}
                >
                  {t('page.diagnostics.refreshDiscovery')}
                </Button>
              }
            >
              <Stack gap="md">
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
                  <Text as="p" tone="muted">
                    {printersResource.data === undefined
                      ? t('page.diagnostics.printersUnavailable')
                      : t('page.diagnostics.noPrinters')}
                  </Text>
                ) : (
                  <DataTable label={`${t('page.diagnostics.title')} — ${runner.name}`} responsive>
                    <thead>
                      <tr>
                        <DataHead>{columns.name}</DataHead>
                        <DataHead>{columns.driver}</DataHead>
                        <DataHead>{columns.port}</DataHead>
                        <DataHead>{columns.type}</DataHead>
                        <DataHead>{columns.default}</DataHead>
                        <DataHead>{columns.lastSeen}</DataHead>
                        <DataHead>{columns.registered}</DataHead>
                      </tr>
                    </thead>
                    <tbody>
                      {runnerPrinters.map((printer) => (
                        <tr key={printer.id}>
                          <DataCell label={columns.name}>
                            <Text weight="semibold" tone="strong" truncate title={printer.localPrinterName}>
                              {printer.localPrinterName}
                            </Text>
                          </DataCell>
                          <DataCell label={columns.driver}>
                            <Text truncate title={printer.driverName ?? '—'}>{printer.driverName ?? '—'}</Text>
                          </DataCell>
                          <DataCell label={columns.port}>
                            <Mono tone="muted" truncate title={printer.portName ?? '—'}>{printer.portName ?? '—'}</Mono>
                          </DataCell>
                          {/* Connection type carried a pastel fill from a page-local
                              map that disagreed with the one on Discovered Printers.
                              It is metadata, so it takes the neutral metadata tag. */}
                          <DataCell label={columns.type}>
                            <Badge>{printer.connectionType}</Badge>
                          </DataCell>
                          {/* Was a bare '✓' glyph, which no screen reader announces
                              and which carries no label in the mobile card view. */}
                          <DataCell label={columns.default}>
                            {printer.isDefault
                              ? <Badge tone="info">{columns.default}</Badge>
                              : <Text tone="muted">{t('common.noData')}</Text>}
                          </DataCell>
                          <DataCell label={columns.lastSeen}>
                            <Text size="label" tone="muted" nowrap>{relativeTime(printer.lastSeenAt)}</Text>
                          </DataCell>
                          <DataCell label={columns.registered}>
                            {printer.registeredPrinterId
                              ? <Badge tone="success">{t('status.registered')}</Badge>
                              : <Text tone="muted">{t('common.noData')}</Text>}
                          </DataCell>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                )}
              </Stack>
            </Panel>
          );
        })}
      </Stack>
    </PageLayout>
  );
}
