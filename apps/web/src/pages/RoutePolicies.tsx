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

interface Policy { id: string; policyCode: string; name: string; enabled: boolean }

const DEFAULT_POLICY = `{
  "policyCode": "lab-label-static-2",
  "name": "Lab Label Static",
  "matchRules": { "when": [{ "field": "type", "op": "eq", "value": "lab_label" }] },
  "printerMapping": { "strategy": "static", "printer_code": "LAB_LABEL_01" },
  "templateMapping": { "strategy": "static", "template_code": "LAB_LABEL_DEFAULT" },
  "payloadMapping": { "barcode": "$.barcode", "label": "$.label", "hn_masked": "$.hn" },
  "priorityMapping": { "strategy": "static", "priority": "normal" },
  "enabled": true
}`;

export default function RoutePolicies() {
  const { t } = useLocale();
  const [raw, setRaw] = useState(DEFAULT_POLICY);

  const fetchPolicies = useCallback(() => apiFetch<Policy[]>('/v1/webhook-route-policies'), []);
  const policiesResource = useApiResource(fetchPolicies);
  const policies = policiesResource.data ?? [];

  // `create()` used to be an un-awaited async call with no catch at all: an
  // invalid policy body produced an unhandled promise rejection and a button
  // that looked like it had done nothing.
  const createPolicy = useApiAction(async (body: string) => {
    const created = await apiFetch<Policy>('/v1/webhook-route-policies', { method: 'POST', body });
    policiesResource.refresh();
    return created;
  });

  // Local JSON check first, so a typo is reported here instead of as a 400.
  const jsonError = (() => {
    try {
      JSON.parse(raw);
      return null;
    } catch (err: unknown) {
      return errorMessage(err, t('page.routePolicies.invalidJson'));
    }
  })();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.routePolicies.title')}</h1>
        <Freshness
          lastSuccessAt={policiesResource.lastSuccessAt}
          stale={policiesResource.stale}
          refreshing={policiesResource.refreshing}
          onRefresh={policiesResource.refresh}
        />
      </div>

      {createPolicy.error != null && (
        <Alert
          tone="error"
          title={t('page.routePolicies.createFailed')}
          onDismiss={createPolicy.reset}
          dismissLabel={t('error.dismiss')}
        >
          {errorMessage(createPolicy.error)}
        </Alert>
      )}

      {createPolicy.result != null && createPolicy.error == null && (
        <Alert tone="success" onDismiss={createPolicy.reset} dismissLabel={t('error.dismiss')}>
          {t('page.routePolicies.createSucceeded').replace('{code}', createPolicy.result.policyCode)}
        </Alert>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <FormField label={t('page.routePolicies.policyJson')} error={jsonError ?? undefined}>
            {(control) => (
              <textarea
                {...control}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={16}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
            )}
          </FormField>
          <Button
            onClick={() => void createPolicy.run(raw)}
            busy={createPolicy.pending}
            busyLabel={t('page.jobQueue.reprintSubmitting')}
            disabled={jsonError !== null}
          >
            {t('page.routePolicies.createPolicy')}
          </Button>
        </div>

        <div style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>{t('page.routePolicies.policies')}</h2>
          {policiesResource.loading && !policiesResource.data ? (
            <LoadingState />
          ) : policiesResource.error != null && !policiesResource.data ? (
            <ErrorState error={policiesResource.error} onRetry={policiesResource.refresh} />
          ) : policies.length === 0 ? (
            <EmptyState title={t('page.routePolicies.noPolicies')} />
          ) : (
            policies.map((p) => (
              <p key={p.id}>
                <code>{p.policyCode}</code> {p.name} {p.enabled ? t('status.enabled') : t('status.disabled')}
              </p>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
