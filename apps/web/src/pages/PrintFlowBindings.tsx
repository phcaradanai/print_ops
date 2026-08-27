import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Chip,
  CodeBlock,
  DataCell,
  DataHead,
  DataTable,
  ErrorBanner,
  ErrorState,
  CardDetailItem,
  CardDetail,
  FormField,
  Freshness,
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

// Manages the (code_template + code_profile) -> printer bindings that the
// dynamic print endpoint POST /api/v1/printer/{{code_template}}/{{code_profile}}
// resolves. Sysadmin (OWNER) only — gated at the route in App.tsx.

interface Template { templateCode: string; name: string }
interface Paper { id: string; code: string; name: string }
interface Printer { code: string; name: string; isActive?: boolean }
interface FlowConfig {
  http: { path: string; method: string; authHeader: string };
  nats:
    | {
        enabled: true;
        connected: boolean;
        url: string;
        stream: string;
        clientId: string;
        subject: string;
        durable: string;
        dlqPrefix: string;
        maxDeliver: number;
        authRequired: false;
      }
    | { enabled: false; connected: false; authRequired: false };
}
interface Binding {
  id: string;
  printerCode: string;
  templateCode: string;
  paperProfileId: string;
  isDefault: boolean;
  enabled: boolean;
}
interface IntakeAttempt {
  id: string;
  source: 'nats' | 'api';
  outcome: 'accepted' | 'duplicate' | 'rejected';
  occurredAt: string;
  reason?: string;
  requestId?: string;
  sourceSystem?: string;
  sourceReference?: string;
  codeTemplate?: string;
  codeProfile?: string;
  printerCode?: string;
  clientId?: string;
  subject?: string;
  jobId?: string;
}

