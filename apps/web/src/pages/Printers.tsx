import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState.js';

interface Printer {
  id: string; code: string; name: string; location?: string;
  protocol: string; isActive: boolean;
  status?: { code: string; checkedAt: string };
  allowedTemplates?: string[]; maxCopiesPerJob?: number;
}

const STATUS_DOT: Record<string, string> = {
  idle: '#a6e3a1', online: '#a6e3a1', busy: '#fab387',
  offline: '#f38ba8', error: '#f38ba8', unknown: '#9399b2',
};

export default function Printers() {
  const { t } = useLocale();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  // Keep the thrown value, not a flattened string: ErrorState reads status,
  // code and trace id off it (apiFetch already logged it).
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<Printer[]>('/printers')
      .then((data) => { setPrinters(data); setLoading(false); })
      .catch((err: unknown) => { setError(err); setLoading(false); });
  }, []);

  useEffect(load, [load]);

  return (
    <div>
      <h1 className="page-title">{t('page.printers.title')}</h1>
      {loading ? <LoadingState /> : error ? (
        <ErrorState error={error} title={t('page.printers.failedToLoad')} onRetry={load} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {[t('page.printers.code'), t('page.printers.name'), t('page.printers.location'), t('page.printers.protocol'), t('page.printers.status'), t('page.printers.maxCopies'), t('page.printers.active')].map((h) => (
                <th key={h}>{h}</th>
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
