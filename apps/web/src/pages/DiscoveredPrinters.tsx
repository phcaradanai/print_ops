import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
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

/**
 * Connection type is metadata, not operational status, so it takes the neutral
 * metadata tag rather than a colour of its own. The previous version assigned
 * each type a hex and rendered it at `color + '20'` — six accent colours that
 * appear nowhere else in the product, carrying no state an operator can act on.
 */
const CONNECTION_LABEL: Record<string, string> = {
  usb: 'USB',
  tcp_ip: 'TCP/IP',
  wsd: 'WSD',
  lpt_com: 'LPT/COM',
  network_share: 'Network Share',
  unknown: 'Unknown',
};

export default function DiscoveredPrinters() {
  const { t } = useLocale();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pendingRegister, setPendingRegister] = useState<DiscoveredPrinter | null>(null);

  const fetchPrinters = useCallback(() => apiFetch<DiscoveredPrinter[]>('/v1/discovered-printers'), []);
  const printersResource = useApiResource(fetchPrinters);
  const printers = printersResource.data ?? [];

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
  };

  return (
    <PageLayout
      title={t('page.discovery.title')}
      description={t('page.discovery.description')}
      density="compact"
      actions={<Freshness
          lastSuccessAt={printersResource.lastSuccessAt}
          stale={printersResource.stale}
          refreshing={printersResource.refreshing}
          onRefresh={printersResource.refresh}
        />}
    >

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
            {printers.map((p) => (
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
                <DataCell label={columns.connection}>
                  <Badge>{CONNECTION_LABEL[p.connectionType] ?? CONNECTION_LABEL['unknown']!}</Badge>
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
          </tbody>
        </DataTable>
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
