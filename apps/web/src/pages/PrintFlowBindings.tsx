import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { ErrorBanner, ErrorState, Freshness, LoadingState } from '../components/PageState.js';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';

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

  return (
    <div className="settings-page print-flow-page">
      <h1>{t('page.printFlow.title')}</h1>
      <p className="print-flow-lead">{t('page.printFlow.description')}</p>

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

      <div className="page-header">
        <span />
        <Freshness
          lastSuccessAt={flow.lastSuccessAt}
          stale={flow.stale}
          refreshing={flow.refreshing}
          onRefresh={flow.refresh}
        />
      </div>

      <div className="print-flow-endpoint" aria-label={t('page.printFlow.endpoint')}>
        <span className="print-flow-method">POST</span>
        <code className="print-flow-path">/api/v1/printer/{previewTemplate}/{previewProfile}</code>
      </div>

      {/* ----- HTTP transport ----- */}
      <section className="settings-section" aria-labelledby="print-flow-http">
        <h2 id="print-flow-http">{t('page.printFlow.httpTransport')}</h2>
        <dl className="print-flow-kv">
          <dt>{t('page.printFlow.path')}</dt>
          <dd><code>{flowConfig?.http.path ?? '/api/v1/printer/{code_template}/{code_profile}'}</code></dd>
          <dt>{t('page.printFlow.auth')}</dt>
          <dd><code>{flowConfig?.http.authHeader ?? 'X-Api-Key'}</code> {t('page.printFlow.authRequired')}</dd>
        </dl>
        <div className="print-flow-example">
          <div className="print-flow-example-label">{t('page.printFlow.examplePayload')}</div>
          <pre><code>{httpExample}</code></pre>
        </div>
      </section>

      {/* ----- NATS transport ----- */}
      <section className="settings-section" aria-labelledby="print-flow-nats">
        <h2 id="print-flow-nats">
          {t('page.printFlow.natsTransport')}
          {natsEnabled && nats.enabled && (
            <span className={'print-flow-pill' + (nats.connected ? ' print-flow-pill--on' : '')}>
              {nats.connected ? t('page.printFlow.natsConnected') : t('page.printFlow.natsDisconnected')}
            </span>
          )}
        </h2>

        {!natsEnabled && (
          <p className="print-flow-lead">{t('page.printFlow.natsDisabled')}</p>
        )}

        {natsEnabled && nats.enabled && (
          <>
            <div className="print-flow-notice" role="note">
              {t('page.printFlow.natsNoAuth')}
            </div>

            <dl className="print-flow-kv">
              <dt>{t('page.printFlow.subject')}</dt>
              <dd><code className="print-flow-strong">{nats.subject}</code></dd>
              <dt>{t('page.printFlow.stream')}</dt>
              <dd><code>{nats.stream}</code></dd>
              <dt>{t('page.printFlow.durable')}</dt>
              <dd><code>{nats.durable}</code></dd>
              <dt>{t('page.printFlow.server')}</dt>
              <dd><code>{nats.url}</code></dd>
              <dt>{t('page.printFlow.dlq')}</dt>
              <dd><code>{nats.dlqPrefix}{nats.subject}</code> · {t('page.printFlow.maxDeliver')} {nats.maxDeliver}</dd>
            </dl>

            <div className="print-flow-example">
              <div className="print-flow-example-label">{t('page.printFlow.examplePayload')}</div>
              <pre><code>{natsExample}</code></pre>
            </div>
          </>
        )}
      </section>

      {/* ----- Intake log: every attempt, including rejected ones ----- */}
      <section className="settings-section" aria-labelledby="print-flow-intake-log">
        <h2 id="print-flow-intake-log">{t('page.printFlow.intakeLog')}</h2>
        <p className="print-flow-lead">{t('page.printFlow.intakeLogDesc')}</p>

        <div className="settings-actions" style={{ alignItems: 'center', gap: '1rem' }}>
          <label className="print-flow-checkbox">
            <input
              type="checkbox"
              checked={failedOnly}
              onChange={(e) => setFailedOnly(e.target.checked)}
            />
            {t('page.printFlow.intakeLogFailedOnly')}
          </label>
          <Button onClick={intake.refresh} busy={intakeLoading} busyLabel={t('common.loading')}>
            {t('page.printFlow.intakeLogRefresh')}
          </Button>
        </div>

        {/* The intake log is optional context, so its failure is a strip rather
            than a page-level error — but it is no longer silent. */}
        {intake.error != null && (
          <ErrorBanner
            error={intake.error}
            title={t('page.printFlow.intakeLogFailed')}
            onRetry={intake.refresh}
          />
        )}

        <div className="print-flow-table-wrap">
          <table className="print-flow-table">
            <thead>
              <tr>
                <th>{t('page.printFlow.colTime')}</th>
                <th>{t('page.printFlow.colSource')}</th>
                <th>{t('page.printFlow.colRequestId')}</th>
                <th>{t('page.printFlow.colOutcome')}</th>
                <th>{t('page.printFlow.colReason')}</th>
              </tr>
            </thead>
            <tbody>
              {intakeLog.length === 0 && (
                <tr><td colSpan={5} className="print-flow-empty">{t('page.printFlow.intakeLogEmpty')}</td></tr>
              )}
              {intakeLog.map((a) => (
                <tr key={a.id} title={[a.sourceSystem, a.sourceReference, a.codeTemplate, a.codeProfile, a.printerCode, a.clientId, a.subject].filter(Boolean).join(' · ')}>
                  <td style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#666', whiteSpace: 'nowrap' }}>
                    {new Date(a.occurredAt).toLocaleString()}
                  </td>
                  <td>
                    <span className={'print-flow-pill' + (a.source === 'nats' ? ' print-flow-pill--on' : '')}>
                      {a.source === 'nats' ? 'NATS' : 'HTTP API'}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {a.requestId ?? '—'}
                  </td>
                  <td>
                    <span
                      className="print-flow-pill"
                      style={
                        a.outcome === 'accepted'
                          ? { background: 'var(--success-bg, #16a34a22)', color: 'var(--success-text, #16a34a)' }
                          : a.outcome === 'rejected'
                            ? { background: 'var(--danger-bg, #dc262622)', color: 'var(--danger-text, #dc2626)' }
                            : undefined
                      }
                    >
                      {a.outcome === 'accepted'
                        ? t('page.printFlow.outcomeAccepted')
                        : a.outcome === 'duplicate'
                          ? t('page.printFlow.outcomeDuplicate')
                          : t('page.printFlow.outcomeRejected')}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: 'var(--neutral-text-muted)' }}>
                    {a.reason ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="print-flow-new">
        <h2 id="print-flow-new">{t('page.printFlow.newBinding')}</h2>

        <div className="settings-field">
          <label htmlFor="pf-template">{t('page.printFlow.template')}</label>
          <select
            id="pf-template"
            value={form.templateCode}
            onChange={(e) => setForm({ ...form, templateCode: e.target.value })}
            disabled={busy}
          >
            <option value="">{t('page.printFlow.select')}</option>
            {templates.map((tpl) => (
              <option key={tpl.templateCode} value={tpl.templateCode}>{tpl.templateCode} — {tpl.name}</option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <label htmlFor="pf-profile">{t('page.printFlow.profile')}</label>
          <select
            id="pf-profile"
            value={form.paperProfileId}
            onChange={(e) => setForm({ ...form, paperProfileId: e.target.value })}
            disabled={busy}
          >
            <option value="">{t('page.printFlow.select')}</option>
            {papers.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <label htmlFor="pf-printer">{t('page.printFlow.printer')}</label>
          <select
            id="pf-printer"
            value={form.printerCode}
            onChange={(e) => setForm({ ...form, printerCode: e.target.value })}
            disabled={busy}
          >
            <option value="">{t('page.printFlow.select')}</option>
            {printers.map((p) => (
              <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <label htmlFor="pf-default" className="print-flow-checkbox">
            <input
              id="pf-default"
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              disabled={busy}
            />
            {t('page.printFlow.default')}
          </label>
        </div>

        <div className="settings-actions">
          <button type="button" className="settings-btn-primary" disabled={!canCreate} onClick={() => void create()}>
            {busy ? t('common.loading') : t('common.bind')}
          </button>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="print-flow-list">
        <h2 id="print-flow-list">{t('page.printFlow.existing')}</h2>
        <div className="print-flow-table-wrap">
          <table className="print-flow-table">
            <thead>
              <tr>
                <th>{t('page.printFlow.template')}</th>
                <th>{t('page.printFlow.profile')}</th>
                <th>{t('page.printFlow.printer')}</th>
                <th>{t('page.printFlow.default')}</th>
                <th>{t('page.printFlow.enabled')}</th>
              </tr>
            </thead>
            <tbody>
              {bindings.length === 0 && (
                <tr><td colSpan={5} className="print-flow-empty">{t('common.noData')}</td></tr>
              )}
              {bindings.map((b) => (
                <tr key={b.id}>
                  <td><code>{b.templateCode}</code></td>
                  <td><code>{paperCodeById.get(b.paperProfileId) ?? b.paperProfileId.slice(0, 8)}</code></td>
                  <td><code>{b.printerCode}</code></td>
                  <td>
                    <button
                      type="button"
                      className={'print-flow-pill' + (b.isDefault ? ' print-flow-pill--on' : '')}
                      disabled={busy || b.isDefault}
                      onClick={() => void patch(b, { isDefault: true })}
                      title={t('page.printFlow.makeDefault')}
                    >
                      {b.isDefault ? t('status.enabled') : t('page.printFlow.makeDefault')}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={'print-flow-pill' + (b.enabled ? ' print-flow-pill--on' : '')}
                      disabled={busy}
                      onClick={() => void patch(b, { enabled: !b.enabled })}
                      title={b.enabled ? t('status.disabled') : t('status.enabled')}
                    >
                      {b.enabled ? t('status.enabled') : t('status.disabled')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
