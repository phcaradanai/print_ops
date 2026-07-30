import { useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { EmptyState, ErrorState, Freshness, LoadingState } from '../components/PageState.js';

interface Printer {
  id: string; code: string; name: string; location?: string;
  protocol: string; isActive: boolean;
  status?: { code: string; checkedAt: string };
  allowedTemplates?: string[]; maxCopiesPerJob?: number;
}

/** Live-status dot. This is printer reachability, NOT a print-job status — it
 *  deliberately does not go through <StatusBadge />, which paints job statuses. */
const STATUS_DOT: Record<string, string> = {
  idle: '#a6e3a1', online: '#a6e3a1', busy: '#fab387',
  offline: '#f38ba8', error: '#f38ba8', unknown: '#9399b2',
};

export default function Printers() {
  const { t } = useLocale();
  const fetchPrinters = useCallback(() => apiFetch<Printer[]>('/printers'), []);
  const printersResource = useApiResource(fetchPrinters);
  const printers = printersResource.data ?? [];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.printers.title')}</h1>
        <Freshness
          lastSuccessAt={printersResource.lastSuccessAt}
          stale={printersResource.stale}
          refreshing={printersResource.refreshing}
          onRefresh={printersResource.refresh}
        />
      </div>

      {printersResource.loading && !printersResource.data ? (
        <LoadingState />
      ) : printersResource.error != null && !printersResource.data ? (
        <ErrorState
          error={printersResource.error}
          title={t('page.printers.failedToLoad')}
          onRetry={printersResource.refresh}
        />
      ) : (
        <table className="data-table">
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
                <td>{p.name}</td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{p.location ?? t('common.noData')}</td>
                <td style={{ fontFamily: "monospace" }}>{p.protocol}</td>
                <td>
                  {p.status ? (
                    <span className="status-indicator">
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[p.status.code] ?? '#ccc', display: 'inline-block' }} />
                      {p.status.code}
                    </span>
                  ) : t('common.noData')}
                </td>
                <td>{p.maxCopiesPerJob ?? t('common.noData')}</td>
                <td>
                  <span style={{ color: p.isActive ? '#40a02b' : '#f38ba8', fontWeight: 600, fontSize: '0.85rem' }}>
                    {p.isActive ? t('status.active') : t('status.inactive')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
