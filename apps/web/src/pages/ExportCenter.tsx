import { useState } from 'react';
import { useLocale } from '../i18n/index.js';
import { apiDownload } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { Alert, Button, Grid, PageLayout, Panel } from '../components/ui/index.js';

interface ExportItem { label: string; description: string; path: string; filename: string }

const EXPORTS: ExportItem[] = [
  { label: 'page.export.jobsCsv', description: 'page.export.jobsCsvDesc', path: '/exports/jobs.csv', filename: 'jobs.csv' },
  { label: 'page.export.jobsJson', description: 'page.export.jobsJsonDesc', path: '/exports/jobs.json', filename: 'jobs.json' },
  { label: 'page.export.auditCsv', description: 'page.export.auditCsvDesc', path: '/exports/audit.csv', filename: 'audit.csv' },
  { label: 'page.export.printerStatusCsv', description: 'page.export.printerStatusCsvDesc', path: '/exports/printers.csv', filename: 'printer-status.csv' },
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
    <PageLayout
      width="standard"
      title={t('page.export.title')}
      description={t('page.export.description')}
    >
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

      <Grid columns="auto">
        {EXPORTS.map((item) => (
          <Panel
            key={item.label}
            title={t(item.label)}
            description={t(item.description)}
            padding="lg"
            footer={(
              <Button
                variant="secondary"
                onClick={() => void run(item)}
                busy={download.pending && activeFilename === item.filename}
                busyLabel={t('page.export.downloading')}
              >
                {t('common.download')} {item.filename}
              </Button>
            )}
          >
            <code>{item.filename}</code>
          </Panel>
        ))}
      </Grid>
    </PageLayout>
  );
}
