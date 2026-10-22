import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionIcon } from '../components/ActionIcon.js';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { printerHealth } from '../lib/deviceHealth.js';
import {
  Badge,
  Button,
  Inline,
  SearchField,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorState,
  Freshness,
  LoadingState,
  Mono,
  PageLayout,
  ResourceToolbar,
  SelectFilter,
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
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const printersResource = useApiResource(fetchPrinters);
  const printers = printersResource.data ?? [];

  // Health buckets are mutually exclusive and share lib/deviceHealth with the
  // dashboard attention strip: "ready" here is exactly what the strip counts
  // as not needing attention. An unknown or never-reported condition is NOT
  // ready — it needs eyes at the printer detail page.
  const [healthFilter, setHealthFilter] = useState<'ALL' | 'READY' | 'ATTENTION'>('ALL');
  const readyCount = printers.filter(
    (p) => printerHealth(p.isActive, p.status?.code) === 'ready',
  ).length;
  const attentionCount = printers.length - readyCount;
  const normalizedSearch = search.trim().toLowerCase();
  const visiblePrinters = printers.filter((p) => {
    if (healthFilter === 'READY' && printerHealth(p.isActive, p.status?.code) !== 'ready') return false;
    if (healthFilter === 'ATTENTION' && printerHealth(p.isActive, p.status?.code) !== 'attention') return false;
    if (!normalizedSearch) return true;
    return `${p.code} ${p.name ?? ''} ${p.location ?? ''}`.toLowerCase().includes(normalizedSearch);
  });
  const columns = {
    code: t('page.printers.code'),
    name: t('page.printers.name'),
    location: t('page.printers.location'),
    protocol: t('page.printers.protocol'),
    status: t('page.printers.status'),
    maxCopies: t('page.printers.maxCopies'),
    active: t('page.printers.active'),
    health: t('page.printers.filterHealth'),
  };

  return (
    <PageLayout
      title={t('page.printers.title')}
      description={t('page.printers.subtitle')}
      width="full"
      density="compact"
      actions={
        <Inline gap="sm">
          <Button variant="secondary" onClick={() => navigate('/discovered-printers')}>
            <ActionIcon name="search" /> {t('page.printers.discover')}
          </Button>
          <Freshness
            lastSuccessAt={printersResource.lastSuccessAt}
            stale={printersResource.stale}
            refreshing={printersResource.refreshing}
            onRefresh={printersResource.refresh}
          />
        </Inline>
      }
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
        <div className="ui-table-card">
          <ResourceToolbar ariaLabel={columns.health}>
            <SearchField
              label={t('page.printers.search')}
              placeholder={t('page.printers.searchPlaceholder')}
              value={search}
              onValueChange={setSearch}
            />
            <SelectFilter
              label={columns.health}
              value={healthFilter}
              onValueChange={(value) => setHealthFilter(value as 'ALL' | 'READY' | 'ATTENTION')}
            >
              <option value="ALL">{t('page.printers.filterAll')} ({printers.length})</option>
              <option value="READY">{t('page.printers.filterReady')} ({readyCount})</option>
              <option value="ATTENTION">{t('page.printers.filterAttention')} ({attentionCount})</option>
            </SelectFilter>
          </ResourceToolbar>
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
            {visiblePrinters.map((p) => (
              <tr key={p.id}>
                <DataCell label={columns.code}>
                  <Link className="ui-link" to={`/printers/${p.id}`}>
                    <Mono weight="semibold">{p.code}</Mono>
                  </Link>
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
                  <Mono nowrap>{p.maxCopiesPerJob ?? t('common.noData')}</Mono>
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
            {visiblePrinters.length === 0 && (
              <TableEmpty columns={7}>
                <EmptyState
                  title={printers.length === 0 ? t('page.printers.noPrinters') : t('page.printers.noMatch')}
                />
              </TableEmpty>
            )}
          </tbody>
        </DataTable>
        </div>
      )}
    </PageLayout>
  );
}
