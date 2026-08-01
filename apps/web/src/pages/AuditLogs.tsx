import { useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { EmptyState, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { PageLayout } from '../components/PageLayout.js';

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

  return (
    <PageLayout
      title={t('page.auditLogs.title')}
      density="compact"
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
        <table className="data-table">
          <thead>
            <tr>
              {[t('page.auditLogs.time'), t('page.auditLogs.action'), t('page.auditLogs.actor'), t('page.auditLogs.resource'), t('page.auditLogs.resourceId')].map((h) => (
                <th key={h} scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={5}><EmptyState title={t('page.auditLogs.noLogs')} /></td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.id}>
                <td style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--neutral-text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(l.occurredAt).toLocaleString()}
                </td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 600 }}>{l.action}</td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{l.actorId?.slice(0, 8) ?? t('common.noData')}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{l.resourceType}</td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#888' }}>
                  {l.resourceId.slice(0, 12)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageLayout>
  );
}
