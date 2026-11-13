import { useCallback, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import {
  Alert, Badge, Button, Checkbox, DataCell, DataHead, DataTable, Dialog, EmptyState, ErrorState,
  FormField, Freshness, Grid, Inline, Input, LoadingState, Mono, PageLayout, Panel, Select, Stack, TableEmpty, Text,
} from '../components/ui/index.js';

interface LocationBinding {
  id: string;
  locationCode: string;
  printerIp: string;
  printerName?: string;
  printerModel?: string;
  isDefault: boolean;
  resolvedPrinterCode: string | null;
}

interface PrinterOption { ip: string; name: string; model?: string; printerCode: string | null }

type Form = { locationCode: string; printerIp: string; printerName: string; printerModel: string; isDefault: boolean };
const EMPTY: Form = { locationCode: '', printerIp: '', printerName: '', printerModel: '', isDefault: false };

export default function LocationBindings() {
  const { t } = useLocale();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LocationBinding | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);

  const fetchBindings = useCallback(() => apiFetch<LocationBinding[]>('/v1/location-bindings'), []);
  const resource = useApiResource(fetchBindings);
  const rows = resource.data ?? [];

  // Printers the system already found (registered + discovered) — pick one instead of typing its IP.
  const fetchOptions = useCallback(() => apiFetch<PrinterOption[]>('/v1/location-bindings/printer-options'), []);
  const printerOptions = useApiResource(fetchOptions).data ?? [];

  const save = useApiAction(async (values: Form) => {
    await apiFetch(editingId ? `/v1/location-bindings/${editingId}` : '/v1/location-bindings', {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(values),
    });
    setEditingId(null);
    setForm(EMPTY);
    resource.refresh();
  });
  const makeDefault = useApiAction(async (b: LocationBinding) => {
    await apiFetch(`/v1/location-bindings/${b.id}`, { method: 'PUT', body: JSON.stringify({ isDefault: true }) });
    resource.refresh();
  });
  const remove = useApiAction(async (id: string) => {
    await apiFetch(`/v1/location-bindings/${id}`, { method: 'DELETE' });
    resource.refresh();
  });

  const col = {
    location: t('page.locations.locationCode'),
    ip: t('page.locations.printerIp'),
    name: t('page.locations.printerName'),
    model: t('page.locations.printerModel'),
    printer: t('page.locations.resolvedPrinter'),
    default: t('page.bindings.default'),
    actions: t('common.actions'),
  };
  const error = save.error ?? makeDefault.error ?? remove.error;

  return (
    <PageLayout
      title={t('page.locations.title')}
      description={t('page.locations.subtitle')}
      density="compact"
      width="full"
      actions={<Freshness lastSuccessAt={resource.lastSuccessAt} stale={resource.stale} refreshing={resource.refreshing} onRefresh={resource.refresh} />}
    >
      {error != null && (
        <Alert tone="error" title={t('common.error')} onDismiss={() => { save.reset(); makeDefault.reset(); remove.reset(); }} dismissLabel={t('error.dismiss')}>
          {errorMessage(error)}
        </Alert>
      )}
      <Stack gap="xl">
        <Panel
          title={editingId ? t('page.locations.editTitle') : t('page.locations.title')}
          footer={
            <Inline gap="sm">
              <Button onClick={() => save.run(form)} busy={save.pending}>{editingId ? t('common.save') : t('common.bind')}</Button>
              {editingId && <Button variant="ghost" onClick={() => { setEditingId(null); setForm(EMPTY); }}>{t('common.cancel')}</Button>}
            </Inline>
          }
        >
          <Stack gap="lg">
            <FormField label={t('page.locations.pickPrinter')}>
              {(control) => (
                <Select
                  {...control}
                  value={printerOptions.some((o) => o.ip === form.printerIp) ? form.printerIp : ''}
                  onChange={(e) => {
                    const o = printerOptions.find((p) => p.ip === e.target.value);
                    if (o) setForm({ ...form, printerIp: o.ip, printerName: o.name, printerModel: o.model ?? '' });
                  }}
                >
                  <option value="">{printerOptions.length ? t('page.printFlow.select') : t('page.locations.noFoundPrinters')}</option>
                  {printerOptions.map((o) => (
                    <option key={o.ip} value={o.ip}>
                      {`${o.ip} — ${o.name}${o.model ? ` (${o.model})` : ''}${o.printerCode ? ` · ${o.printerCode}` : ` · ${t('page.locations.notRegistered')}`}`}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <Grid columns={4}>
              {(['locationCode', 'printerIp', 'printerName', 'printerModel'] as const).map((key) => (
                <FormField key={key} label={t(`page.locations.${key}`)}>
                  {(control) => (
                    <Input
                      {...control}
                      mono={key === 'locationCode' || key === 'printerIp'}
                      value={form[key]}
                      placeholder={key === 'locationCode' ? 'wardA' : key === 'printerIp' ? '192.168.10.11' : t('page.locations.autoFill')}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  )}
                </FormField>
              ))}
            </Grid>
            <Checkbox label={t('page.locations.setDefault')} checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
          </Stack>
        </Panel>

        {resource.loading && !resource.data ? (
          <LoadingState />
        ) : resource.error != null && !resource.data ? (
          <ErrorState error={resource.error} onRetry={resource.refresh} />
        ) : (
          <DataTable label={t('page.locations.title')} responsive>
            <thead>
              <tr>
                <DataHead>{col.location}</DataHead>
                <DataHead>{col.ip}</DataHead>
                <DataHead>{col.name}</DataHead>
                <DataHead>{col.model}</DataHead>
                <DataHead>{col.printer}</DataHead>
                <DataHead>{col.default}</DataHead>
                <DataHead align="right">{col.actions}</DataHead>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <DataCell label={col.location}><Mono weight="semibold">{b.locationCode}</Mono></DataCell>
                  <DataCell label={col.ip}><Mono>{b.printerIp}</Mono></DataCell>
                  <DataCell label={col.name}>{b.printerName ?? '—'}</DataCell>
                  <DataCell label={col.model}>{b.printerModel ?? '—'}</DataCell>
                  <DataCell label={col.printer}>
                    {b.resolvedPrinterCode
                      ? <Mono>{b.resolvedPrinterCode}</Mono>
                      : <Badge tone="warning">{t('page.locations.notRegistered')}</Badge>}
                  </DataCell>
                  <DataCell label={col.default}>
                    {b.isDefault
                      ? <Badge tone="info">{t('page.bindings.isDefault')}</Badge>
                      : <Button size="sm" variant="ghost" busy={makeDefault.pending} onClick={() => makeDefault.run(b)}>{t('page.locations.makeDefault')}</Button>}
                  </DataCell>
                  <DataCell label={col.actions} actions>
                    <Inline gap="xs">
                      <Button size="sm" variant="ghost" onClick={() => {
                        setEditingId(b.id);
                        setForm({ locationCode: b.locationCode, printerIp: b.printerIp, printerName: b.printerName ?? '', printerModel: b.printerModel ?? '', isDefault: b.isDefault });
                        document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
                      }}>{t('common.edit')}</Button>
                      <Button size="sm" variant="danger" onClick={() => setPendingDelete(b)}>{t('common.delete')}</Button>
                    </Inline>
                  </DataCell>
                </tr>
              ))}
              {rows.length === 0 && (
                <TableEmpty columns={7}><EmptyState title={t('page.locations.empty')} /></TableEmpty>
              )}
            </tbody>
          </DataTable>
        )}
      </Stack>
      {/* Deleting changes where a location's jobs print, so it is confirmed first. */}
      <Dialog
        open={pendingDelete != null}
        onClose={() => !remove.pending && setPendingDelete(null)}
        title={t('page.bindings.deleteTitle')}
        footer={<>
          <Button variant="secondary" disabled={remove.pending} onClick={() => setPendingDelete(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" busy={remove.pending} onClick={() => {
            if (pendingDelete) void remove.run(pendingDelete.id).finally(() => setPendingDelete(null));
          }}>{t('common.delete')}</Button>
        </>}
      >
        <Text>{pendingDelete ? `${pendingDelete.locationCode} → ${pendingDelete.printerIp}` : ''}</Text>
      </Dialog>
    </PageLayout>
  );
}
