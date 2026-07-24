import { useParams } from 'react-router-dom';
import { useLocale } from '../i18n/index.js';

export default function PrinterDetail() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <h1>{t('page.printerDetail.title')}</h1>
      <p className="loading-text">{t('page.printerDetail.printerId')}: <code>{id}</code></p>
      <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
        <button style={{ background: '#89b4fa', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}>{t('page.printerDetail.getStatus')}</button>
        <button style={{ background: '#a6e3a1', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}>{t('page.printerDetail.testPrint')}</button>
      </div>
      <p style={{ marginTop: '2rem', color: '#888' }}>{t('page.printerDetail.placeholder')}</p>
    </div>
  );
}
