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
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Freshness,
  Grid,
  IconButton,
  Inline,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  Select,
  Stack,
  Switch,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

const EditIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>;
const TrashIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;

interface Binding { id: string; printerCode: string; templateCode: string; paperProfileId: string; isDefault: boolean; enabled: boolean }

type BindingForm = { printerCode: string; templateCode: string; paperProfileId: string; isDefault: boolean };

interface Option { value: string; label: string }

const EMPTY_FORM: BindingForm = { printerCode: '', templateCode: '', paperProfileId: '', isDefault: true };

export default function PrinterBindings() {
  const { t } = useLocale();
  const [editingId, setEditingId] = useState<string | null>(null);
  // Deleting a binding changes where real jobs print, so it is confirmed first.
  const [pendingDelete, setPendingDelete] = useState<Binding | null>(null);
  const [form, setForm] = useState<BindingForm>(EMPTY_FORM);

  const fetchBindings = useCallback(() => apiFetch<Binding[]>('/v1/printer-template-bindings'), []);
  const bindingsResource = useApiResource(fetchBindings);
  const bindings = bindingsResource.data ?? [];

  // Pick from what exists instead of typing codes and a profile UUID by hand.
  const fetchOptions = useCallback(async () => {
    const [printers, templates, papers] = await Promise.all([
      apiFetch<{ code: string; name: string }[]>('/printers'),
      apiFetch<{ templateCode: string; name: string }[]>('/v1/templates'),
      apiFetch<{ id: string; code: string; name: string }[]>('/v1/paper-profiles'),
    ]);
    const toOptions = <T,>(rows: T[], value: (row: T) => string, name: (row: T) => string): Option[] =>
      rows.map((row) => ({ value: value(row), label: `${value(row)} — ${name(row)}` }));
    return {
      printerCode: toOptions(printers, (r) => r.code, (r) => r.name),
      templateCode: toOptions(templates, (r) => r.templateCode, (r) => r.name),
      paperProfileId: papers.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` })),
      paperCode: new Map(papers.map((r) => [r.id, r.code])),
    };
  }, []);
  const optionsResource = useApiResource(fetchOptions);
  const options = optionsResource.data;

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
    actions: t('common.actions'),
  };

  return (
    <PageLayout
      title={t('page.bindings.title')}
      description={t('page.bindings.subtitle')}
      density="compact"
      width="full"
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
          title={editingId ? t('page.bindings.updateFailed') : t('page.bindings.createFailed')}
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
        <Alert tone="error" title={t('common.error')} onDismiss={deleteBinding.reset} dismissLabel={t('error.dismiss')}>
          {errorMessage(deleteBinding.error)}
        </Alert>
      )}

      {toggleEnabled.error != null && (
        <Alert tone="error" title={t('common.error')} onDismiss={toggleEnabled.reset} dismissLabel={t('error.dismiss')}>
          {errorMessage(toggleEnabled.error)}
        </Alert>
      )}

      <Stack gap="xl">
        <Panel
          title={editingId ? t('page.bindings.editTitle') : t('page.bindings.title')}
          footer={
            <Inline gap="sm">
              <Button onClick={() => void saveBinding.run(form)} busy={saveBinding.pending}>
                {editingId ? t('common.save') : t('common.bind')}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                }}>
                  {t('common.cancel')}
                </Button>
              )}
            </Inline>
          }
        >
          <Stack gap="lg">
            <Grid columns={3}>
              {(['printerCode', 'templateCode', 'paperProfileId'] as const).map((key) => (
                <FormField key={key} label={t(`page.bindings.${key}`)}>
                  {(control) => (
                    <Select
                      {...control}
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    >
                      <option value="">{t('page.printFlow.select')}</option>
                      {/* Keep an edited binding's value visible even if its record is gone. */}
                      {form[key] && !options?.[key].some((o) => o.value === form[key]) && (
                        <option value={form[key]}>{form[key]}</option>
                      )}
                      {options?.[key].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
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
                    <Mono title={b.paperProfileId}>{b.paperProfileId ? (options?.paperCode.get(b.paperProfileId) ?? b.paperProfileId) : '—'}</Mono>
                  </DataCell>
                  <DataCell label={columns.default}>
                    {b.isDefault
                      ? <Badge tone="info">{t('page.bindings.isDefault')}</Badge>
                      : <Text tone="muted">{t('page.bindings.notDefault')}</Text>}
                  </DataCell>
                  <DataCell label={columns.enabled}>
                    <Switch
                      label={columns.enabled}
                      onLabel={t('status.enabled')}
                      offLabel={t('status.disabled')}
                      checked={b.enabled}
                      onChange={() => void toggleEnabled.run(b)}
                      busy={toggleEnabled.pending}
                    />
                  </DataCell>
                  <DataCell label={columns.actions} actions>
                    <Inline gap="xs">
                      <IconButton
                        label={t('common.edit')}
                        size="sm"
                        onClick={() => {
                          setEditingId(b.id);
                          setForm({
                            printerCode: b.printerCode,
                            templateCode: b.templateCode,
                            paperProfileId: b.paperProfileId,
                            isDefault: b.isDefault,
                          });
                          // The shell scrolls <main>, not the window.
                          document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        label={t('common.delete')}
                        variant="danger"
                        size="sm"
                        onClick={() => setPendingDelete(b)}
                        busy={deleteBinding.pending && pendingDelete?.id === b.id}
                      >
                        <TrashIcon />
                      </IconButton>
                    </Inline>
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
      <Dialog
        open={pendingDelete != null}
        onClose={() => !deleteBinding.pending && setPendingDelete(null)}
        title={t('page.bindings.deleteTitle')}
        footer={<>
          <Button variant="secondary" disabled={deleteBinding.pending} onClick={() => setPendingDelete(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            busy={deleteBinding.pending}
            onClick={() => {
              if (!pendingDelete) return;
              void deleteBinding.run(pendingDelete.id).finally(() => setPendingDelete(null));
            }}
          >
            {t('common.delete')}
          </Button>
        </>}
      >
        <Text>
          {t('page.bindings.deleteBody')
            .replace('{printer}', pendingDelete?.printerCode ?? '')
            .replace('{template}', pendingDelete?.templateCode ?? '')
            .replace('{paper}', pendingDelete ? (options?.paperCode.get(pendingDelete.paperProfileId) ?? pendingDelete.paperProfileId) : '')}
        </Text>
      </Dialog>
    </PageLayout>
  );
}
