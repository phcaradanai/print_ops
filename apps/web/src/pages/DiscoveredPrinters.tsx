import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { connectionTypeLabel } from '../lib/deviceHealth.js';
import { NetworkPrinterSearch } from '../features/printer-discovery/network-printer-search.js';
import {
  Alert,
  Badge,
  Button,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Freshness,
  Inline,
  LoadingState,
  Mono,
  PageLayout,
  ResourceToolbar,
  SelectFilter,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

interface DiscoveredPrinter {
  id: string;
  runnerId: string;
  localPrinterName: string;
  driverName?: string;
  portName?: string;
  connectionType: string;
  isDefault: boolean;
  isShared: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  registeredPrinterId?: string;
}

export default function DiscoveredPrinters() {
  const { t } = useLocale();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pendingRegister, setPendingRegister] = useState<DiscoveredPrinter | null>(null);

  const fetchPrinters = useCallback(() => apiFetch<DiscoveredPrinter[]>('/v1/discovered-printers'), []);
  const printersResource = useApiResource(fetchPrinters);
  const printers = printersResource.data ?? [];

  // Discovery registration filter. Shares the toolbar anatomy with the other
  // device pages; unlike Runners/Printers there is no health contract here —
  // discovery is metadata about what the runner sees, so the honest split is
  // registered vs not-yet-registered.
  const [registrationFilter, setRegistrationFilter] = useState<'ALL' | 'REGISTERED' | 'UNREGISTERED'>('ALL');
  const unregisteredCount = printers.filter((p) => !p.registeredPrinterId).length;
  const registeredCount = printers.length - unregisteredCount;
  const visiblePrinters = registrationFilter === 'ALL'
    ? printers
    : printers.filter(
        (p) => (registrationFilter === 'REGISTERED') === Boolean(p.registeredPrinterId),
      );

  const register = useApiAction(async (printer: DiscoveredPrinter) => {
    await apiFetch(`/v1/discovered-printers/${printer.id}/register`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    printersResource.refresh();
    return printer.localPrinterName;
  });

  const confirmRegister = async () => {
    if (!pendingRegister) return;
    const printer = pendingRegister;
    setPendingRegister(null);
    const name = await register.run(printer);
    setMessage(
      name
        ? { tone: 'ok', text: t('page.discovery.registerSuccess').replace('{name}', name) }
        : {
            tone: 'error',
            text: t('page.discovery.registerError').replace('{message}', errorMessage(register.getError(), t('page.discovery.unknownError'))),
          },
    );
  };

  const formatTime = (iso: string) => new Date(iso).toLocaleString();

  const columns = {
    name: t('page.discovery.printerName'),
    driver: t('page.discovery.driver'),
    port: t('page.discovery.port'),
    connection: t('page.discovery.connection'),
    runner: t('page.discovery.runner'),
    lastSeen: t('page.discovery.lastSeen'),
    status: t('page.discovery.status'),
    action: t('page.discovery.action'),
    registration: t('page.discovery.filterRegistration'),
  };
  return (
    <PageLayout
      title={t('page.discovery.title')}
      description={t('page.discovery.description')}
      width="full"
      density="compact"
      actions={<Freshness
          lastSuccessAt={printersResource.lastSuccessAt}
          stale={printersResource.stale}
          refreshing={printersResource.refreshing}
          onRefresh={printersResource.refresh}
        />}
    >

      <NetworkPrinterSearch onResults={printersResource.refresh} />

      {/* Tone was previously inferred by string-matching the message against a
          translated prefix — it broke the moment either string changed. */}
      {message && (
        <Alert
          tone={message.tone === 'ok' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('error.dismiss')}
        >
          {message.text}
        </Alert>
      )}

      {printersResource.loading && !printersResource.data && <LoadingState label={t('page.discovery.loading')} />}

      {printersResource.error != null && !printersResource.data && (
        <ErrorState
          error={printersResource.error}
          title={t('page.discovery.failedToFetch')}
          onRetry={printersResource.refresh}
        />
      )}

      {!printersResource.loading && printersResource.error == null && printers.length === 0 && (
        <EmptyState title={t('page.discovery.empty')} />
      )}

      {printers.length > 0 && (
        <div className="ui-table-card">
          <ResourceToolbar ariaLabel={columns.registration}>
            <SelectFilter
              label={columns.registration}
              value={registrationFilter}
              onValueChange={(value) => setRegistrationFilter(value as 'ALL' | 'REGISTERED' | 'UNREGISTERED')}
            >
              <option value="ALL">{t('page.discovery.filterAll')} ({printers.length})</option>
              <option value="UNREGISTERED">{t('page.discovery.filterUnregistered')} ({unregisteredCount})</option>
              <option value="REGISTERED">{t('page.discovery.filterRegistered')} ({registeredCount})</option>
            </SelectFilter>
          </ResourceToolbar>
          <DataTable label={t('page.discovery.title')} responsive>
          <thead>
            <tr>
              <DataHead>{columns.name}</DataHead>
              <DataHead>{columns.driver}</DataHead>
              <DataHead>{columns.port}</DataHead>
              <DataHead>{columns.connection}</DataHead>
              <DataHead>{columns.runner}</DataHead>
              <DataHead>{columns.lastSeen}</DataHead>
              <DataHead>{columns.status}</DataHead>
              <DataHead>{columns.action}</DataHead>
            </tr>
          </thead>
          <tbody>
            {visiblePrinters.map((p) => (
              <tr key={p.id}>
                {/* Long device names are clipped on desktop but carry the full
                    string in `title`, and the responsive card view shows them
                    in full — so the value is never unrecoverable. */}
                <DataCell label={columns.name}>
                  <Inline gap="xs">
                    <Text weight="medium" tone="strong" truncate title={p.localPrinterName}>
                      {p.localPrinterName}
                    </Text>
                    {p.isDefault && <Text size="label" tone="muted">{t('page.discovery.default')}</Text>}
                  </Inline>
                </DataCell>
                <DataCell label={columns.driver}>
                  <Text tone="muted" truncate title={p.driverName ?? '—'}>{p.driverName ?? '—'}</Text>
                </DataCell>
                <DataCell label={columns.port}>
                  <Mono tone="muted" truncate title={p.portName ?? '—'}>{p.portName ?? '—'}</Mono>
                </DataCell>
                {/* Connection type is metadata. `connectionTypeLabel` shows a
                    recognised type as its short name and an unrecognised one
                    verbatim so the raw value still tells whoever reads it what
                    the agent actually reported. */}
                <DataCell label={columns.connection}>
                  <Badge>{connectionTypeLabel(p.connectionType)}</Badge>
                </DataCell>
                <DataCell label={columns.runner}>
                  <Mono tone="muted" title={p.runnerId}>{p.runnerId.slice(0, 8)}…</Mono>
                </DataCell>
                <DataCell label={columns.lastSeen}>
                  <Text tone="muted" nowrap>{formatTime(p.lastSeenAt)}</Text>
                </DataCell>
                <DataCell label={columns.status}>
                  <Badge tone={p.registeredPrinterId ? 'success' : 'warning'}>
                    {p.registeredPrinterId ? t('status.registered') : t('status.unregistered')}
                  </Badge>
                </DataCell>
                <DataCell label={columns.action} actions>
                  {!p.registeredPrinterId && (
                    <Button
                      size="sm"
                      busy={register.pending}
                      busyLabel={t('page.discovery.registering')}
                      onClick={() => setPendingRegister(p)}
                    >
                      {t('page.discovery.register')}
                    </Button>
                  )}
                </DataCell>
              </tr>
            ))}
            {visiblePrinters.length === 0 && (
              <TableEmpty columns={8}>
                <EmptyState title={t('page.discovery.noMatch')} />
              </TableEmpty>
            )}
          </tbody>
        </DataTable>
        </div>
      )}

      {/* Replaces window.confirm(): a native modal blocks the whole WebView,
          cannot be styled or translated consistently, and is invisible to the
          rest of the app's state. */}
      <Dialog
        open={pendingRegister !== null}
        onClose={() => setPendingRegister(null)}
        title={t('page.discovery.register')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingRegister(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmRegister()} busy={register.pending}>
              {t('page.discovery.register')}
            </Button>
          </>
        }
      >
        {pendingRegister && (
          <Text as="p">{t('page.discovery.confirmRegister').replace('{name}', pendingRegister.localPrinterName)}</Text>
        )}
      </Dialog>
    </PageLayout>
  );
}
