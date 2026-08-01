import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { EmptyState, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';
import { FormField } from '../components/FormField.js';

interface Binding { id: string; printerCode: string; templateCode: string; paperProfileId: string; isDefault: boolean; enabled: boolean }

type BindingForm = { printerCode: string; templateCode: string; paperProfileId: string; isDefault: boolean };

export default function PrinterBindings() {
  const { t } = useLocale();
  const [form, setForm] = useState<BindingForm>({
    printerCode: 'LAB_LABEL_01',
    templateCode: 'LAB_LABEL_DEFAULT',
    paperProfileId: '',
    isDefault: true,
  });

  const fetchBindings = useCallback(() => apiFetch<Binding[]>('/v1/printer-template-bindings'), []);
  const bindingsResource = useApiResource(fetchBindings);
  const bindings = bindingsResource.data ?? [];

  // A binding decides which paper profile a printer uses — a failed create that
  // reported nothing left the operator believing the binding existed.
  const createBinding = useApiAction(async (values: BindingForm) => {
    const created = await apiFetch<Binding>('/v1/printer-template-bindings', {
      method: 'POST',
      body: JSON.stringify({ ...values, enabled: true }),
    });
    bindingsResource.refresh();
    return created;
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.bindings.title')}</h1>
        <Freshness
          lastSuccessAt={bindingsResource.lastSuccessAt}
          stale={bindingsResource.stale}
          refreshing={bindingsResource.refreshing}
          onRefresh={bindingsResource.refresh}
        />
      </div>

      {createBinding.error != null && (
        <Alert
          tone="error"
          title={t('page.bindings.createFailed')}
          onDismiss={createBinding.reset}
          dismissLabel={t('error.dismiss')}
        >
          {errorMessage(createBinding.error)}
        </Alert>
      )}

      {createBinding.result != null && createBinding.error == null && (
        <Alert tone="success" onDismiss={createBinding.reset} dismissLabel={t('error.dismiss')}>
          {t('page.bindings.createSucceeded')}
        </Alert>
      )}

      <section style={{ background: '#fff', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, alignItems: 'end' }}>
          {(['printerCode', 'templateCode', 'paperProfileId'] as const).map((key) => (
            <FormField key={key} label={t(`page.bindings.${key}`)}>
              {(control) => (
                <input
                  {...control}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              )}
            </FormField>
          ))}
          <label>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />{' '}
            {t('page.bindings.default')}
          </label>
          <Button onClick={() => void createBinding.run(form)} busy={createBinding.pending}>
            {t('common.bind')}
          </Button>
        </div>
      </section>

      <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        {bindingsResource.loading && !bindingsResource.data ? (
          <LoadingState />
        ) : bindingsResource.error != null && !bindingsResource.data ? (
          <ErrorState error={bindingsResource.error} onRetry={bindingsResource.refresh} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[t('page.bindings.printer'), t('page.bindings.template'), t('page.bindings.paper'), t('page.bindings.default'), t('page.bindings.enabled')].map((h) => (
                  <th key={h} scope="col" style={{ padding: 10, textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bindings.length === 0 && (
                <tr><td colSpan={5}><EmptyState title={t('page.bindings.noBindings')} /></td></tr>
              )}
              {bindings.map((b) => (
                <tr key={b.id}>
                  <td style={{ padding: 10 }}>{b.printerCode}</td>
                  <td style={{ padding: 10 }}>{b.templateCode}</td>
                  <td style={{ padding: 10 }}>{b.paperProfileId.slice(0, 8)}</td>
                  <td style={{ padding: 10 }}>{b.isDefault ? t('page.bindings.isDefault') : t('page.bindings.notDefault')}</td>
                  <td style={{ padding: 10 }}>{b.enabled ? t('status.enabled') : t('status.disabled')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
