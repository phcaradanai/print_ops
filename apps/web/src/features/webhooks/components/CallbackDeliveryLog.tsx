import { ActionIcon } from '../../../components/ActionIcon.js';
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
  RecordCard,
  RecordHeader,
  RecordList,
  ResourceToolbar,
  SelectFilter,
  Stack,
  TableEmpty,
  Text,
} from '../../../components/ui/index.js';
import { useLocale } from '../../../i18n/index.js';
import { formatWebhookDate } from '../model.js';
import type { CallbackAttempt } from '../types.js';
import type { WebhookWorkspaceController } from '../useWebhookWorkspace.js';

function outcomeTone(outcome: CallbackAttempt['outcome']) {
  if (outcome === 'success') return 'success' as const;
  if (outcome === 'failed') return 'danger' as const;
  return 'neutral' as const;
}

export function CallbackDeliveryLog({ controller }: { controller: WebhookWorkspaceController }) {
  const { locale } = useLocale();
  const {
    t,
    endpoints,
    callbackLogResource,
    logFilters,
    setLogFilters,
    visibleAttempts,
    setSelectedAttempt,
  } = controller;

  const outcomeLabel = (attempt: CallbackAttempt) => attempt.outcome === 'success'
    ? t('page.webhooks.outcomeSuccess')
    : attempt.outcome === 'failed'
      ? t('page.webhooks.outcomeFailed')
      : t('page.webhooks.outcomeSkipped');

  return (
    <Stack gap="md" className="webhook-delivery-history">
      <ResourceToolbar
        ariaLabel={t('page.webhooks.deliveryFilters')}
        actions={
          <IconButton
            label={t('common.refresh')}
            disabled={callbackLogResource.loading || callbackLogResource.refreshing}
            onClick={callbackLogResource.refresh}
          >
            <ActionIcon name="refresh" />
          </IconButton>
        }
      >
        <Checkbox
          label={t('page.webhooks.failedOnly')}
          checked={logFilters.failedOnly}
          onChange={(event) => setLogFilters({ ...logFilters, failedOnly: event.target.checked })}
        />
        <SelectFilter
          label={t('page.webhooks.transportFilter')}
          value={logFilters.transport}
          onValueChange={(value) => setLogFilters({ ...logFilters, transport: value as typeof logFilters.transport })}
        >
          <option value="all">{t('page.webhooks.allTransports')}</option>
          <option value="HTTP">HTTP</option>
          <option value="NATS">NATS</option>
        </SelectFilter>
        <SelectFilter
          label={t('page.webhooks.endpointFilter')}
          value={logFilters.endpointId}
          onValueChange={(value) => setLogFilters({ ...logFilters, endpointId: value })}
        >
          <option value="">{t('page.webhooks.allEndpointsOption')}</option>
          {endpoints.map((endpoint) => (
            <option key={endpoint.id} value={endpoint.id}>{endpoint.endpointCode} — {endpoint.name}</option>
          ))}
        </SelectFilter>
        <SelectFilter
          label={t('page.webhooks.triggerFilter')}
          value={logFilters.trigger}
          onValueChange={(value) => setLogFilters({ ...logFilters, trigger: value as typeof logFilters.trigger })}
        >
          <option value="all">{t('page.webhooks.allTraffic')}</option>
          <option value="live">{t('page.webhooks.triggerLive')}</option>
          <option value="test">{t('page.webhooks.triggerTest')}</option>
        </SelectFilter>
      </ResourceToolbar>

      <Card padding="none">
        <div className="webhook-delivery-table">
          <DataTable label={t('page.webhooks.callbackLogTitle')}>
            <thead>
              <tr>
                <DataHead>{t('page.webhooks.colTime')}</DataHead>
                <DataHead>{t('page.webhooks.endpoint')}</DataHead>
                <DataHead>{t('page.webhooks.colChannel')}</DataHead>
                <DataHead>{t('page.webhooks.colTrigger')}</DataHead>
                <DataHead>{t('page.webhooks.colOutcome')}</DataHead>
                <DataHead>{t('page.webhooks.colHttpStatus')}</DataHead>
                <DataHead>{t('page.webhooks.colDuration')}</DataHead>
                <DataHead>{t('page.webhooks.target')}</DataHead>
                <DataHead>{t('page.webhooks.actions')}</DataHead>
              </tr>
            </thead>
            <tbody>
              {visibleAttempts.length === 0 ? (
                <TableEmpty columns={9}>
                  <EmptyState title={callbackLogResource.loading
                    ? t('common.loading')
                    : t('page.webhooks.noMatchingHistory')} />
                </TableEmpty>
              ) : visibleAttempts.map((attempt) => (
                <tr key={attempt.id} id={`callback-attempt-${attempt.id}`}>
                  <DataCell><Text size="label" tone="muted">{formatWebhookDate(attempt.occurredAt, locale)}</Text></DataCell>
                  <DataCell><Mono>{attempt.endpointCode}</Mono></DataCell>
                  <DataCell><Badge>{attempt.transport}</Badge></DataCell>
                  <DataCell>{attempt.trigger === 'test' ? t('page.webhooks.triggerTest') : t('page.webhooks.triggerLive')}</DataCell>
                  <DataCell><Badge tone={outcomeTone(attempt.outcome)}>{outcomeLabel(attempt)}</Badge></DataCell>
                  <DataCell><Mono>{attempt.httpStatus ?? '—'}</Mono></DataCell>
                  <DataCell><Mono>{attempt.durationMs} ms</Mono></DataCell>
                  <DataCell><Mono className="webhook-technical-summary">{attempt.target || '—'}</Mono></DataCell>
                  <DataCell actions>
                    <Button size="sm" variant="secondary" onClick={() => setSelectedAttempt(attempt)}>
                      {t('page.webhooks.viewDetails')}
                    </Button>
                  </DataCell>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>

        <RecordList className="webhook-delivery-cards">
          {visibleAttempts.length === 0 ? (
            <RecordCard className="webhook-empty-record">
              <EmptyState title={t('page.webhooks.noMatchingHistory')} />
            </RecordCard>
          ) : visibleAttempts.map((attempt) => (
            <RecordCard key={attempt.id} id={`callback-attempt-card-${attempt.id}`}>
              <RecordHeader>
                <Stack gap="xs">
                  <Mono>{attempt.endpointCode}</Mono>
                  <Text size="label" tone="muted">{formatWebhookDate(attempt.occurredAt, locale)}</Text>
                </Stack>
                <Badge tone={outcomeTone(attempt.outcome)}>{outcomeLabel(attempt)}</Badge>
              </RecordHeader>
              <div className="webhook-record-grid">
                <div><Text size="label" tone="muted">{t('page.webhooks.colChannel')}</Text><Badge>{attempt.transport}</Badge></div>
                <div><Text size="label" tone="muted">{t('page.webhooks.colTrigger')}</Text><Text>{attempt.trigger === 'test' ? t('page.webhooks.triggerTest') : t('page.webhooks.triggerLive')}</Text></div>
                <div><Text size="label" tone="muted">{t('page.webhooks.colDuration')}</Text><Mono>{attempt.durationMs} ms</Mono></div>
                <div><Text size="label" tone="muted">{t('page.webhooks.target')}</Text><Mono className="webhook-technical-summary">{attempt.target || '—'}</Mono></div>
              </div>
              <Inline gap="sm">
                <Button variant="secondary" onClick={() => setSelectedAttempt(attempt)}>
                  {t('page.webhooks.viewDetails')}
                </Button>
              </Inline>
            </RecordCard>
          ))}
        </RecordList>
      </Card>
    </Stack>
  );
}
