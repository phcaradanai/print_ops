import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

interface AuditLog {
  id: string; action: string; actorId?: string;
  resourceType: string; resourceId: string;
  occurredAt: string; traceId: string;
  metadata?: Record<string, unknown>;
}

export default function AuditLogs() {
  const { t } = useLocale();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AuditLog[]>('/audit-logs?limit=100')
      .then((data) => { setLogs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>{t('page.auditLogs.title')}</h1>
      {loading ? <p style={{ color: '#888' }}>{t('common.loading')}</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              {[t('page.auditLogs.time'), t('page.auditLogs.action'), t('page.auditLogs.actor'), t('page.auditLogs.resource'), t('page.auditLogs.resourceId')].map((h) => (
                <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.8rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>{t('page.auditLogs.noLogs')}</td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#666', whiteSpace: 'nowrap' }}>
                  {new Date(l.occurredAt).toLocaleString()}
                </td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 600 }}>{l.action}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#666' }}>{l.actorId?.slice(0, 8) ?? t('common.noData')}</td>
                <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{l.resourceType}</td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#888' }}>
                  {l.resourceId.slice(0, 12)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
