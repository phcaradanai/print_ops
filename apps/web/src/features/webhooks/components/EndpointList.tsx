import { ActionIcon } from '../../../components/ActionIcon.js';
import { TransferIcon } from '../../../components/TransferIcon.js';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  IconButton,
  Inline,
  Mono,
  Pagination,
  RecordCard,
  RecordHeader,
  RecordList,
  ResourceToolbar,
  SearchField,
  Select,
  SelectFilter,
  Stack,
  TableEmpty,
  Text,
  Toolbar,
} from '../../../components/ui/index.js';
import { useLocale } from '../../../i18n/index.js';
import { formatWebhookDate } from '../model.js';
import type { Endpoint, EndpointStatusFilter } from '../types.js';
import type { WebhookWorkspaceController } from '../useWebhookWorkspace.js';

function policyLabel(controller: WebhookWorkspaceController, endpoint: Endpoint): string {
  const policy = controller.policies.find((item) => item.id === endpoint.routePolicyId);
  return policy ? `${policy.policyCode} — ${policy.name}` : endpoint.routePolicyId || '—';
}

export function EndpointList({
  controller,
  onImportRequested,
}: {
  controller: WebhookWorkspaceController;
  onImportRequested: () => void;
}) {
  const { locale } = useLocale();
  const {
    t,
    endpoints,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    filteredEndpoints,
    pagedEndpoints,
    selectedIds,
    selectedEndpoints,
    allPageSelected,
    toggleSelect,
    toggleSelectPage,
    setSelectedIds,
    openEdit,
    testCallback,
    toggleEndpoint,
    setDetailsEndpoint,
    setPendingDelete,
    setBatchDeleteOpen,
    exportEndpoints,
  } = controller;

  const actionLabel = (endpoint: Endpoint) =>
    t('page.webhooks.actionsFor').replace('{code}', endpoint.endpointCode);

  const actions = (endpoint: Endpoint, compact = false) => (
    <Toolbar label={actionLabel(endpoint)} align="end" className={compact ? 'webhook-record-actions' : ''}>
      <Button size="sm" variant="secondary" onClick={() => setDetailsEndpoint(endpoint)}>
        <ActionIcon name="link" /> {t('page.webhooks.viewDetails')}
      </Button>
      <IconButton
        size="sm"
        label={`${t('page.webhooks.testCallbackTitle')} ${endpoint.endpointCode}`}
        onClick={() => void testCallback(endpoint)}
      >
        <ActionIcon name="play" />
      </IconButton>
      <IconButton
        size="sm"
        label={`${t('page.webhooks.edit')} ${endpoint.endpointCode}`}
        onClick={() => openEdit(endpoint)}
      >
        <ActionIcon name="edit" />
      </IconButton>
      <IconButton
        size="sm"
        label={`${endpoint.enabled ? t('page.webhooks.setDraftTitle') : t('page.webhooks.enableTitle')} ${endpoint.endpointCode}`}
        onClick={() => void toggleEndpoint(endpoint)}
      >
        <ActionIcon name={endpoint.enabled ? 'pause' : 'check'} />
      </IconButton>
      <IconButton
        size="sm"
        variant="danger"
        label={`${t('page.webhooks.deleteTitle')} ${endpoint.endpointCode}`}
        onClick={() => setPendingDelete(endpoint)}
      >
        <ActionIcon name="delete" />
      </IconButton>
    </Toolbar>
  );

  return (
    <Stack gap="md" className={selectedIds.length > 0 ? 'webhook-list webhook-list--selection-active' : 'webhook-list'}>
      <ResourceToolbar
        ariaLabel={t('page.webhooks.resourceToolbar')}
        actions={
          <Inline gap="sm" className="webhook-toolbar-actions">
            <Button variant="ghost" onClick={onImportRequested}>
              <TransferIcon action="import" /> {t('page.webhooks.import')}
            </Button>
            <Button variant="ghost" onClick={() => void exportEndpoints('all')}>
              <TransferIcon action="export" /> {t('page.webhooks.exportAll')}
            </Button>
            <Button variant="ghost" onClick={() => void exportEndpoints('filtered')}>
              <TransferIcon action="export" /> {t('page.webhooks.exportFiltered')}
            </Button>
          </Inline>
        }
      >
        <SearchField
          label={t('page.webhooks.searchLabel')}
          value={search}
          onValueChange={setSearch}
          placeholder={t('page.webhooks.searchPlaceholder')}
          leading={<ActionIcon name="search" />}
        />
        <SelectFilter
          label={t('page.webhooks.statusFilterLabel')}
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as EndpointStatusFilter)}
        >
          <option value="all">{t('page.webhooks.statusAllOption')}</option>
          <option value="enabled">{t('page.webhooks.statusEnabled')}</option>
          <option value="draft">{t('page.webhooks.statusDraft')}</option>
          <option value="no_callback">{t('page.webhooks.statusNoCallback')}</option>
        </SelectFilter>
      </ResourceToolbar>

      <Card className="webhook-endpoint-surface">
        <div className="webhook-endpoint-table">
          <DataTable label={t('page.webhooks.allEndpoints')}>
            <thead>
              <tr>
                <DataHead>
                  <Checkbox
                    hideLabel
                    label={t('page.webhooks.selectAllOnPage')}
                    checked={allPageSelected}
                    disabled={pagedEndpoints.length === 0}
                    onChange={toggleSelectPage}
                  />
                </DataHead>
                <DataHead>{t('page.webhooks.endpointIdentity')}</DataHead>
                <DataHead>{t('page.webhooks.source')}</DataHead>
                <DataHead>{t('page.webhooks.auth')}</DataHead>
                <DataHead>{t('page.webhooks.routePolicy')}</DataHead>
                <DataHead>{t('page.webhooks.enabled')}</DataHead>
                <DataHead>{t('page.webhooks.callbackTransport')}</DataHead>
                <DataHead>{t('page.webhooks.updatedAt')}</DataHead>
                <DataHead>{t('page.webhooks.actions')}</DataHead>
              </tr>
            </thead>
            <tbody>
              {pagedEndpoints.length === 0 ? (
                <TableEmpty columns={9}>
                  <EmptyState title={endpoints.length === 0 ? t('page.webhooks.noCallbackHistory') : t('page.webhooks.noResults')} />
                </TableEmpty>
              ) : pagedEndpoints.map((endpoint) => (
                <tr key={endpoint.id} data-selected={selectedIds.includes(endpoint.id) || undefined}>
                  <DataCell>
                    <Checkbox
                      hideLabel
                      label={`${t('page.webhooks.endpoint')} ${endpoint.endpointCode}`}
                      checked={selectedIds.includes(endpoint.id)}
                      onChange={() => toggleSelect(endpoint.id)}
                    />
                  </DataCell>
                  <DataCell>
                    <Stack gap="xs">
                      <Text weight="semibold">{endpoint.name}</Text>
                      <Mono>{endpoint.endpointCode}</Mono>
                    </Stack>
                  </DataCell>
                  <DataCell>{endpoint.sourceSystem || 'integration-service'}</DataCell>
                  <DataCell><Mono>{endpoint.authMode || 'NONE'}</Mono></DataCell>
                  <DataCell>{policyLabel(controller, endpoint)}</DataCell>
                  <DataCell>
                    <Badge tone={endpoint.enabled ? 'success' : 'neutral'}>
                      {endpoint.enabled ? t('page.webhooks.statusEnabled') : t('page.webhooks.statusDraft')}
                    </Badge>
                  </DataCell>
                  <DataCell>
                    <Badge tone={endpoint.callbackTransport === 'NONE' ? 'neutral' : 'info'}>
                      {endpoint.callbackTransport === 'NONE'
                        ? t('page.webhooks.transport.none')
                        : endpoint.callbackTransport}
                    </Badge>
                  </DataCell>
                  <DataCell><Text size="label" tone="muted">{formatWebhookDate(endpoint.updatedAt ?? endpoint.createdAt, locale)}</Text></DataCell>
                  <DataCell actions>{actions(endpoint)}</DataCell>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>

        <RecordList className="webhook-endpoint-cards">
          {pagedEndpoints.length === 0 ? (
            <RecordCard><EmptyState title={t('page.webhooks.noResults')} /></RecordCard>
          ) : pagedEndpoints.map((endpoint) => (
            <RecordCard key={endpoint.id} data-selected={selectedIds.includes(endpoint.id) || undefined}>
              <RecordHeader>
                <Inline gap="sm">
                  <Checkbox
                    hideLabel
                    label={`${t('page.webhooks.endpoint')} ${endpoint.endpointCode}`}
                    checked={selectedIds.includes(endpoint.id)}
                    onChange={() => toggleSelect(endpoint.id)}
                  />
                  <Stack gap="xs">
                    <Text weight="semibold">{endpoint.name}</Text>
                    <Mono>{endpoint.endpointCode}</Mono>
                  </Stack>
                </Inline>
                <Badge tone={endpoint.enabled ? 'success' : 'neutral'}>
                  {endpoint.enabled ? t('page.webhooks.statusEnabled') : t('page.webhooks.statusDraft')}
                </Badge>
              </RecordHeader>
              <div className="webhook-record-grid">
                <div><Text size="label" tone="muted">{t('page.webhooks.source')}</Text><Text>{endpoint.sourceSystem}</Text></div>
                <div><Text size="label" tone="muted">{t('page.webhooks.callbackTransport')}</Text><Badge>{endpoint.callbackTransport}</Badge></div>
                <div><Text size="label" tone="muted">{t('page.webhooks.routePolicy')}</Text><Text>{policyLabel(controller, endpoint)}</Text></div>
                <div><Text size="label" tone="muted">{t('page.webhooks.updatedAt')}</Text><Text>{formatWebhookDate(endpoint.updatedAt ?? endpoint.createdAt, locale)}</Text></div>
              </div>
              {actions(endpoint, true)}
            </RecordCard>
          ))}
        </RecordList>

        <div className="webhook-pagination-row">
          <Text size="label" tone="muted">
            {t('page.webhooks.paginationSummary')
              .replace('{from}', String(filteredEndpoints.length === 0 ? 0 : (page - 1) * pageSize + 1))
              .replace('{to}', String(Math.min(page * pageSize, filteredEndpoints.length)))
              .replace('{total}', String(filteredEndpoints.length))}
          </Text>
          <Inline gap="sm">
            <Pagination
              ariaLabel={t('page.webhooks.allEndpoints')}
              page={page}
              totalPages={totalPages}
              previousLabel={t('page.jobQueue.previous')}
              nextLabel={t('page.jobQueue.next')}
              status={t('page.webhooks.pageStatus').replace('{page}', String(page)).replace('{total}', String(totalPages))}
              onPrevious={() => setPage(page - 1)}
              onNext={() => setPage(page + 1)}
            />
            <Select
              aria-label={t('page.webhooks.perPage').replace('{n}', String(pageSize))}
              controlSize="sm"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              {[5, 10, 20, 50].map((size) => (
                <option key={size} value={size}>{t('page.webhooks.perPage').replace('{n}', String(size))}</option>
              ))}
            </Select>
          </Inline>
        </div>
      </Card>

      {selectedIds.length > 0 && (
        <div className="webhook-selection-actions" role="region" aria-label={t('page.webhooks.selectedActions')}>
          <Text weight="semibold">{t('page.webhooks.selectCount').replace('{n}', String(selectedIds.length))}</Text>
          <Inline gap="sm" className="webhook-selection-actions__buttons">
            <Button variant="secondary" onClick={() => void exportEndpoints('selected')}>
              <TransferIcon action="export" /> {t('page.webhooks.exportSelected')}
            </Button>
            <Button variant="ghost" onClick={() => setSelectedIds([])}>{t('page.webhooks.clearSelection')}</Button>
            <Button variant="danger" onClick={() => setBatchDeleteOpen(true)}>
              <ActionIcon name="delete" /> {t('page.webhooks.deleteSelected')}
            </Button>
          </Inline>
          <span className="ui-visually-hidden">{selectedEndpoints.map((endpoint) => endpoint.endpointCode).join(', ')}</span>
        </div>
      )}
    </Stack>
  );
}
