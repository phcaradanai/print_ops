import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorState,
  FormField,
  Freshness,
  Grid,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  Stack,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

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

  const columns = {
    printer: t('page.bindings.printer'),
    template: t('page.bindings.template'),
    paper: t('page.bindings.paper'),
    default: t('page.bindings.default'),
    enabled: t('page.bindings.enabled'),
  };

  return (
    <PageLayout
      title={t('page.bindings.title')}
      density="compact"
      actions={<Freshness
          lastSuccessAt={bindingsResource.lastSuccessAt}
          stale={bindingsResource.stale}
          refreshing={bindingsResource.refreshing}
          onRefresh={bindingsResource.refresh}
        />}
    >

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

      <Stack gap="xl">
        <Panel
          title={t('page.bindings.title')}
          footer={
            <Button onClick={() => void createBinding.run(form)} busy={createBinding.pending}>
              {t('common.bind')}
            </Button>
          }
        >
          <Stack gap="lg">
            <Grid columns={3}>
              {(['printerCode', 'templateCode', 'paperProfileId'] as const).map((key) => (
                <FormField key={key} label={t(`page.bindings.${key}`)}>
                  {(control) => (
                    <Input
                      {...control}
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  )}
                </FormField>
              ))}
            </Grid>
            {/* Was a bare `<label><input type=checkbox>` with a text node beside
                it — no shared control, no description slot, no touch sizing. */}
            <Checkbox
              label={t('page.bindings.default')}
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
          </Stack>
        </Panel>

        {bindingsResource.loading && !bindingsResource.data ? (
          <LoadingState />
        ) : bindingsResource.error != null && !bindingsResource.data ? (
          <ErrorState error={bindingsResource.error} onRetry={bindingsResource.refresh} />
        ) : (
          <DataTable label={t('page.bindings.title')} responsive>
            <thead>
              <tr>
                <DataHead>{columns.printer}</DataHead>
                <DataHead>{columns.template}</DataHead>
                <DataHead>{columns.paper}</DataHead>
                <DataHead>{columns.default}</DataHead>
                <DataHead>{columns.enabled}</DataHead>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr key={b.id}>
                  <DataCell label={columns.printer}>
                    <Mono weight="semibold">{b.printerCode}</Mono>
                  </DataCell>
                  <DataCell label={columns.template}>
                    <Mono>{b.templateCode}</Mono>
                  </DataCell>
                  <DataCell label={columns.paper}>
                    <Mono tone="muted" title={b.paperProfileId}>{b.paperProfileId.slice(0, 8)}</Mono>
                  </DataCell>
                  <DataCell label={columns.default}>
                    {b.isDefault
                      ? <Badge tone="info">{t('page.bindings.isDefault')}</Badge>
                      : <Text tone="muted">{t('page.bindings.notDefault')}</Text>}
                  </DataCell>
                  <DataCell label={columns.enabled}>
                    <Badge tone={b.enabled ? 'success' : 'neutral'}>
                      {b.enabled ? t('status.enabled') : t('status.disabled')}
                    </Badge>
                  </DataCell>
                </tr>
              ))}
              {bindings.length === 0 && (
                <TableEmpty columns={5}>
                  <EmptyState title={t('page.bindings.noBindings')} />
                </TableEmpty>
              )}
            </tbody>
          </DataTable>
        )}
      </Stack>
    </PageLayout>
  );
}
