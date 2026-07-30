import { useState } from 'react';
import { useLocale } from '../i18n/index.js';
import { apiDownload } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';

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
  const [activeFilename, setActiveFilename] = useState<string | null>(null);

  // `onClick={() => apiDownload(...)}` returned a floating promise: a failed
  // export (permission denied, API down) was an unhandled rejection and a
  // button that appeared to do nothing at all.
  const download = useApiAction(async (item: ExportItem) => {
    await apiDownload(item.path, item.filename);
    return item.filename;
  });

  const run = async (item: ExportItem) => {
    setActiveFilename(item.filename);
    await download.run(item);
    setActiveFilename(null);
  };

  return (
    <div>
      <h1 className="page-title">{t('page.export.title')}</h1>
      <p style={{ color: '#666', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        {t('page.export.description')}
      </p>

      {download.error != null && (
        <Alert
          tone="error"
          title={t('page.export.failed')}
          onDismiss={download.reset}
          dismissLabel={t('error.dismiss')}
        >
          {errorMessage(download.error)}
        </Alert>
      )}

      {download.result != null && download.error == null && (
        <Alert tone="success" onDismiss={download.reset} dismissLabel={t('error.dismiss')}>
          {t('page.export.succeeded').replace('{file}', download.result)}
        </Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
        {EXPORTS.map((item) => (
          <div key={item.label} style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{t(item.label)}</div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1rem' }}>{t(item.description)}</div>
            <Button
              variant="secondary"
              onClick={() => void run(item)}
              busy={download.pending && activeFilename === item.filename}
              busyLabel={t('page.export.downloading')}
              style={{ background: item.color, borderColor: item.color }}
            >
              {t('common.download')} {item.filename}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
