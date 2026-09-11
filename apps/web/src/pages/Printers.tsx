import { useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import {
  Badge,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorState,
  Freshness,
  LoadingState,
  Mono,
  PageLayout,
  StateBadge,
  StatusIndicator,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

interface Printer {
  id: string; code: string; name: string; location?: string;
  protocol: string; isActive: boolean;
  status?: { code: string; checkedAt: string };
  allowedTemplates?: string[]; maxCopiesPerJob?: number;
}

export default function Printers() {
  const { t } = useLocale();
  const fetchPrinters = useCallback(() => apiFetch<Printer[]>('/printers'), []);
  const printersResource = useApiResource(fetchPrinters);
  const printers = printersResource.data ?? [];

  const columns = {
    code: t('page.printers.code'),
    name: t('page.printers.name'),
    location: t('page.printers.location'),
    protocol: t('page.printers.protocol'),
    status: t('page.printers.status'),
    maxCopies: t('page.printers.maxCopies'),
    active: t('page.printers.active'),
  };

  return (
    <PageLayout
      title={t('page.printers.title')}
      width="full"
      density="compact"
      actions={<Freshness
          lastSuccessAt={printersResource.lastSuccessAt}
          stale={printersResource.stale}
          refreshing={printersResource.refreshing}
          onRefresh={printersResource.refresh}
        />}
    >

      {printersResource.loading && !printersResource.data ? (
        <LoadingState />
      ) : printersResource.error != null && !printersResource.data ? (
        <ErrorState
          error={printersResource.error}
          title={t('page.printers.failedToLoad')}
          onRetry={printersResource.refresh}
        />
      ) : (
        <DataTable label={t('page.printers.title')} responsive>
          <thead>
            <tr>
              <DataHead>{columns.code}</DataHead>
              <DataHead>{columns.name}</DataHead>
              <DataHead>{columns.location}</DataHead>
              <DataHead>{columns.protocol}</DataHead>
              <DataHead>{columns.status}</DataHead>
              <DataHead>{columns.maxCopies}</DataHead>
              <DataHead>{columns.active}</DataHead>
            </tr>
          </thead>
          <tbody>
            {printers.map((p) => (
              <tr key={p.id}>
                <DataCell label={columns.code}>
                  <Mono weight="semibold">{p.code}</Mono>
                </DataCell>
                <DataCell label={columns.name}>
                  <Text weight="medium" tone="strong">{p.name}</Text>
                </DataCell>
                <DataCell label={columns.location}>
                  <Text tone="muted">{p.location ?? t('common.noData')}</Text>
                </DataCell>
                <DataCell label={columns.protocol}>
                  <Badge>{p.protocol}</Badge>
                </DataCell>
                {/* The dot colour came from a page-local hex map that
                    DiscoveredPrinters and LocalDiagnostics each duplicated with
                    different values. `StatusIndicator` owns the mapping and
                    always prints the condition as text next to the dot. */}
                <DataCell label={columns.status}>
                  {p.status ? <StatusIndicator condition={p.status.code} /> : <Text tone="muted">{t('common.noData')}</Text>}
                </DataCell>
                <DataCell label={columns.maxCopies}>
                  <Mono>{p.maxCopiesPerJob ?? t('common.noData')}</Mono>
                </DataCell>
                <DataCell label={columns.active}>
                  <StateBadge
                    value={p.isActive}
                    onLabel={t('status.active')}
                    offLabel={t('status.inactive')}
                  />
                </DataCell>
              </tr>
            ))}
            {printers.length === 0 && (
              <TableEmpty columns={7}>
                <EmptyState title={t('page.printers.noPrinters')} />
              </TableEmpty>
            )}
          </tbody>
        </DataTable>
      )}
    </PageLayout>
  );
}
