import { useCallback, useState, type FormEvent } from 'react';
import { apiFetch, getCurrentUser } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useLocale } from '../i18n/index.js';
import { Button, Input, Card } from './ui/index.js';

type ServiceAccount = {
  id: string;
  name: string;
  sourceSystem: string;
  apiKeyPrefix: string;
  isActive: boolean;
  updatedAt: string;
};

export function ServiceAccountSettings() {
  const { t } = useLocale();
  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (user.role !== 'OWNER') return { owner: false, accounts: [] as ServiceAccount[] };
    return { owner: true, accounts: await apiFetch<ServiceAccount[]>('/v1/service-accounts') };
  }, []);
  const resource = useApiResource(load);
  const [name, setName] = useState('');
  const [sourceSystem, setSourceSystem] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!resource.data?.owner) return null;

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    try {
      const result = await apiFetch<{ account: ServiceAccount; apiKey: string }>('/v1/service-accounts', {
        method: 'POST',
        body: JSON.stringify({ name, sourceSystem }),
      });
      setIssuedKey(result.apiKey);
      setName('');
      setSourceSystem('');
      await resource.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function rotate(id: string) {
    if (!window.confirm(t('settings.serviceAccounts.rotateConfirm'))) return;
    setBusy(id);
    setError(null);
    try {
      const result = await apiFetch<{ apiKey: string }>(`/v1/service-accounts/${id}/rotate`, { method: 'POST' });
      setIssuedKey(result.apiKey);
      await resource.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm(t('settings.serviceAccounts.revokeConfirm'))) return;
    setBusy(id);
    setError(null);
    try {
      await apiFetch(`/v1/service-accounts/${id}/revoke`, { method: 'POST' });
      await resource.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="settings-section" aria-labelledby="settings-service-accounts-heading">
      <h2 id="settings-service-accounts-heading">{t('settings.serviceAccounts.title')}</h2>
      <p className="settings-hint">{t('settings.serviceAccounts.description')}</p>
      {issuedKey && (
        <div className="login-notice" role="status">
          <strong>{t('settings.serviceAccounts.copyNow')}</strong>
          <div className="settings-hint--mono" style={{ overflowWrap: 'anywhere', marginTop: '0.5rem' }}>{issuedKey}</div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(issuedKey)}>
              {t('settings.serviceAccounts.copy')}
            </Button>
            <Button variant="secondary" onClick={() => setIssuedKey(null)}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      )}
      {error && <div className="login-error" role="alert">{error}</div>}
      <form onSubmit={(event) => void create(event)}>
        <div className="settings-field">
          <label htmlFor="service-account-name">{t('settings.serviceAccounts.name')}</label>
          <Input id="service-account-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div className="settings-field">
          <label htmlFor="service-account-source">{t('settings.serviceAccounts.source')}</label>
          <Input id="service-account-source" value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} placeholder="hospital-system" required />
        </div>
        <div className="settings-actions">
          <Button type="submit" busy={busy !== null} disabled={busy !== null}>
            {t('settings.serviceAccounts.create')}
          </Button>
        </div>
      </form>
      {resource.data.accounts.map((account) => (
        <div key={account.id} className="settings-hint settings-hint--mono" style={{ marginTop: '0.75rem' }}>
          <strong>{account.name}</strong> · {account.sourceSystem} · {account.apiKeyPrefix}… · {account.isActive ? t('common.active') : t('common.inactive')}
          {account.isActive && (
            <div className="settings-actions" style={{ marginTop: '0.5rem' }}>
              <Button variant="secondary" disabled={busy !== null} busy={busy === account.id} onClick={() => void rotate(account.id)}>
                {t('settings.serviceAccounts.rotate')}
              </Button>
              <Button variant="danger" disabled={busy !== null} busy={busy === account.id} onClick={() => void revoke(account.id)}>
                {t('settings.serviceAccounts.revoke')}
              </Button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
