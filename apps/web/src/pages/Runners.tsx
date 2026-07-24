import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

interface Runner {
  id: string; name: string; hostname: string; ipAddress?: string;
  status: string; supportedProtocols: string[];
  lastHeartbeatAt?: string; registeredAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  online: '#a6e3a1', offline: '#f38ba8', busy: '#fab387', draining: '#f9e2af',
};

export default function Runners() {
  const { t } = useLocale();
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(true);

  const heartbeatAge = (ts?: string): string => {
    if (!ts) return t('status.never');
    const ms = Date.now() - new Date(ts).getTime();
    if (ms < 60000) return t('status.secondsAgo').replace('{n}', String(Math.round(ms / 1000)));
    if (ms < 3600000) return t('status.minutesAgo').replace('{n}', String(Math.round(ms / 60000)));
    return t('status.hoursAgo').replace('{n}', String(Math.round(ms / 3600000)));
  };

  useEffect(() => {
    apiFetch<Runner[]>('/runners')
      .then((data) => { setRunners(data); setLoading(false); })
      .catch(() => setLoading(false));
    const iv = setInterval(() => {
      apiFetch<Runner[]>('/runners').then(setRunners).catch(() => {});
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div>
      <h1 className="page-title">{t('page.runners.title')}</h1>
      {loading ? <p className="loading-text">{t('common.loading')}</p> : (
        <table className="data-table">
          <thead>
            <tr>
              {[t('page.runners.name'), t('page.runners.hostname'), t('page.runners.protocols'), t('page.runners.status'), t('page.runners.lastHeartbeat'), t('page.runners.registered')].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runners.length === 0 && (
              <tr><td colSpan={6} className="loading-text" style={{ padding: "2rem", textAlign: "center" }}>{t('page.runners.noRunners')}</td></tr>
            )}
            {runners.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: '0.75rem', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>{r.hostname}</td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{r.supportedProtocols.join(', ')}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[r.status] ?? '#9399b2', display: 'inline-block' }} />
                    {r.status}
                  </span>
                </td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{heartbeatAge(r.lastHeartbeatAt)}</td>
                <td style={{ color: "var(--neutral-text-muted)" }}>{new Date(r.registeredAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
