import { useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';
import { StatusBadge } from '../components/StatusBadge.js';

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

  // A test print puts paper through a real device: `busy` must block a second
  // click, and a failure must say why instead of "Failed to send test print."
  const testPrint = useApiAction(async () => {
    await apiFetch(`/printers/${id}/test-print`, { method: 'POST' });
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
      <div>
        <h1 className="page-title">{t('page.printerDetail.title')}</h1>
        <LoadingState />
      </div>
    );
  }

  if (!printer) {
    // Previously `.catch(() => {})` then a bare "Printer not found." — a
    // permission denial and an unreachable API both read as "no such printer".
    return (
      <div>
        <h1 className="page-title">{t('page.printerDetail.title')}</h1>
        <ErrorState
          error={printerResource.error ?? new Error(t('page.printerDetail.notFound'))}
          title={t('page.printerDetail.loadFailed')}
          onRetry={printerResource.refresh}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0 }}>
          {t('page.printerDetail.title')}: {printer.name}
        </h1>
        <Freshness
          lastSuccessAt={printerResource.lastSuccessAt}
          stale={printerResource.stale}
          refreshing={printerResource.refreshing}
          onRefresh={printerResource.refresh}
        />
      </div>

      {message && (
        <Alert
          tone={message.tone === 'ok' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('error.dismiss')}
        >
          {message.text}
        </Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0, marginBottom: '1rem' }}>
            {t('page.printerDetail.configuration')}
          </h2>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem', margin: 0, fontSize: '0.875rem' }}>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>{t('page.printers.code')}</dt>
            <dd style={{ margin: 0, fontWeight: 600, fontFamily: 'monospace' }}>{printer.code}</dd>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>{t('page.printers.protocol')}</dt>
            <dd style={{ margin: 0 }}>{printer.protocol}</dd>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>{t('page.printerDetail.connectionUri')}</dt>
            <dd style={{ margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}>{printer.connectionUri}</dd>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>{t('page.printerDetail.department')}</dt>
            <dd style={{ margin: 0 }}>{printer.department ?? t('common.noData')}</dd>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>{t('page.printers.location')}</dt>
            <dd style={{ margin: 0 }}>{printer.location ?? t('common.noData')}</dd>
          </dl>
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0, marginBottom: '1rem' }}>
            {t('page.printerDetail.liveStatus')}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <StatusBadge status={printer.status?.code ?? 'UNKNOWN'} size="md" />
            <span style={{ fontSize: '0.875rem', color: 'var(--neutral-text-muted)' }}>
              {t('page.printerDetail.lastSeen')}:{' '}
              {printer.status?.lastSeenAt
                ? new Date(printer.status.lastSeenAt).toLocaleString()
                : t('status.never')}
            </span>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--neutral-text)' }}>
            {printer.status?.text ?? t('page.printerDetail.noExtendedStatus')}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem' }}>
        <Button variant="secondary" onClick={() => void runRefreshStatus()} busy={refreshStatus.pending}>
          {t('page.printerDetail.getStatus')}
        </Button>
        <Button onClick={() => void runTestPrint()} busy={testPrint.pending} busyLabel={t('page.printerDetail.testPrintSending')}>
          {t('page.printerDetail.testPrint')}
        </Button>
      </div>
    </div>
  );
}
