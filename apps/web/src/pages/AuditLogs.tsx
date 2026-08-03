import { useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import {
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorState,
  Freshness,
  LoadingState,
  Mono,
  PageLayout,
  TableEmpty,
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

  const columns = {
    time: t('page.auditLogs.time'),
    action: t('page.auditLogs.action'),
    actor: t('page.auditLogs.actor'),
    resource: t('page.auditLogs.resource'),
    resourceId: t('page.auditLogs.resourceId'),
  };

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
        <DataTable label={t('page.auditLogs.title')} responsive>
          <thead>
            <tr>
              <DataHead>{columns.time}</DataHead>
              <DataHead>{columns.action}</DataHead>
              <DataHead>{columns.actor}</DataHead>
              <DataHead>{columns.resource}</DataHead>
              <DataHead>{columns.resourceId}</DataHead>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <DataCell label={columns.time}>
                  <Text size="label" tone="muted" nowrap>{new Date(l.occurredAt).toLocaleString()}</Text>
                </DataCell>
                <DataCell label={columns.action}>
                  <Mono weight="semibold">{l.action}</Mono>
                </DataCell>
                <DataCell label={columns.actor}>
                  <Text tone="muted">{l.actorId?.slice(0, 8) ?? t('common.noData')}</Text>
                </DataCell>
                <DataCell label={columns.resource}>
                  <Text>{l.resourceType}</Text>
                </DataCell>
                {/* Was `color: '#888'` — 2.8:1 on white, and this is the value an
                    operator reads back to support. It carries the full id in a
                    title so truncation stays recoverable. */}
                <DataCell label={columns.resourceId}>
                  <Mono tone="muted" title={l.resourceId}>{l.resourceId.slice(0, 12)}…</Mono>
                </DataCell>
              </tr>
            ))}
            {logs.length === 0 && (
              <TableEmpty columns={5}>
                <EmptyState title={t('page.auditLogs.noLogs')} />
              </TableEmpty>
            )}
          </tbody>
        </DataTable>
      )}
    </PageLayout>
  );
}
