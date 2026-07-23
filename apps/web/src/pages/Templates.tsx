import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

interface Template {
  id: string;
  templateCode: string;
  name: string;
  engine: string;
  status: string;
  version: number;
  content: string;
  paperProfileId?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PaperProfileField {
  key: string;
  label?: string;
  defaultValue?: string;
}

interface PaperProfileOption {
  id: string;
  code: string;
  name: string;
  fields: PaperProfileField[];
}

interface PreviewResponse {
  renderedPreview: string;
  renderedPrintPayload: string;
  warnings: string[];
  renderTimeMs: number;
}

type SampleMode = 'default' | 'profile' | 'empty';

const ENGINES = ['RAW_TEXT', 'ZPL', 'HTML', 'JSON_LAYOUT', 'TSPL', 'EPL', 'PDF_LIKE_PREVIEW'] as const;

const ENGINE_ICON: Record<string, string> = {
  RAW_TEXT: '📄',
  ZPL: '🏷️',
  HTML: '🌐',
  JSON_LAYOUT: '{ }',
  TSPL: '🖨️',
  EPL: '📃',
  PDF_LIKE_PREVIEW: '📑',
};

const STATUS_TONE: Record<string, string> = {
  PUBLISHED: 'tpl-badge--published',
  DRAFT: 'tpl-badge--draft',
  DISABLED: 'tpl-badge--disabled',
  ARCHIVED: 'tpl-badge--archived',
};

const VARIABLES: { token: string; labelKey: string }[] = [
  { token: 'label', labelKey: 'page.templates.varLabel' },
  { token: 'barcode', labelKey: 'page.templates.varBarcode' },
  { token: 'date', labelKey: 'page.templates.varDate' },
  { token: 'time', labelKey: 'page.templates.varTime' },
  { token: 'seq', labelKey: 'page.templates.varSeq' },
];

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

const EMPTY_FORM = {
  templateCode: '',
  name: '',
  engine: 'RAW_TEXT',
  content: 'TEST {{label}}\n{{barcode}}',
  paperProfileId: '',
};

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function defaultSampleFor(key: string): string {
  const now = new Date();
  switch (key) {
    case 'label':
      return 'TEST Sample Label';
    case 'barcode':
      return '123456789012';
    case 'date':
      return now.toLocaleDateString();
    case 'time':
      return now.toLocaleTimeString();
    case 'seq':
      return '0001';
    case 'hn_masked':
      return 'HN***';
    default:
      return key.toUpperCase();
  }
}

function placeholdersOf(content: string): string[] {
  return Array.from(new Set(Array.from(content.matchAll(PLACEHOLDER_PATTERN)).map((m) => m[1] ?? '')));
}

function buildSample(
  mode: SampleMode,
  content: string,
  profile?: PaperProfileOption,
): Record<string, unknown> {
  if (mode === 'empty') return {};
  const payload: Record<string, unknown> = {};
  if (mode === 'profile' && profile) {
    for (const field of profile.fields ?? []) {
      if (field.key) payload[field.key] = field.defaultValue ?? field.label ?? field.key;
    }
    return payload;
  }
  for (const key of placeholdersOf(content)) payload[key] = defaultSampleFor(key);
  for (const extra of ['label', 'barcode', 'date', 'time', 'seq', 'hn_masked']) {
    if (!(extra in payload)) payload[extra] = defaultSampleFor(extra);
  }
  return payload;
}

/**
 * Client-side render of unsaved editor content. The server preview endpoint
 * only accepts a saved template id, so the create/edit form previews locally
 * with the same escape-and-frame treatment SimpleTemplateRenderer applies.
 */
function localPreview(content: string, engine: string, sample: Record<string, unknown>): string {
  const rendered = content.replace(PLACEHOLDER_PATTERN, (_raw, key: string) => {
    const value = sample[key];
    return value == null ? '' : String(value);
  });
  if (engine === 'HTML') return rendered;
  return `<pre class="tpl-preview-raw">${escapeHtml(rendered)}</pre>`;
}

function formatDate(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale === 'th' ? 'th-TH' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Templates() {
  const { t, locale } = useLocale();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profiles, setProfiles] = useState<PaperProfileOption[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewNote, setPreviewNote] = useState<string>('');
  const [previewError, setPreviewError] = useState<string>('');
  const [sampleMode, setSampleMode] = useState<SampleMode>('default');
  const [fullPage, setFullPage] = useState(false);

  const [search, setSearch] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [chip, setChip] = useState<string>('ALL');
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  const load = () => apiFetch<Template[]>('/v1/templates').then(setTemplates).catch(() => {});
  const loadProfiles = () => apiFetch<PaperProfileOption[]>('/v1/paper-profiles').then(setProfiles).catch(() => {});
  useEffect(() => { void load(); void loadProfiles(); }, []);

  // Row "more" menu closes on any outside click, like a native popup menu.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const selected = templates.find((tpl) => tpl.id === selectedId);
  const formProfile = profiles.find((p) => p.id === form.paperProfileId);
  const selectedProfile = profiles.find((p) => p.id === selected?.paperProfileId);
  const profileKeys = (formProfile?.fields ?? []).map((f) => f.key).filter(Boolean);

  const contentLines = form.content.split('\n');

  function insertVariable(token: string) {
    const snippet = `{{${token}}}`;
    const el = contentRef.current;
    if (!el) {
      setForm((prev) => ({ ...prev, content: prev.content + snippet }));
      return;
    }
    const start = el.selectionStart ?? form.content.length;
    const end = el.selectionEnd ?? start;
    const next = form.content.slice(0, start) + snippet + form.content.slice(end);
    setForm((prev) => ({ ...prev, content: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  function showLocalPreview() {
    const sample = buildSample(sampleMode, form.content, formProfile);
    setSelectedId(null);
    setPreview(null);
    setPreviewError('');
    setPreviewNote(t('page.templates.localPreviewNote'));
    setPreviewHtml(localPreview(form.content, form.engine, sample));
  }

  async function renderServerPreview(tpl: Template, mode: SampleMode = sampleMode) {
    setSelectedId(tpl.id);
    setPreviewNote('');
    const profile = profiles.find((p) => p.id === tpl.paperProfileId);
    if (!tpl.paperProfileId) {
      setPreview(null);
      setPreviewHtml('');
      setPreviewError(t('page.templates.previewNeedsPaper'));
      return;
    }
    try {
      const res = await apiFetch<PreviewResponse>(`/v1/templates/${tpl.id}/preview`, {
        method: 'POST',
        body: JSON.stringify({
          samplePayload: buildSample(mode, tpl.content, profile),
          paperProfileId: tpl.paperProfileId,
        }),
      });
      setPreview(res);
      setPreviewHtml(res.renderedPreview);
      setPreviewError('');
    } catch {
      setPreview(null);
      setPreviewHtml('');
      setPreviewError(t('page.templates.previewFailed'));
    }
  }

  function refreshPreview(mode: SampleMode) {
    setSampleMode(mode);
    if (selected) {
      void renderServerPreview(selected, mode);
      return;
    }
    const sample = buildSample(mode, form.content, formProfile);
    setPreviewNote(t('page.templates.localPreviewNote'));
    setPreviewHtml(localPreview(form.content, form.engine, sample));
  }

  async function submit() {
    if (!form.templateCode.trim() || !form.name.trim()) {
      setMessage({ tone: 'error', text: t('page.templates.requiredFields') });
      return;
    }
    setBusy(true);
    try {
      const body = JSON.stringify({ ...form, paperProfileId: form.paperProfileId || undefined });
      if (editingId) {
        await apiFetch(`/v1/templates/${editingId}`, { method: 'PUT', body });
        setMessage({ tone: 'ok', text: t('page.templates.savedOk') });
      } else {
        await apiFetch('/v1/templates', { method: 'POST', body });
        setMessage({ tone: 'ok', text: t('page.templates.created') });
      }
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      await load();
    } catch {
      setMessage({ tone: 'error', text: t('page.templates.actionFailed') });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(tpl: Template) {
    setEditingId(tpl.id);
    setForm({
      templateCode: tpl.templateCode,
      name: tpl.name,
      engine: tpl.engine,
      content: tpl.content,
      paperProfileId: tpl.paperProfileId ?? '',
    });
    setMenuFor(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function newTemplate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestAnimationFrame(() => formRef.current?.querySelector('input')?.focus());
  }

  async function duplicate(tpl: Template) {
    setMenuFor(null);
    try {
      await apiFetch('/v1/templates', {
        method: 'POST',
        body: JSON.stringify({
          templateCode: `${tpl.templateCode}_COPY`,
          name: `${tpl.name} (copy)`,
          engine: tpl.engine,
          content: tpl.content,
          paperProfileId: tpl.paperProfileId,
        }),
      });
      setMessage({ tone: 'ok', text: t('page.templates.duplicated') });
      await load();
    } catch {
      setMessage({ tone: 'error', text: t('page.templates.actionFailed') });
    }
  }

  async function publish(id: string) {
    setMenuFor(null);
    try {
      await apiFetch(`/v1/templates/${id}/publish`, { method: 'POST' });
      setMessage({ tone: 'ok', text: t('page.templates.publishedOk') });
      await load();
    } catch {
      setMessage({ tone: 'error', text: t('page.templates.actionFailed') });
    }
  }

  async function testPrint(id: string) {
    setMenuFor(null);
    try {
      await apiFetch(`/v1/templates/${id}/test-print`, { method: 'POST' });
      setMessage({ tone: 'ok', text: t('page.templates.testPrintSent') });
    } catch {
      setMessage({ tone: 'error', text: t('page.templates.actionFailed') });
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tpl of templates) counts[tpl.status] = (counts[tpl.status] ?? 0) + 1;
    return counts;
  }, [templates]);

  const engineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tpl of templates) counts[tpl.engine] = (counts[tpl.engine] ?? 0) + 1;
    return counts;
  }, [templates]);

  const filtered = useMemo(() => {
    const needle = `${search} ${listSearch}`.trim().toLowerCase();
    const terms = [search.trim().toLowerCase(), listSearch.trim().toLowerCase()].filter(Boolean);
    const rows = templates.filter((tpl) => {
      if (chip !== 'ALL' && tpl.status !== chip && tpl.engine !== chip) return false;
      if (!needle) return true;
      const haystack = `${tpl.templateCode} ${tpl.name} ${tpl.engine} ${tpl.status}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    return rows.sort((a, b) => {
      const av = a.updatedAt ?? a.createdAt ?? '';
      const bv = b.updatedAt ?? b.createdAt ?? '';
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    });
  }, [templates, chip, search, listSearch, sortDesc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const from = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, filtered.length);

  useEffect(() => { setPage(1); }, [chip, search, listSearch, pageSize]);

  const previewBody = (
    <div className="tpl-preview-stage">
      {previewError ? (
        <p className="tpl-preview-empty">{previewError}</p>
      ) : previewHtml ? (
        <div className="tpl-preview-paper" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      ) : (
        <p className="tpl-preview-empty">{t('page.templates.selectPreview')}</p>
      )}
    </div>
  );

  return (
    <div className="templates-page">
      <header className="tpl-page-header">
        <div className="tpl-page-heading">
          <h1>{t('page.templates.title')}</h1>
          <p>{t('page.templates.subtitle')}</p>
        </div>
        <div className="tpl-page-tools">
          <label className="tpl-search">
            <span aria-hidden="true">🔍</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('page.templates.searchPlaceholder')}
              aria-label={t('page.templates.searchPlaceholder')}
            />
          </label>
          <button type="button" className="tpl-btn tpl-btn--primary" onClick={newTemplate}>
            + {t('page.templates.newTemplate')}
          </button>
        </div>
      </header>

      {message && (
        <div className={`tpl-message tpl-message--${message.tone}`} role="status">{message.text}</div>
      )}

      <div className="tpl-layout">
        <section className="tpl-card tpl-editor" ref={formRef}>
          <h2 className="tpl-card-title">
            {editingId ? t('page.templates.editTemplate') : t('page.templates.createTemplate')}
          </h2>

          <div className="tpl-editor-top">
            <div className="tpl-field-grid">
              <label className="tpl-field">
                <span>{t('page.templates.templateCode')} <b aria-hidden="true">*</b></span>
                <input
                  value={form.templateCode}
                  onChange={(e) => setForm({ ...form, templateCode: e.target.value })}
                  placeholder={t('page.templates.templateCodePlaceholder')}
                />
              </label>
              <label className="tpl-field">
                <span>{t('page.templates.templateName')} <b aria-hidden="true">*</b></span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('page.templates.templateNamePlaceholder')}
                />
              </label>
              <label className="tpl-field">
                <span>{t('page.templates.paperProfile')}</span>
                <select
                  value={form.paperProfileId}
                  onChange={(e) => setForm({ ...form, paperProfileId: e.target.value })}
                >
                  <option value="">{t('page.templates.selectPaperProfile')}</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                </select>
              </label>
            </div>

            <fieldset className="tpl-engine-picker">
              <legend>{t('page.templates.engineType')}</legend>
              <div className="tpl-engine-grid">
                {ENGINES.map((engine) => (
                  <button
                    type="button"
                    key={engine}
                    className={`tpl-engine-card${form.engine === engine ? ' is-selected' : ''}`}
                    aria-pressed={form.engine === engine}
                    onClick={() => setForm({ ...form, engine })}
                  >
                    <span className="tpl-engine-card__icon" aria-hidden="true">{ENGINE_ICON[engine]}</span>
                    <span className="tpl-engine-card__text">
                      <strong>{engine}</strong>
                      <small>{t(`page.templates.engineDesc.${engine}`)}</small>
                    </span>
                    {form.engine === engine && <span className="tpl-engine-card__check" aria-hidden="true">✔</span>}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="tpl-content-block">
            <span className="tpl-field-label">{t('page.templates.content')}</span>
            <div className="tpl-content-row">
              <div className="tpl-code-editor">
                <div className="tpl-code-gutter" aria-hidden="true" ref={gutterRef}>
                  {contentLines.map((_, i) => <span key={i}>{i + 1}</span>)}
                </div>
                <textarea
                  ref={contentRef}
                  value={form.content}
                  spellCheck={false}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  onScroll={(e) => {
                    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                  }}
                  aria-label={t('page.templates.content')}
                />
              </div>
              <aside className="tpl-vars">
                <h3>{t('page.templates.availableKeys')}</h3>
                <ul>
                  {VARIABLES.map((v) => (
                    <li key={v.token}>
                      <button type="button" onClick={() => insertVariable(v.token)}>
                        <code>{`{{${v.token}}}`}</code>
                        <span>{t(v.labelKey)}</span>
                      </button>
                    </li>
                  ))}
                  {profileKeys.filter((k) => !VARIABLES.some((v) => v.token === k)).map((key) => (
                    <li key={key}>
                      <button type="button" onClick={() => insertVariable(key)}>
                        <code>{`{{${key}}}`}</code>
                        <span>{formProfile?.fields.find((f) => f.key === key)?.label ?? key}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="tpl-vars__hint">{t('page.templates.insertHint')}</p>
              </aside>
            </div>
          </div>

          <div className="tpl-editor-actions">
            <button type="button" className="tpl-btn tpl-btn--ghost" onClick={showLocalPreview}>
              👁 {t('page.templates.previewBtn')}
            </button>
            <div className="tpl-editor-actions__right">
              <button type="button" className="tpl-btn tpl-btn--primary" onClick={() => void submit()} disabled={busy}>
                💾 {editingId ? t('page.templates.saveBtn') : t('page.templates.createTemplate')}
              </button>
              <button
                type="button"
                className="tpl-btn tpl-btn--link"
                onClick={() => { setForm({ ...EMPTY_FORM }); setEditingId(null); }}
              >
                {editingId ? t('page.templates.cancelEdit') : t('page.templates.clearBtn')}
              </button>
            </div>
          </div>
        </section>

        <section className="tpl-card tpl-preview">
          <div className="tpl-preview-header">
            <h2 className="tpl-card-title">{t('page.templates.previewTitle')}</h2>
            <div className="tpl-preview-controls">
              <select
                aria-label={t('page.templates.sampleInput')}
                value={sampleMode}
                onChange={(e) => refreshPreview(e.target.value as SampleMode)}
              >
                <option value="default">{t('page.templates.sampleDefault')}</option>
                <option value="profile">{t('page.templates.sampleProfile')}</option>
                <option value="empty">{t('page.templates.sampleEmpty')}</option>
              </select>
              <button type="button" className="tpl-btn tpl-btn--ghost" onClick={() => refreshPreview(sampleMode)}>
                ⟳ {t('common.refresh')}
              </button>
              <button
                type="button"
                className="tpl-btn tpl-btn--ghost"
                onClick={() => setFullPage(true)}
                disabled={!previewHtml}
              >
                ⛶ {t('page.templates.fullPage')}
              </button>
            </div>
          </div>

          {previewBody}
          {previewNote && <p className="tpl-preview-note">{previewNote}</p>}
          {preview && preview.warnings.length > 0 && (
            <p className="tpl-preview-warnings">
              {t('page.templates.previewWarnings')}: {preview.warnings.join(', ')}
            </p>
          )}

          <div className="tpl-info">
            <h3>{t('page.templates.templateInfo')}</h3>
            <dl>
              <div><dt>{t('page.templates.engine')}</dt><dd>{selected?.engine ?? form.engine}</dd></div>
              <div>
                <dt>{t('page.templates.paperProfile')}</dt>
                <dd>{(selected ? selectedProfile?.name : formProfile?.name) ?? t('page.templates.noPaperProfile')}</dd>
              </div>
              <div><dt>{t('page.templates.version')}</dt><dd>{selected?.version ?? '—'}</dd></div>
              <div><dt>{t('page.templates.status')}</dt><dd>{selected?.status ?? t('page.templates.unsavedDraft')}</dd></div>
              <div><dt>{t('page.templates.createdBy')}</dt><dd>{selected?.createdBy ?? '—'}</dd></div>
              <div><dt>{t('page.templates.createdAt')}</dt><dd>{formatDate(selected?.createdAt, locale)}</dd></div>
              <div><dt>{t('page.templates.updatedAt')}</dt><dd>{formatDate(selected?.updatedAt, locale)}</dd></div>
            </dl>
          </div>
        </section>
      </div>

      <section className="tpl-card tpl-list">
        <div className="tpl-list-header">
          <h2 className="tpl-card-title">{t('page.templates.listTitle')}</h2>
          <div className="tpl-list-tools">
            <label className="tpl-search tpl-search--sm">
              <span aria-hidden="true">🔍</span>
              <input
                type="search"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder={t('page.templates.searchList')}
                aria-label={t('page.templates.searchList')}
              />
            </label>
            <button type="button" className="tpl-icon-btn" onClick={() => void load()} title={t('common.refresh')}>⟳</button>
            <button
              type="button"
              className="tpl-icon-btn"
              onClick={() => setSortDesc((v) => !v)}
              title={t('page.templates.updated')}
              aria-pressed={sortDesc}
            >
              {sortDesc ? '↓' : '↑'}
            </button>
          </div>
        </div>

        <div className="tpl-chips">
          <button
            type="button"
            className={`tpl-chip${chip === 'ALL' ? ' is-active' : ''}`}
            onClick={() => setChip('ALL')}
          >
            {t('page.templates.filterAll')} <b>{templates.length}</b>
          </button>
          {Object.entries(statusCounts).map(([status, count]) => (
            <button
              type="button"
              key={status}
              className={`tpl-chip${chip === status ? ' is-active' : ''}`}
              onClick={() => setChip(status)}
            >
              {status} <b>{count}</b>
            </button>
          ))}
          {Object.entries(engineCounts).map(([engine, count]) => (
            <button
              type="button"
              key={engine}
              className={`tpl-chip${chip === engine ? ' is-active' : ''}`}
              onClick={() => setChip(engine)}
            >
              {engine} <b>{count}</b>
            </button>
          ))}
        </div>

        <div className="tpl-table-wrap">
          <table className="tpl-table">
            <thead>
              <tr>
                <th>{t('page.templates.code')}</th>
                <th>{t('page.templates.name')}</th>
                <th>{t('page.templates.engine')}</th>
                <th>{t('page.templates.version')}</th>
                <th>{t('page.templates.status')}</th>
                <th>{t('page.templates.updated')}</th>
                <th className="tpl-table__actions-col">{t('page.templates.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((tpl) => (
                <tr key={tpl.id} className={tpl.id === selectedId ? 'is-selected' : undefined}>
                  <td><code>{tpl.templateCode}</code></td>
                  <td className="tpl-cell-name"><span className="truncate">{tpl.name}</span></td>
                  <td><span className="tpl-engine-pill">{tpl.engine}</span></td>
                  <td>{tpl.version}</td>
                  <td><span className={`tpl-badge ${STATUS_TONE[tpl.status] ?? ''}`}>{tpl.status}</span></td>
                  <td className="tpl-cell-time">{formatDate(tpl.updatedAt ?? tpl.createdAt, locale)}</td>
                  <td>
                    <div className="tpl-row-actions">
                      <button
                        type="button"
                        className="tpl-icon-btn"
                        title={t('common.preview')}
                        onClick={() => void renderServerPreview(tpl)}
                      >👁</button>
                      <button
                        type="button"
                        className="tpl-icon-btn"
                        title={t('page.templates.duplicate')}
                        onClick={() => void duplicate(tpl)}
                      >⧉</button>
                      <button
                        type="button"
                        className="tpl-icon-btn"
                        title={t('page.templates.edit')}
                        onClick={() => startEdit(tpl)}
                      >✎</button>
                      <div className="tpl-menu-wrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="tpl-icon-btn"
                          title={t('page.templates.more')}
                          aria-expanded={menuFor === tpl.id}
                          onClick={() => setMenuFor(menuFor === tpl.id ? null : tpl.id)}
                        >⋯</button>
                        {menuFor === tpl.id && (
                          <div className="tpl-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => void publish(tpl.id)}>
                              {t('common.publish')}
                            </button>
                            <button type="button" role="menuitem" onClick={() => void testPrint(tpl.id)}>
                              {t('page.templates.testPrint')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="tpl-table-empty">{t('page.templates.noResults')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="tpl-pagination">
          <span className="tpl-pagination__count">
            {t('page.templates.showing')
              .replace('{from}', String(from))
              .replace('{to}', String(to))
              .replace('{total}', String(filtered.length))}
          </span>
          <div className="tpl-pagination__pages">
            <button
              type="button"
              className="tpl-icon-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="previous page"
            >‹</button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <button
                type="button"
                key={n}
                className={`tpl-page-btn${n === currentPage ? ' is-active' : ''}`}
                onClick={() => setPage(n)}
              >{n}</button>
            ))}
            <button
              type="button"
              className="tpl-icon-btn"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={currentPage >= pageCount}
              aria-label="next page"
            >›</button>
          </div>
          <select
            className="tpl-page-size"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label={t('page.templates.rowsPerPage').replace('{n}', String(pageSize))}
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>{t('page.templates.rowsPerPage').replace('{n}', String(n))}</option>
            ))}
          </select>
        </div>
      </section>

      {fullPage && (
        <div className="tpl-modal" role="dialog" aria-modal="true" onClick={() => setFullPage(false)}>
          <div className="tpl-modal__panel" onClick={(e) => e.stopPropagation()}>
            <div className="tpl-modal__header">
              <h2>{t('page.templates.previewTitle')}</h2>
              <button
                type="button"
                className="tpl-icon-btn"
                onClick={() => setFullPage(false)}
                aria-label={t('page.templates.closePreview')}
              >✕</button>
            </div>
            <div className="tpl-modal__body">
              <div className="tpl-preview-paper" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
