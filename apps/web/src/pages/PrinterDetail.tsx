import { useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiFetchVoid } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import {
  Alert,
  Button,
  ErrorBanner,
  ErrorState,
  CardDetailItem,
  CardDetail,
  Freshness,
  Grid,
  Inline,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  Stack,
  StatusIndicator,
  Text,
} from '../components/ui/index.js';

interface PrinterStatus {
  code: string;
  text?: string;
  lastSeenAt?: string;
}

interface Printer {
  id: string;
  code: string;
  name: string;
  protocol: string;
  connectionUri: string;
  maxCopiesPerJob?: number;
  location?: string;
  department?: string;
  status: PrinterStatus;
}

export default function PrinterDetail() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const fetchPrinter = useCallback(() => apiFetch<Printer>(`/printers/${id}`), [id]);
  const printerResource = useApiResource(fetchPrinter, { enabled: Boolean(id) });
  const printer = printerResource.data ?? null;

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  // A test print puts paper through a real device. The endpoint's response body
  // is intentionally not a frontend contract, so use the explicit void helper.
  const testPrint = useApiAction(async () => {
    await apiFetchVoid(`/printers/${id}/test-print`, { method: 'POST' });
    return true;
  });

  const refreshStatus = useApiAction(async () => {
    await apiFetch<PrinterStatus>(`/printers/${id}/status`);
    // Re-read the printer instead of merging a partial status into local state:
    // the server is the source of truth for what it just observed.
    printerResource.refresh();
    return true;
  });

  const runTestPrint = async () => {
    const ok = await testPrint.run();
    setMessage(
      ok
        ? { tone: 'ok', text: t('page.printerDetail.testPrintSent') }
        : { tone: 'error', text: `${t('page.printerDetail.testPrintFailed')} ${errorMessage(testPrint.getError())}` },
    );
  };

  const runRefreshStatus = async () => {
    const ok = await refreshStatus.run();
    setMessage(
      ok
        ? { tone: 'ok', text: t('page.printerDetail.statusUpdated') }
        : { tone: 'error', text: `${t('page.printerDetail.statusFailed')} ${errorMessage(refreshStatus.getError())}` },
    );
  };

  if (printerResource.loading && !printer) {
    return (
      <PageLayout width="standard" title={t('page.printerDetail.title')}>
        <LoadingState />
      </PageLayout>
    );
  }

  if (!printer) {
    return (
      <PageLayout width="standard" title={t('page.printerDetail.title')}>
        <ErrorState
          error={printerResource.error ?? new Error(t('page.printerDetail.notFound'))}
          title={t('page.printerDetail.loadFailed')}
          onRetry={printerResource.refresh}
        />
      </PageLayout>
    );
  }

  const statusCode = printer.status?.code ?? 'unknown';

  return (
    <PageLayout
      width="standard"
      title={`${t('page.printerDetail.title')}: ${printer.name}`}
      actions={<Freshness
          lastSuccessAt={printerResource.lastSuccessAt}
          stale={printerResource.stale}
          refreshing={printerResource.refreshing}
          paused={printerResource.paused}
          onRefresh={printerResource.refresh}
        />}
      footer={
        <>
          <Button variant="secondary" onClick={() => void runRefreshStatus()} busy={refreshStatus.pending}>
            {t('page.printerDetail.getStatus')}
          </Button>
          <Button onClick={() => void runTestPrint()} busy={testPrint.pending} busyLabel={t('page.printerDetail.testPrintSending')}>
            {t('page.printerDetail.testPrint')}
          </Button>
        </>
      }
    >

      {printerResource.stale && printerResource.error != null && (
        <ErrorBanner
          error={printerResource.error}
          title={t('error.refresh.title')}
          onRetry={printerResource.refresh}
        />
      )}

      {message && (
        <Alert
          tone={message.tone === 'ok' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('error.dismiss')}
        >
          {message.text}
        </Alert>
      )}

      <Grid columns={2}>
        <Panel title={t('page.printerDetail.configuration')}>
          <CardDetail>
            <CardDetailItem label={t('page.printers.code')}>
              <Mono weight="semibold">{printer.code}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('page.printers.protocol')}>{printer.protocol}</CardDetailItem>
            <CardDetailItem label={t('page.printerDetail.connectionUri')}>
              <Mono>{printer.connectionUri}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('page.printerDetail.department')}>
              {printer.department ?? t('common.noData')}
            </CardDetailItem>
            <CardDetailItem label={t('page.printers.location')}>
              {printer.location ?? t('common.noData')}
            </CardDetailItem>
          </CardDetail>
        </Panel>

        <Panel title={t('page.printerDetail.liveStatus')}>
          <Stack gap="md">
            {/* This page carried a third copy of the device-status colour map,
                disagreeing with the two on Printers and LocalDiagnostics. */}
            <Inline gap="lg">
              <StatusIndicator condition={statusCode} />
              <Text tone="muted">
                {t('page.printerDetail.lastSeen')}:{' '}
                {printer.status?.lastSeenAt
                  ? new Date(printer.status.lastSeenAt).toLocaleString()
                  : t('status.never')}
              </Text>
            </Inline>
            <Text as="p">
              {printer.status?.text ?? t('page.printerDetail.noExtendedStatus')}
            </Text>
          </Stack>
        </Panel>
      </Grid>
    </PageLayout>
  );
}