export default function PrintFlowBindings() {
  const { t } = useLocale();
  const [form, setForm] = useState({ templateCode: '', paperProfileId: '', printerCode: '', isDefault: true });
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);

  // All five lists load together and NONE of them is optional: the form maps a
  // template to a paper profile to a printer, so a silently-empty list (the
  // previous `.catch(() => {})` on each) produced a form whose dropdowns were
  // empty for no stated reason.
  const fetchFlow = useCallback(async () => {
    const [templates, papers, printers, flowConfig, bindings] = await Promise.all([
      apiFetch<Template[]>('/v1/templates'),
      apiFetch<Paper[]>('/v1/paper-profiles'),
      apiFetch<Printer[]>('/printers'),
      apiFetch<FlowConfig>('/v1/print-flow/config'),
      apiFetch<Binding[]>('/v1/printer-template-bindings'),
    ]);
    return { templates, papers, printers, flowConfig, bindings };
  }, []);

  const flow = useApiResource(fetchFlow);
  const templates = flow.data?.templates ?? [];
  const papers = flow.data?.papers ?? [];
  const printers = flow.data?.printers ?? [];
  const bindings = flow.data?.bindings ?? [];
  const flowConfig = flow.data?.flowConfig ?? null;

  const paperCodeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of papers) map.set(p.id, p.code);
    return map;
  }, [papers]);

  // The intake log is genuinely optional — the page works without it — so it
  // is its own resource and its failure does not blank the bindings editor.
  const fetchIntakeLog = useCallback(
    () =>
      apiFetch<IntakeAttempt[]>(
        `/v1/print-flow/intake-log${failedOnly ? '?limit=100&outcome=rejected' : '?limit=100'}`,
      ),
    [failedOnly],
  );
  const intake = useApiResource(fetchIntakeLog);
  const intakeLog = intake.data ?? [];
  const intakeLoading = intake.loading || intake.refreshing;

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  const createBinding = useApiAction(async (values: typeof form) =>
    apiFetch<Binding>('/v1/printer-template-bindings', {
      method: 'POST',
      body: JSON.stringify({ ...values, enabled: true }),
    }),
  );

  const patchBinding = useApiAction(async (id: string, change: Partial<Binding>) =>
    apiFetch<Binding>(`/v1/printer-template-bindings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(change),
    }),
  );

  const busy = createBinding.pending || patchBinding.pending;
  const canCreate = Boolean(form.templateCode && form.paperProfileId && form.printerCode) && !busy;

  const create = useCallback(async () => {
    if (!canCreate) return;
    const created = await createBinding.run(form);
    if (created) {
      setMessage({ text: t('page.printFlow.created'), kind: 'success' });
      setForm({ templateCode: '', paperProfileId: '', printerCode: '', isDefault: true });
      flow.refresh();
    } else {
      setMessage({
        text: `${t('page.printFlow.saveError')} ${errorMessage(createBinding.getError())}`,
        kind: 'error',
      });
    }
  }, [canCreate, createBinding, flow, form, t]);

  const patch = useCallback(async (b: Binding, change: Partial<Binding>) => {
    const updated = await patchBinding.run(b.id, change);
    if (updated) {
      flow.refresh();
    } else {
      setMessage({
        text: `${t('page.printFlow.saveError')} ${errorMessage(patchBinding.getError())}`,
        kind: 'error',
      });
    }
  }, [flow, patchBinding, t]);

  // Live preview of the resolved dynamic path for the current form selection.
  const previewTemplate = form.templateCode || '{{code_template}}';
  const previewProfile = paperCodeById.get(form.paperProfileId) || '{{code_profile}}';

  const nats = flowConfig?.nats;
  const natsEnabled = nats?.enabled === true;

  // Example payloads, filled with the current selection so an operator can copy
  // a request that actually works against this instance.
  const httpExample = JSON.stringify(
    {
      request_id: 'REQ-20260723-0001',
      source_system: 'medisync',
      source_reference: 'RX-123456',
      payload: { prescription_id: 'RX-123456', patient_name: 'สมชาย ใจดี', hn: 'HN-0001' },
      copies: 1,
      priority: 'normal',
    },
    null,
    2,
  );

  const natsExample = JSON.stringify(
    {
      target_client_id: (nats?.enabled && nats.clientId) || 'pharmacy-counter-01',
      request_id: 'REQ-20260723-0001',
      source_system: 'medisync',
      source_reference: 'RX-123456',
      code_template: form.templateCode || 'prescription-sticker',
      code_profile: paperCodeById.get(form.paperProfileId) || 'sticker-profile',
      printer_code: '',
      payload: { prescription_id: 'RX-123456', patient_name: 'สมชาย ใจดี', hn: 'HN-0001' },
      copies: 1,
    },
    null,
    2,
  );

  const intakeColumns = {
    time: t('page.printFlow.colTime'),
    source: t('page.printFlow.colSource'),
    requestId: t('page.printFlow.colRequestId'),
    outcome: t('page.printFlow.colOutcome'),
    reason: t('page.printFlow.colReason'),
  };

  const bindingColumns = {
    template: t('page.printFlow.template'),
    profile: t('page.printFlow.profile'),
    printer: t('page.printFlow.printer'),
    default: t('page.printFlow.default'),
    enabled: t('page.printFlow.enabled'),
  };

  const outcomeLabel = (outcome: IntakeAttempt['outcome']) =>
    outcome === 'accepted'
      ? t('page.printFlow.outcomeAccepted')
      : outcome === 'duplicate'
        ? t('page.printFlow.outcomeDuplicate')
        : t('page.printFlow.outcomeRejected');

  return (
    <PageLayout
      width="full"
      title={t('page.printFlow.title')}
      description={t('page.printFlow.description')}
      actions={<Freshness
        lastSuccessAt={flow.lastSuccessAt}
        stale={flow.stale}
        refreshing={flow.refreshing}
        onRefresh={flow.refresh}
      />}
    >

      {message && (
        <Alert
          tone={message.kind === 'success' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('error.dismiss')}
        >
          {message.text}
        </Alert>
      )}

      {flow.loading && !flow.data && <LoadingState />}

      {flow.error != null && !flow.data && (
        <ErrorState error={flow.error} onRetry={flow.refresh} />
      )}

      {flow.stale && flow.error != null && (
        <ErrorBanner error={flow.error} title={t('error.refresh.title')} onRetry={flow.refresh} />
      )}

      <Stack gap="xl">
        <Panel padding="lg" tone="subtle" aria-label={t('page.printFlow.endpoint')}>
          <Inline gap="sm">
            <Badge tone="info">POST</Badge>
            <Mono weight="semibold">/api/v1/printer/{previewTemplate}/{previewProfile}</Mono>
          </Inline>
        </Panel>

        {/* ----- HTTP transport ----- */}
        <Panel title={t('page.printFlow.httpTransport')}>
          <Stack gap="lg">
            <CardDetail>
              <CardDetailItem label={t('page.printFlow.path')}>
                <Mono>{flowConfig?.http.path ?? '/api/v1/printer/{code_template}/{code_profile}'}</Mono>
              </CardDetailItem>
              <CardDetailItem label={t('page.printFlow.auth')}>
                <Inline gap="xs">
                  <Mono>{flowConfig?.http.authHeader ?? 'X-Api-Key'}</Mono>
                  <Text tone="muted">{t('page.printFlow.authRequired')}</Text>
                </Inline>
              </CardDetailItem>
            </CardDetail>
            <Stack gap="xs">
              <Text size="label" tone="muted">{t('page.printFlow.examplePayload')}</Text>
              <CodeBlock label={t('page.printFlow.examplePayload')}>{httpExample}</CodeBlock>
            </Stack>
          </Stack>
        </Panel>

        {/* ----- NATS transport ----- */}
        <Panel
          title={t('page.printFlow.natsTransport')}
          actions={
            natsEnabled && nats.enabled ? (
              <Badge tone={nats.connected ? 'success' : 'warning'}>
                {nats.connected ? t('page.printFlow.natsConnected') : t('page.printFlow.natsDisconnected')}
              </Badge>
            ) : undefined
          }
        >
          {!natsEnabled && <Text as="p" tone="muted">{t('page.printFlow.natsDisabled')}</Text>}

          {natsEnabled && nats.enabled && (
            <Stack gap="lg">
              <Alert tone="info">{t('page.printFlow.natsNoAuth')}</Alert>

              <CardDetail>
                <CardDetailItem label={t('page.printFlow.subject')}>
                  <Mono weight="semibold" tone="strong">{nats.subject}</Mono>
                </CardDetailItem>
                <CardDetailItem label={t('page.printFlow.stream')}><Mono>{nats.stream}</Mono></CardDetailItem>
                <CardDetailItem label={t('page.printFlow.durable')}><Mono>{nats.durable}</Mono></CardDetailItem>
                <CardDetailItem label={t('page.printFlow.server')}><Mono>{nats.url}</Mono></CardDetailItem>
                <CardDetailItem label={t('page.printFlow.dlq')}>
                  <Stack gap="xs">
                    <Mono>{nats.dlqPrefix}{nats.subject}</Mono>
                    <Text size="label" tone="muted">{t('page.printFlow.maxDeliver')} {nats.maxDeliver}</Text>
                  </Stack>
                </CardDetailItem>
              </CardDetail>

              <Stack gap="xs">
                <Text size="label" tone="muted">{t('page.printFlow.examplePayload')}</Text>
                <CodeBlock label={t('page.printFlow.examplePayload')}>{natsExample}</CodeBlock>
              </Stack>
            </Stack>
          )}
        </Panel>

        {/* ----- Intake log: every attempt, including rejected ones ----- */}
        <Panel title={t('page.printFlow.intakeLog')} description={t('page.printFlow.intakeLogDesc')}>
          <Stack gap="lg">
            <Inline gap="lg">
              <Checkbox
                label={t('page.printFlow.intakeLogFailedOnly')}
                checked={failedOnly}
                onChange={(e) => setFailedOnly(e.target.checked)}
              />
              <Button
                variant="secondary"
                onClick={intake.refresh}
                busy={intakeLoading}
                busyLabel={t('common.loading')}
              >
                {t('page.printFlow.intakeLogRefresh')}
              </Button>
            </Inline>

            {/* The intake log is optional context, so its failure is a strip rather
                than a page-level error — but it is no longer silent. */}
            {intake.error != null && (
              <ErrorBanner
                error={intake.error}
                title={t('page.printFlow.intakeLogFailed')}
                onRetry={intake.refresh}
              />
            )}

            <DataTable label={t('page.printFlow.intakeLog')} responsive>
              <thead>
                <tr>
                  <DataHead>{intakeColumns.time}</DataHead>
                  <DataHead>{intakeColumns.source}</DataHead>
                  <DataHead>{intakeColumns.requestId}</DataHead>
                  <DataHead>{intakeColumns.outcome}</DataHead>
                  <DataHead>{intakeColumns.reason}</DataHead>
                </tr>
              </thead>
              <tbody>
                {intakeLog.map((a) => (
                  <tr key={a.id} title={[a.sourceSystem, a.sourceReference, a.codeTemplate, a.codeProfile, a.printerCode, a.clientId, a.subject].filter(Boolean).join(' · ')}>
                    <DataCell label={intakeColumns.time}>
                      <Text size="label" tone="muted" nowrap>{new Date(a.occurredAt).toLocaleString()}</Text>
                    </DataCell>
                    <DataCell label={intakeColumns.source}>
                      <Badge tone={a.source === 'nats' ? 'info' : 'neutral'}>
                        {a.source === 'nats' ? 'NATS' : 'HTTP API'}
                      </Badge>
                    </DataCell>
                    <DataCell label={intakeColumns.requestId}>
                      <Mono>{a.requestId ?? '—'}</Mono>
                    </DataCell>
                    <DataCell label={intakeColumns.outcome}>
                      <Badge tone={a.outcome === 'accepted' ? 'success' : a.outcome === 'rejected' ? 'danger' : 'neutral'}>
                        {outcomeLabel(a.outcome)}
                      </Badge>
                    </DataCell>
                    <DataCell label={intakeColumns.reason}>
                      <Text tone="muted">{a.reason ?? '—'}</Text>
                    </DataCell>
                  </tr>
                ))}
                {intakeLog.length === 0 && (
                  <TableEmpty columns={5}>
                    <Text tone="muted">{t('page.printFlow.intakeLogEmpty')}</Text>
                  </TableEmpty>
                )}
              </tbody>
            </DataTable>
          </Stack>
        </Panel>

        <Panel
          title={t('page.printFlow.newBinding')}
          footer={
            <Button disabled={!canCreate} busy={busy} busyLabel={t('common.loading')} onClick={() => void create()}>
              {t('common.bind')}
            </Button>
          }
        >
          <Stack gap="lg">
            <FormField label={t('page.printFlow.template')}>
              {(control) => (
                <Select
                  {...control}
                  value={form.templateCode}
                  onChange={(e) => setForm({ ...form, templateCode: e.target.value })}
                  disabled={busy}
                >
                  <option value="">{t('page.printFlow.select')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.templateCode} value={tpl.templateCode}>{tpl.templateCode} — {tpl.name}</option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label={t('page.printFlow.profile')}>
              {(control) => (
                <Select
                  {...control}
                  value={form.paperProfileId}
                  onChange={(e) => setForm({ ...form, paperProfileId: e.target.value })}
                  disabled={busy}
                >
                  <option value="">{t('page.printFlow.select')}</option>
                  {papers.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label={t('page.printFlow.printer')}>
              {(control) => (
                <Select
                  {...control}
                  value={form.printerCode}
                  onChange={(e) => setForm({ ...form, printerCode: e.target.value })}
                  disabled={busy}
                >
                  <option value="">{t('page.printFlow.select')}</option>
                  {printers.map((p) => (
                    <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
                  ))}
                </Select>
              )}
            </FormField>

            <Checkbox
              label={t('page.printFlow.default')}
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              disabled={busy}
            />
          </Stack>
        </Panel>

        <Panel title={t('page.printFlow.existing')} padding="none">
          <DataTable label={t('page.printFlow.existing')} responsive>
            <thead>
              <tr>
                <DataHead>{bindingColumns.template}</DataHead>
                <DataHead>{bindingColumns.profile}</DataHead>
                <DataHead>{bindingColumns.printer}</DataHead>
                <DataHead>{bindingColumns.default}</DataHead>
                <DataHead>{bindingColumns.enabled}</DataHead>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr key={b.id}>
                  <DataCell label={bindingColumns.template}><Mono>{b.templateCode}</Mono></DataCell>
                  <DataCell label={bindingColumns.profile}>
                    <Mono>{paperCodeById.get(b.paperProfileId) ?? b.paperProfileId.slice(0, 8)}</Mono>
                  </DataCell>
                  <DataCell label={bindingColumns.printer}><Mono>{b.printerCode}</Mono></DataCell>
                  {/* These were `<button className="print-flow-pill">` — real
                      controls whose pressed state existed only as a colour. */}
                  <DataCell label={bindingColumns.default} actions>
                    <Chip
                      selected={b.isDefault}
                      disabled={busy || b.isDefault}
                      onClick={() => void patch(b, { isDefault: true })}
                      title={t('page.printFlow.makeDefault')}
                    >
                      {b.isDefault ? t('status.enabled') : t('page.printFlow.makeDefault')}
                    </Chip>
                  </DataCell>
                  <DataCell label={bindingColumns.enabled} actions>
                    <Switch
                      label={bindingColumns.enabled}
                      onLabel={t('status.enabled')}
                      offLabel={t('status.disabled')}
                      checked={b.enabled}
                      onChange={() => void patch(b, { enabled: !b.enabled })}
                      busy={busy}
                    />
                  </DataCell>
                </tr>
              ))}
              {bindings.length === 0 && (
                <TableEmpty columns={5}>
                  <Text tone="muted">{t('common.noData')}</Text>
                </TableEmpty>
              )}
            </tbody>
          </DataTable>
        </Panel>
      </Stack>
    </PageLayout>
  );
}
