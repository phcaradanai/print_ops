import { useCallback, useMemo } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { DataGrid, type DataGridColumn } from '../components/organisms/DataGrid/index.js';
import {
  EmptyState,
  ErrorState,
  Freshness,
  LoadingState,
  Mono,
  PageLayout,
  Text,
} from '../components/ui/index.js';

interface AuditLog {
  id: string; action: string; actorId?: string;
  resourceType: string; resourceId: string;
  occurredAt: string; traceId: string;
  metadata?: Record<string, unknown>;
}

export default function AuditLogs() {
  const { t } = useLocale();
  const fetchLogs = useCallback(() => apiFetch<AuditLog[]>('/audit-logs?limit=100'), []);
  const logsResource = useApiResource(fetchLogs);
  const logs = logsResource.data ?? [];

  const columns = useMemo<Array<DataGridColumn<AuditLog>>>(
    () => [
      {
        id: 'time',
        header: t('page.auditLogs.time'),
        // Sorted on the raw ISO timestamp, never the formatted string — a
        // locale-formatted date sorts alphabetically, which is not chronological.
        sortValue: (l) => l.occurredAt,
        cell: (l) => (
          <Text size="label" tone="muted" nowrap>{new Date(l.occurredAt).toLocaleString()}</Text>
        ),
      },
      {
        id: 'action',
        header: t('page.auditLogs.action'),
        sortValue: (l) => l.action,
        cell: (l) => <Mono weight="semibold">{l.action}</Mono>,
      },
      {
        id: 'actor',
        header: t('page.auditLogs.actor'),
        sortValue: (l) => l.actorId ?? null,
        cell: (l) => <Text tone="muted">{l.actorId?.slice(0, 8) ?? t('common.noData')}</Text>,
      },
      {
        id: 'resource',
        header: t('page.auditLogs.resource'),
        sortValue: (l) => l.resourceType,
        cell: (l) => <Text>{l.resourceType}</Text>,
      },
      {
        id: 'resourceId',
        header: t('page.auditLogs.resourceId'),
        // Truncated for width but carries the full id in a title: this is the
        // value an operator reads back to support, so it stays recoverable.
        cell: (l) => <Mono tone="muted" title={l.resourceId}>{l.resourceId.slice(0, 12)}…</Mono>,
      },
    ],
    [t],
  );

  return (
    <PageLayout
      title={t('page.auditLogs.title')}
      density="compact"
      width="full"
      actions={<Freshness
          lastSuccessAt={logsResource.lastSuccessAt}
          stale={logsResource.stale}
          refreshing={logsResource.refreshing}
          onRefresh={logsResource.refresh}
        />}
    >

      {logsResource.loading && !logsResource.data ? (
        <LoadingState />
      ) : logsResource.error != null && !logsResource.data ? (
        // Previously `.catch(() => setLoading(false))`: a failed load rendered
        // an empty table, i.e. "this system has no audit history".
        <ErrorState error={logsResource.error} onRetry={logsResource.refresh} />
      ) : (
        <DataGrid
          label={t('page.auditLogs.title')}
          columns={columns}
          rows={logs}
          rowId={(l) => l.id}
          responsive
          initialSort={{ id: 'time', desc: true }}
          sortLabel={(header) => t('common.sortBy').replace('{column}', header)}
          empty={<EmptyState title={t('page.auditLogs.noLogs')} />}
        />
      )}
    </PageLayout>
  );
}
