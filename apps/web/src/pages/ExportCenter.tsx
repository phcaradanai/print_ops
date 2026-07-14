import { useLocale } from '../i18n/index.js';
import { apiDownload } from '../api/client.js';

interface ExportItem {
  label: string; description: string; path: string; filename: string; color: string;
}

const EXPORTS: ExportItem[] = [
  { label: 'page.export.jobsCsv', description: 'page.export.jobsCsvDesc', path: '/exports/jobs.csv', filename: 'jobs.csv', color: '#a6e3a1' },
  { label: 'page.export.jobsJson', description: 'page.export.jobsJsonDesc', path: '/exports/jobs.json', filename: 'jobs.json', color: '#89b4fa' },
  { label: 'page.export.auditCsv', description: 'page.export.auditCsvDesc', path: '/exports/audit.csv', filename: 'audit.csv', color: '#fab387' },
  { label: 'page.export.printerStatusCsv', description: 'page.export.printerStatusCsvDesc', path: '/exports/printers.csv', filename: 'printer-status.csv', color: '#cba6f7' },
];

export default function ExportCenter() {
  const { t } = useLocale();
  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>{t('page.export.title')}</h1>
      <p style={{ color: '#666', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        {t('page.export.description')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
        {EXPORTS.map((item) => (
          <div key={item.label} style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{t(item.label)}</div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1rem' }}>{t(item.description)}</div>
            <button
              onClick={() => apiDownload(item.path, item.filename)}
              style={{
                background: item.color, border: 'none', padding: '0.5rem 1rem',
                borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
              }}
            >
              {t('common.download')} {item.filename}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
