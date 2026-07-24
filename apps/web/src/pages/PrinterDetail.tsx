import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { getStatusBadgeColors } from '../statusColors.js';

interface Printer {
  id: string;
  code: string;
  name: string;
  protocol: string;
  connectionUri: string;
  maxCopiesPerJob?: number;
  location?: string;
  department?: string;
  status: { code: string; text?: string; lastSeenAt?: string };
}

export default function PrinterDetail() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [printer, setPrinter] = useState<Printer | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    apiFetch<Printer>(`/printers/${id}`)
      .then((data) => { if (active) setPrinter(data); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  const handleTestPrint = async () => {
    try {
      await apiFetch(`/printers/${id}/test-print`, { method: 'POST' });
      setActionMessage({ tone: 'ok', text: t('page.printerDetail.testPrintSent') ?? 'Test print sent successfully.' });
    } catch {
      setActionMessage({ tone: 'error', text: t('page.printerDetail.actionFailed') ?? 'Failed to send test print.' });
    }
  };

  const handleGetStatus = async () => {
    try {
      const statusData = await apiFetch<any>(`/printers/${id}/status`);
      setPrinter(prev => prev ? { ...prev, status: { ...prev.status, ...statusData } } : null);
      setActionMessage({ tone: 'ok', text: 'Status updated.' });
    } catch {
      setActionMessage({ tone: 'error', text: 'Failed to update status.' });
    }
  };

  if (loading) {
    return <div><h1 className="page-title">{t('page.printerDetail.title')}</h1><p className="loading-text">{t('common.loading')}</p></div>;
  }

  if (!printer) {
    return <div><h1 className="page-title">{t('page.printerDetail.title')}</h1><p className="error-text">Printer not found.</p></div>;
  }

  const badgeColors = getStatusBadgeColors(printer.status?.code ?? 'UNKNOWN');

  return (
    <div>
      <h1 className="page-title">{t('page.printerDetail.title')}: {printer.name}</h1>
      
      {actionMessage && (
        <div style={{
          padding: '1rem', 
          marginBottom: '1rem', 
          borderRadius: '8px', 
          background: actionMessage.tone === 'ok' ? '#dcfce7' : '#fee2e2',
          color: actionMessage.tone === 'ok' ? '#166534' : '#991b1b',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>{actionMessage.text}</span>
          <button type="button" onClick={() => setActionMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: 'inherit' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0, marginBottom: '1rem' }}>Configuration</h2>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem', margin: 0, fontSize: '0.875rem' }}>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>Code</dt>
            <dd style={{ margin: 0, fontWeight: 600, fontFamily: 'monospace' }}>{printer.code}</dd>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>Protocol</dt>
            <dd style={{ margin: 0 }}>{printer.protocol}</dd>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>Connection URI</dt>
            <dd style={{ margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}>{printer.connectionUri}</dd>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>Department</dt>
            <dd style={{ margin: 0 }}>{printer.department ?? '—'}</dd>
            <dt style={{ color: 'var(--neutral-text-muted)' }}>Location</dt>
            <dd style={{ margin: 0 }}>{printer.location ?? '—'}</dd>
          </dl>
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0, marginBottom: '1rem' }}>Live Status</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ 
              background: badgeColors.bg, 
              color: badgeColors.text, 
              padding: '4px 12px', 
              borderRadius: '6px', 
              fontSize: '0.875rem', 
              fontWeight: 600 
            }}>
              {printer.status?.code ?? 'UNKNOWN'}
            </span>
            <span style={{ fontSize: '0.875rem', color: 'var(--neutral-text-muted)' }}>
              Last seen: {printer.status?.lastSeenAt ? new Date(printer.status.lastSeenAt).toLocaleString() : 'Never'}
            </span>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--neutral-text)' }}>
            {printer.status?.text ?? 'No extended status available.'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem' }}>
        <button className="btn-secondary" onClick={() => void handleGetStatus()}>
          {t('page.printerDetail.getStatus') ?? 'Refresh Status'}
        </button>
        <button className="btn-primary" onClick={() => void handleTestPrint()}>
          {t('page.printerDetail.testPrint') ?? 'Test Print'}
        </button>
      </div>
    </div>
  );
}
