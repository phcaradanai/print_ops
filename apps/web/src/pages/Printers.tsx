import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Printer[]>('/printers')
      .then((data) => { setPrinters(data); setLoading(false); })
      .catch((err) => {
        console.error('[Printers] API failed', err);
        setError(err instanceof Error ? err.message : t('page.printers.failedToLoad'));
        setLoading(false);
      });
  }, [t]);

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>{t('page.printers.title')}</h1>
      {loading ? <p style={{ color: '#888' }}>{t('common.loading')}</p> : error ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: '#f38ba8', marginBottom: '0.5rem' }}>{t('page.printers.failedToLoad')}</p>
          <p style={{ color: '#888', fontSize: '0.85rem' }}>{error}</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              {[t('page.printers.code'), t('page.printers.name'), t('page.printers.location'), t('page.printers.protocol'), t('page.printers.status'), t('page.printers.maxCopies'), t('page.printers.active')].map((h) => (
                <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.8rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {printers.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>{t('page.printers.noPrinters')}</td></tr>
            )}
            {printers.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontWeight: 600 }}>{p.code}</td>
                <td style={{ padding: '0.75rem' }}>{p.name}</td>
                <td style={{ padding: '0.75rem', color: '#666', fontSize: '0.85rem' }}>{p.location ?? t('common.noData')}</td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.protocol}</td>
                <td style={{ padding: '0.75rem' }}>
                  {p.status ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[p.status.code] ?? '#ccc', display: 'inline-block' }} />
                      {p.status.code}
                    </span>
                  ) : t('common.noData')}
                </td>
                <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>{p.maxCopiesPerJob ?? t('common.noData')}</td>
                <td style={{ padding: '0.75rem' }}>
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
