import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

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
        url: string;
        stream: string;
        subject: string;
        durable: string;
        dlqPrefix: string;
        maxDeliver: number;
        authRequired: false;
      }
    | { enabled: false; authRequired: false };
}
interface Binding {
  id: string;
  printerCode: string;
  templateCode: string;
  paperProfileId: string;
  isDefault: boolean;
  enabled: boolean;
}

export default function PrintFlowBindings() {
  const { t } = useLocale();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [flowConfig, setFlowConfig] = useState<FlowConfig | null>(null);
  const [form, setForm] = useState({ templateCode: '', paperProfileId: '', printerCode: '', isDefault: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);

  const paperCodeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of papers) map.set(p.id, p.code);
    return map;
  }, [papers]);

  const loadBindings = useCallback(
    () => apiFetch<Binding[]>('/v1/printer-template-bindings').then(setBindings).catch(() => {}),
    [],
  );

  const loadAll = useCallback(async () => {
    await Promise.all([
      apiFetch<Template[]>('/v1/templates').then(setTemplates).catch(() => {}),
      apiFetch<Paper[]>('/v1/paper-profiles').then(setPapers).catch(() => {}),
      apiFetch<Printer[]>('/printers').then(setPrinters).catch(() => {}),
      apiFetch<FlowConfig>('/v1/print-flow/config').then(setFlowConfig).catch(() => {}),
      loadBindings(),
    ]);
  }, [loadBindings]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  const canCreate = form.templateCode && form.paperProfileId && form.printerCode && !busy;

  const create = useCallback(async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      await apiFetch('/v1/printer-template-bindings', {
        method: 'POST',
        body: JSON.stringify({ ...form, enabled: true }),
      });
      setMessage({ text: t('page.printFlow.created'), kind: 'success' });
      setForm({ templateCode: '', paperProfileId: '', printerCode: '', isDefault: true });
      await loadBindings();
    } catch {
      setMessage({ text: t('page.printFlow.saveError'), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }, [canCreate, form, loadBindings, t]);

  const patch = useCallback(async (b: Binding, change: Partial<Binding>) => {
    setBusy(true);
    try {
      await apiFetch(`/v1/printer-template-bindings/${b.id}`, {
        method: 'PUT',
        body: JSON.stringify(change),
      });
      await loadBindings();
    } catch {
      setMessage({ text: t('page.printFlow.saveError'), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }, [loadBindings, t]);

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
      request_id: 'REQ-20260723-0001',
      source_system: 'medisync',
      source_reference: 'RX-123456',
      code_template: form.templateCode || 'prescription-sticker',
      code_profile: paperCodeById.get(form.paperProfileId) || 'sticker-profile',
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
        <div className={`settings-message settings-message--${message.kind}`} role="status" aria-live="polite">
          {message.text}
        </div>
      )}

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
        <h2 id="print-flow-nats">{t('page.printFlow.natsTransport')}</h2>

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
