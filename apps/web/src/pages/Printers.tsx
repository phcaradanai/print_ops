import { useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { EmptyState, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { PageLayout } from '../components/PageLayout.js';

interface Printer {
  id: string; code: string; name: string; location?: string;
  protocol: string; isActive: boolean;
  status?: { code: string; checkedAt: string };
  allowedTemplates?: string[]; maxCopiesPerJob?: number;
}

/** Dot fill colors — darker ink tones that match the status-indicator border/text palette */
const STATUS_DOT: Record<string, string> = {
  idle: '#2f732a', online: '#2f732a', busy: '#c2410c',
  offline: '#9f1239', error: '#9f1239', unknown: '#374151',
};

export default function Printers() {
  const { t } = useLocale();
  const fetchPrinters = useCallback(() => apiFetch<Printer[]>('/printers'), []);
  const printersResource = useApiResource(fetchPrinters);
  const printers = printersResource.data ?? [];

  return (
    <PageLayout
      title={t('page.printers.title')}
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
        <>
        <table className="data-table printer-table">
          <thead>
            <tr>
              {[t('page.printers.code'), t('page.printers.name'), t('page.printers.location'), t('page.printers.protocol'), t('page.printers.status'), t('page.printers.maxCopies'), t('page.printers.active')].map((h) => (
                <th key={h} scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {printers.length === 0 && (
              <tr><td colSpan={7}><EmptyState title={t('page.printers.noPrinters')} /></td></tr>
            )}
            {printers.map((p) => (
              <tr key={p.id}>
                <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{p.code}</td>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{p.location ?? t('common.noData')}</td>
                <td>
                  <span className="protocol-badge">{p.protocol}</span>
                </td>
                <td>
                  {p.status ? (
                    <span className={`status-indicator status-indicator--${p.status.code}`}>
                      <span className="status-dot" style={{ background: STATUS_DOT[p.status.code] ?? '#9399b2' }} />
                      <span className="status-indicator-text">{p.status.code}</span>
                    </span>
                  ) : t('common.noData')}
                </td>
                <td style={{ fontFamily: "monospace" }}>{p.maxCopiesPerJob ?? t('common.noData')}</td>
                <td>
                  <span className={`active-badge ${p.isActive ? 'active-badge--active' : 'active-badge--inactive'}`}>
                    {p.isActive ? t('status.active') : t('status.inactive')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="resource-record-list printer-record-list" aria-label={t('page.printers.title')}>
          {printers.length === 0 ? (
            <li><EmptyState title={t('page.printers.noPrinters')} /></li>
          ) : printers.map((p) => (
            <li key={p.id} className="resource-record">
              <div className="resource-record__heading">
                <div>
                  <strong>{p.name}</strong>
                  <code>{p.code}</code>
                </div>
                <span className={`active-badge ${p.isActive ? 'active-badge--active' : 'active-badge--inactive'}`}>
                  {p.isActive ? t('status.active') : t('status.inactive')}
                </span>
              </div>
              <dl className="resource-record__facts">
                <div><dt>{t('page.printers.location')}</dt><dd>{p.location ?? t('common.noData')}</dd></div>
                <div><dt>{t('page.printers.protocol')}</dt><dd><span className="protocol-badge">{p.protocol}</span></dd></div>
                <div><dt>{t('page.printers.status')}</dt><dd>{p.status ? <span className={`status-indicator status-indicator--${p.status.code}`}><span className="status-dot" style={{ background: STATUS_DOT[p.status.code] ?? '#9399b2' }} /><span className="status-indicator-text">{p.status.code}</span></span> : t('common.noData')}</dd></div>
                <div><dt>{t('page.printers.maxCopies')}</dt><dd><code>{p.maxCopiesPerJob ?? t('common.noData')}</code></dd></div>
              </dl>
            </li>
          ))}
        </ul>
        </>
      )}
    </PageLayout>
  );
}
