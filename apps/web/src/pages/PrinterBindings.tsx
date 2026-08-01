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
  IconButton,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  Stack,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

const EditIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>;
const TrashIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
const PowerIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>;

interface Binding { id: string; printerCode: string; templateCode: string; paperProfileId: string; isDefault: boolean; enabled: boolean }

type BindingForm = { printerCode: string; templateCode: string; paperProfileId: string; isDefault: boolean };

export default function PrinterBindings() {
  const { t } = useLocale();
  const [editingId, setEditingId] = useState<string | null>(null);
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
  const saveBinding = useApiAction(async (values: BindingForm) => {
    if (editingId) {
      await apiFetch<Binding>(`/v1/printer-template-bindings/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify(values),
      });
      setEditingId(null);
    } else {
      await apiFetch<Binding>('/v1/printer-template-bindings', {
        method: 'POST',
        body: JSON.stringify({ ...values, enabled: true }),
      });
    }
    bindingsResource.refresh();
  });

  const deleteBinding = useApiAction(async (id: string) => {
    await apiFetch(`/v1/printer-template-bindings/${id}`, { method: 'DELETE' });
    bindingsResource.refresh();
  });

  const toggleEnabled = useApiAction(async (b: Binding) => {
    await apiFetch(`/v1/printer-template-bindings/${b.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !b.enabled }),
    });
    bindingsResource.refresh();
  });

  const columns = {
    printer: t('page.bindings.printer'),
    template: t('page.bindings.template'),
    paper: t('page.bindings.paper'),
    default: t('page.bindings.default'),
    enabled: t('page.bindings.enabled'),
    actions: t('common.actions', { defaultValue: 'Actions' }),
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

      {saveBinding.error != null && (
        <Alert
          tone="error"
          title={editingId ? t('page.bindings.updateFailed', { defaultValue: 'Failed to update binding' }) : t('page.bindings.createFailed')}
          onDismiss={saveBinding.reset}
          dismissLabel={t('error.dismiss')}
        >
          {errorMessage(saveBinding.error)}
        </Alert>
      )}

      {saveBinding.result != null && saveBinding.error == null && !editingId && (
        <Alert tone="success" onDismiss={saveBinding.reset} dismissLabel={t('error.dismiss')}>
          {t('page.bindings.createSucceeded')}
        </Alert>
      )}

      {deleteBinding.error != null && (
        <Alert tone="error" title={t('common.error', { defaultValue: 'Error' })} onDismiss={deleteBinding.reset} dismissLabel={t('error.dismiss')}>
          {errorMessage(deleteBinding.error)}
        </Alert>
      )}

      {toggleEnabled.error != null && (
        <Alert tone="error" title={t('common.error', { defaultValue: 'Error' })} onDismiss={toggleEnabled.reset} dismissLabel={t('error.dismiss')}>
          {errorMessage(toggleEnabled.error)}
        </Alert>
      )}

      <Stack gap="xl">
        <Panel
          title={editingId ? t('page.bindings.editTitle', { defaultValue: 'Edit Binding' }) : t('page.bindings.title')}
          footer={
            <Stack gap="sm" direction="row">
              <Button onClick={() => void saveBinding.run(form)} busy={saveBinding.pending}>
                {editingId ? t('common.save', { defaultValue: 'Save' }) : t('common.bind')}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={() => {
                  setEditingId(null);
                  setForm({
                    printerCode: 'LAB_LABEL_01',
                    templateCode: 'LAB_LABEL_DEFAULT',
                    paperProfileId: '',
                    isDefault: true,
                  });
                }}>
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
              )}
            </Stack>
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
                <DataHead align="right">{columns.actions}</DataHead>
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
                    <Mono tone="muted" title={b.paperProfileId}>{b.paperProfileId ? b.paperProfileId.slice(0, 8) : ''}</Mono>
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
                  <DataCell label={columns.actions} align="right">
                    <Stack gap="xs" direction="row">
                      <IconButton
                        label={b.enabled ? t('common.deactivate', { defaultValue: 'Deactivate' }) : t('common.activate', { defaultValue: 'Activate' })}
                        variant="ghost"
                        size="sm"
                        onClick={() => void toggleEnabled.run(b)}
                        busy={toggleEnabled.pending && toggleEnabled.lastArgs?.[0]?.id === b.id}
                      >
                        <PowerIcon />
                      </IconButton>
                      <IconButton
                        label={t('common.edit', { defaultValue: 'Edit' })}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(b.id);
                          setForm({
                            printerCode: b.printerCode,
                            templateCode: b.templateCode,
                            paperProfileId: b.paperProfileId,
                            isDefault: b.isDefault,
                          });
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        label={t('common.delete', { defaultValue: 'Delete' })}
                        variant="ghost"
                        size="sm"
                        onClick={() => void deleteBinding.run(b.id)}
                        busy={deleteBinding.pending && deleteBinding.lastArgs?.[0] === b.id}
                      >
                        <TrashIcon />
                      </IconButton>
                    </Stack>
                  </DataCell>
                </tr>
              ))}
              {bindings.length === 0 && (
                <TableEmpty columns={6}>
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
