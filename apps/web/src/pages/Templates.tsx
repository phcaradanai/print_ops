import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { EmptyState, ErrorBanner, Freshness, LoadingState } from '../components/PageState.js';
import { exportJsonFile } from '../tauri.js';
import { qrQuietZoneMm, renderBarcodeSvg, type BarcodeKind, type BarcodeSymbology } from '../lib/barcode.js';
import { sanitizePreviewHtml } from '../lib/previewHtml.js';
import { useModalFocusTrap } from '../components/Dialog.js';

const WS_PATH_KEY = 'printops-workspace-path';

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
  type?: 'text' | 'barcode' | 'qrcode' | 'date' | 'number';
  barcodeSymbology?: BarcodeSymbology;
  barcodeHeightMm?: number;
  qrSizeMm?: number;
}

const DEFAULT_BARCODE_HEIGHT_MM = 12;
const DEFAULT_QR_SIZE_MM = 20;

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

/** Portable shape written by Export and accepted by Import. */
interface TemplateExportEntry {
  templateCode: string;
  name: string;
  engine: string;
  content: string;
  status?: string;
  paperProfileCode?: string;
}

interface TemplateExportFile {
  kind: 'printops.templates';
  version: 1;
  exportedAt: string;
  templates: TemplateExportEntry[];
}

const EXPORT_KIND = 'printops.templates';

const ENGINES = ['RAW_TEXT', 'ZPL', 'HTML', 'JSON_LAYOUT', 'TSPL', 'EPL', 'PDF_LIKE_PREVIEW'] as const;

type TemplateIconName =
  | 'back' | 'barcode' | 'braces' | 'check' | 'close' | 'code' | 'delete'
  | 'download' | 'duplicate' | 'edit' | 'expand' | 'label' | 'more'
  | 'next' | 'pdf' | 'plus' | 'preview' | 'printer' | 'qrcode' | 'refresh'
  | 'save' | 'search' | 'sortAsc' | 'sortDesc' | 'terminal' | 'text' | 'upload';

const ENGINE_ICON: Record<typeof ENGINES[number], TemplateIconName> = {
  RAW_TEXT: 'text',
  ZPL: 'label',
  HTML: 'code',
  JSON_LAYOUT: 'braces',
  TSPL: 'printer',
  EPL: 'terminal',
  PDF_LIKE_PREVIEW: 'pdf',
};

function TemplateIcon({ name, spin = false }: { name: TemplateIconName; spin?: boolean }) {
  const path = {
    back: <path d="m10.5 3.5-4.5 4.5 4.5 4.5M6 8h8" />,
    barcode: <path d="M2 3v10M4.5 3v10M7.5 3v10M9.5 3v10M13 3v10" />,
    braces: <path d="M6 2.5H5A1.5 1.5 0 0 0 3.5 4v2.25C3.5 7.3 3 8 2 8c1 0 1.5.7 1.5 1.75V12A1.5 1.5 0 0 0 5 13.5h1m4-11h1A1.5 1.5 0 0 1 12.5 4v2.25C12.5 7.3 13 8 14 8c-1 0-1.5.7-1.5 1.75V12a1.5 1.5 0 0 1-1.5 1.5h-1" />,
    check: <path d="m3.25 8.25 3 3 6.5-6.5" />,
    close: <path d="m3.5 3.5 9 9m0-9-9 9" />,
    code: <path d="m5.75 3.5-4 4.5 4 4.5m4.5-9 4 4.5-4 4.5M9.5 2l-3 12" />,
    delete: <path d="M3.5 5h9M6 5V3.25h4V5m1.5 0-.5 8H5L4.5 5M6.75 7.5v3.25m2.5-3.25v3.25" />,
    download: <path d="M8 2v8m-3-3 3 3 3-3M3 13h10" />,
    duplicate: <><rect x="5" y="5" width="8" height="8" rx="1.25" /><path d="M3 10.5H2.75A1.75 1.75 0 0 1 1 8.75v-6A1.75 1.75 0 0 1 2.75 1h6A1.75 1.75 0 0 1 10.5 2.75V3" /></>,
    edit: <path d="m3 11.75.5-3 7.75-7.25 3.25 3.25-7.25 7.75-3 .5Zm6.75-8.75 3.25 3.25" />,
    expand: <path d="M6 2H2v4m0-4 4.5 4.5M10 14h4v-4m0 4-4.5-4.5" />,
    label: <><path d="M2.5 4.5v7h7l4-3.5-4-3.5h-7Z" /><circle cx="5.25" cy="8" r=".7" fill="currentColor" stroke="none" /></>,
    more: <><circle cx="3" cy="8" r=".75" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r=".75" fill="currentColor" stroke="none" /><circle cx="13" cy="8" r=".75" fill="currentColor" stroke="none" /></>,
    next: <path d="m6 3.5 4.5 4.5L6 12.5" />,
    pdf: <><path d="M9.5 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.25Z" /><path d="M9.5 1.75v3.5H13M5.25 9h5.5M5.25 11.5h3.5" /></>,
    plus: <path d="M8 2.5v11M2.5 8h11" />,
    preview: <><path d="M1.5 8s2.25-4 6.5-4 6.5 4 6.5 4-2.25 4-6.5 4-6.5-4-6.5-4Z" /><circle cx="8" cy="8" r="2" /></>,
    printer: <><path d="M4.5 5V2.5h7V5M4 11H2.75A1.25 1.25 0 0 1 1.5 9.75V6.5A1.5 1.5 0 0 1 3 5h10a1.5 1.5 0 0 1 1.5 1.5v3.25A1.25 1.25 0 0 1 13.25 11H12" /><path d="M4 9h8v4.5H4Z" /></>,
    qrcode: <><rect x="2" y="2" width="4" height="4" /><rect x="10" y="2" width="4" height="4" /><rect x="2" y="10" width="4" height="4" /><path d="M10 10h2v2h2v2h-4v-4Z" /></>,
    refresh: <path d="M13 5.25A5.5 5.5 0 1 0 13.5 10M13 2.5v2.75h-2.75" />,
    save: <><path d="M2.5 2.5h9l2 2v9h-11Z" /><path d="M5 2.5v4h5v-4M5 13.5V9h6v4.5" /></>,
    search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></>,
    sortAsc: <path d="M8 13V3m-3 3 3-3 3 3" />,
    sortDesc: <path d="M8 3v10m-3-3 3 3 3-3" />,
    terminal: <><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" /><path d="m4.25 6 2 2-2 2M8.25 10h3" /></>,
    text: <path d="M2.5 3h11M2.5 6.5h11M2.5 10h8M2.5 13h5" />,
    upload: <path d="M8 10V2m-3 3 3-3 3 3M3 13h10" />,
  }[name];

  return (
    <svg className={`tpl-action-icon${spin ? ' tpl-action-icon--spin' : ''}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

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

/** Matches either explicit `{{barcode:key}}` / `{{qrcode:key}}`, or a plain
 * `{{key}}` — mirrors the server's SimpleTemplateRenderer token pattern. */
const COMBINED_PREVIEW_PATTERN = /\{\{\s*(?:(barcode|qrcode)\s*:\s*([a-zA-Z0-9_.-]+)|([a-zA-Z0-9_.-]+))\s*\}\}/g;

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
 * with the same escape-and-frame treatment SimpleTemplateRenderer applies —
 * including a REAL barcode/QR graphic for `{{barcode:key}}` / `{{qrcode:key}}`
 * tokens, or a plain `{{key}}` whose bound paper-profile field is typed
 * 'barcode'/'qrcode', matching the server renderer's inference exactly.
 */
function localPreview(
  content: string,
  engine: string,
  sample: Record<string, unknown>,
  profile?: PaperProfileOption,
): string {
  function resolveToken(explicitKind: BarcodeKind | undefined, key: string): { html: string; raw: boolean } {
    const field = profile?.fields.find((f) => f.key === key);
    const kind = explicitKind ?? (field?.type === 'barcode' || field?.type === 'qrcode' ? field.type : undefined);
    const value = sample[key];
    if (kind) {
      if (value == null) return { html: `[${kind}: ${key}]`, raw: false };
      const svg = renderBarcodeSvg(String(value), kind, field?.barcodeSymbology);
      if (svg) {
        // Real-size preview: match the paper-profile field's configured
        // physical size (mm), falling back to the same defaults the server
        // and Paper Profile editor use, so this preview matches what will
        // actually print.
        const heightMm = kind === 'qrcode' ? (field?.qrSizeMm ?? DEFAULT_QR_SIZE_MM) : (field?.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM);
        const widthCss = kind === 'qrcode' ? `${heightMm}mm` : 'auto';
        const quietMm = kind === 'qrcode' ? (qrQuietZoneMm(String(value), heightMm) ?? 0) : 0;
        const sizedSvg = svg.replace('<svg ', `<svg style="height:100%;width:${kind === 'qrcode' ? '100%' : 'auto'}" `);
        return {
          html: `<span class="tpl-preview-barcode" style="display:inline-block;height:${heightMm}mm;width:${widthCss};padding:${quietMm}mm;background:#fff;line-height:0;vertical-align:middle">${sizedSvg}</span>`,
          raw: true,
        };
      }
      return { html: `[${kind}: ${String(value)}]`, raw: false };
    }
    return { html: value == null ? '' : String(value), raw: false };
  }

  if (engine === 'HTML') {
    return content.replace(COMBINED_PREVIEW_PATTERN, (_raw, kind: BarcodeKind | undefined, explicitKey: string | undefined, plainKey: string | undefined) =>
      resolveToken(kind, (explicitKey ?? plainKey)!).html,
    );
  }

  let out = '';
  let lastIndex = 0;
  for (const m of content.matchAll(COMBINED_PREVIEW_PATTERN)) {
    const idx = m.index ?? 0;
    out += escapeHtml(content.slice(lastIndex, idx));
    const key = (m[2] ?? m[3])!;
    const { html, raw } = resolveToken(m[1] as BarcodeKind | undefined, key);
    out += raw ? html : escapeHtml(html);
    lastIndex = idx + m[0].length;
  }
  out += escapeHtml(content.slice(lastIndex));
  return `<pre class="tpl-preview-raw">${out}</pre>`;
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
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
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
  const [chip, setChip] = useState<string>('ALL');
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Template | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const deleteModalRef = useRef<HTMLDivElement | null>(null);
  const discardModalRef = useRef<HTMLDivElement | null>(null);
  const fullPreviewModalRef = useRef<HTMLDivElement | null>(null);

  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const libraryRef = useRef<HTMLElement | null>(null);
  useModalFocusTrap(Boolean(pendingDelete), deleteModalRef, () => setPendingDelete(null));
  useModalFocusTrap(confirmDiscard, discardModalRef, () => setConfirmDiscard(false));
  useModalFocusTrap(fullPage, fullPreviewModalRef, () => setFullPage(false));

  // Both lists were `.catch(() => {})`: with the API down the page rendered as
  // "no templates configured", which is indistinguishable from a fresh install
  // and invites someone to re-create templates that already exist.
  const fetchTemplates = useCallback(() => apiFetch<Template[]>('/v1/templates'), []);
  const fetchProfiles = useCallback(() => apiFetch<PaperProfileOption[]>('/v1/paper-profiles'), []);

  const templatesResource = useApiResource(fetchTemplates);
  const profilesResource = useApiResource(fetchProfiles);
  const templates = templatesResource.data ?? [];
  const profiles = profilesResource.data ?? [];

  const load = useCallback(() => templatesResource.refresh(), [templatesResource.refresh]);

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
  const editingTemplate = templates.find((tpl) => tpl.id === editingId);
  const formProfile = profiles.find((p) => p.id === form.paperProfileId);
  const selectedProfile = profiles.find((p) => p.id === selected?.paperProfileId);
  const profileKeys = (formProfile?.fields ?? []).map((f) => f.key).filter(Boolean);

  const contentLines = form.content.split('\n');
  const baselineForm = editingTemplate ? {
    templateCode: editingTemplate.templateCode,
    name: editingTemplate.name,
    engine: editingTemplate.engine,
    content: editingTemplate.content,
    paperProfileId: editingTemplate.paperProfileId ?? '',
  } : EMPTY_FORM;
  const formDirty = Object.keys(EMPTY_FORM).some((key) => form[key as keyof typeof form] !== baselineForm[key as keyof typeof baselineForm]);

  function insertSnippet(snippet: string) {
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

  function insertVariable(token: string) {
    insertSnippet(`{{${token}}}`);
  }

  /** Inserts `{{barcode:key}}` / `{{qrcode:key}}`, preferring a paper-profile
   * field already typed that way so the token "just works" against real data. */
  function insertBarcodeToken(kind: BarcodeKind) {
    const matchingField = formProfile?.fields.find((f) => f.type === kind);
    const key = matchingField?.key || (kind === 'qrcode' ? 'qrcode' : 'barcode');
    insertSnippet(`{{${kind}:${key}}}`);
  }

  function showLocalPreview() {
    const sample = buildSample(sampleMode, form.content, formProfile);
    setSelectedId(null);
    setPreview(null);
    setPreviewError('');
    setPreviewNote(t('page.templates.localPreviewNote'));
    setPreviewHtml(localPreview(form.content, form.engine, sample, formProfile));
  }

  async function renderServerPreview(tpl: Template, mode: SampleMode = sampleMode, revealWorkspace = true) {
    setSelectedId(tpl.id);
    if (revealWorkspace) {
      setWorkspaceOpen(true);
      setEditingId(tpl.id);
      setForm({
        templateCode: tpl.templateCode,
        name: tpl.name,
        engine: tpl.engine,
        content: tpl.content,
        paperProfileId: tpl.paperProfileId ?? '',
      });
      requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
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
      setPreviewHtml(sanitizePreviewHtml(res.renderedPreview));
      setPreviewError('');
    } catch (err: unknown) {
      setPreview(null);
      setPreviewHtml('');
      setPreviewError(`${t('page.templates.previewFailed')} ${errorMessage(err)}`);
    }
  }

  function refreshPreview(mode: SampleMode) {
    setSampleMode(mode);
    if (selected) {
      void renderServerPreview(selected, mode, false);
      return;
    }
    const sample = buildSample(mode, form.content, formProfile);
    setPreviewNote(t('page.templates.localPreviewNote'));
    setPreviewHtml(localPreview(form.content, form.engine, sample, formProfile));
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
      setWorkspaceOpen(false);
      requestAnimationFrame(() => libraryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err: unknown) {
      setMessage({ tone: 'error', text: `${t('page.templates.actionFailed')} ${errorMessage(err)}` });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(tpl: Template) {
    setWorkspaceOpen(true);
    setEditingId(tpl.id);
    setSelectedId(tpl.id);
    setPreview(null);
    setPreviewHtml('');
    setPreviewNote('');
    setPreviewError('');
    setForm({
      templateCode: tpl.templateCode,
      name: tpl.name,
      engine: tpl.engine,
      content: tpl.content,
      paperProfileId: tpl.paperProfileId ?? '',
    });
    setMenuFor(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function newTemplate() {
    setWorkspaceOpen(true);
    setEditingId(null);
    setSelectedId(null);
    setPreview(null);
    setPreviewHtml('');
    setPreviewNote('');
    setPreviewError('');
    setForm({ ...EMPTY_FORM });
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      formRef.current?.querySelector('input')?.focus();
    });
  }

  function closeWorkspace() {
    setWorkspaceOpen(false);
    setEditingId(null);
    setSelectedId(null);
    setForm({ ...EMPTY_FORM });
    setPreview(null);
    setPreviewHtml('');
    setPreviewNote('');
    setPreviewError('');
    requestAnimationFrame(() => libraryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function requestCloseWorkspace() {
    if (formDirty) {
      setConfirmDiscard(true);
      return;
    }
    closeWorkspace();
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
    } catch (err: unknown) {
      setMessage({ tone: 'error', text: `${t('page.templates.actionFailed')} ${errorMessage(err)}` });
    }
  }

  async function publish(id: string) {
    setMenuFor(null);
    try {
      await apiFetch(`/v1/templates/${id}/publish`, { method: 'POST' });
      setMessage({ tone: 'ok', text: t('page.templates.publishedOk') });
      await load();
    } catch (err: unknown) {
      setMessage({ tone: 'error', text: `${t('page.templates.actionFailed')} ${errorMessage(err)}` });
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    try {
      await apiFetch(`/v1/templates/${target.id}`, { method: 'DELETE' });
      if (selectedId === target.id) {
        setSelectedId(null);
        setPreview(null);
        setPreviewHtml('');
      }
      if (editingId === target.id) {
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
        setWorkspaceOpen(false);
      }
      setMessage({ tone: 'ok', text: t('page.templates.deletedOk') });
      await load();
    } catch (err) {
      const status = String(err instanceof Error ? err.message : '');
      const text = status.endsWith('409')
        ? t('page.templates.deleteBound')
        : status.endsWith('403')
          ? t('page.templates.deleteForbidden')
          : t('page.templates.actionFailed');
      setMessage({ tone: 'error', text });
    }
  }

  /** Export uses paperProfileCode, not the local profile id, so a file stays portable across installs. */
  async function exportTemplates() {
    const rows = templates;
    if (rows.length === 0) {
      setMessage({ tone: 'error', text: t('page.templates.exportEmpty') });
      return;
    }
    const file: TemplateExportFile = {
      kind: EXPORT_KIND,
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: rows.map((tpl) => ({
        templateCode: tpl.templateCode,
        name: tpl.name,
        engine: tpl.engine,
        content: tpl.content,
        status: tpl.status,
        paperProfileCode: profiles.find((p) => p.id === tpl.paperProfileId)?.code,
      })),
    };
    const json = JSON.stringify(file, null, 2);
    const filename = `printops-templates-${new Date().toISOString().slice(0, 10)}.json`;
    const workspacePath = localStorage.getItem(WS_PATH_KEY) ?? '';

    const result = await exportJsonFile(filename, json, workspacePath || undefined);
    if (result.cancelled) return;
    if (!result.success) {
      setMessage({ tone: 'error', text: result.message || t('page.templates.actionFailed') });
      return;
    }
    setMessage({
      tone: 'ok',
      text: result.path
        ? t('page.templates.exportedTo').replace('{n}', String(rows.length)).replace('{path}', result.path)
        : t('page.templates.exported').replace('{n}', String(rows.length)),
    });
  }

  function parseImport(raw: string): TemplateExportEntry[] | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as TemplateExportFile).templates)
        ? (parsed as TemplateExportFile).templates
        : null;
    if (!list) return null;
    const entries = list.filter((entry): entry is TemplateExportEntry =>
      typeof entry === 'object' && entry !== null &&
      typeof (entry as TemplateExportEntry).templateCode === 'string' &&
      typeof (entry as TemplateExportEntry).content === 'string');
    return entries.length > 0 ? entries : null;
  }

  async function importTemplates(file: File) {
    const entries = parseImport(await file.text());
    if (!entries) {
      setMessage({ tone: 'error', text: t('page.templates.importInvalid') });
      return;
    }
    setBusy(true);
    let created = 0;
    let updated = 0;
    let failed = 0;
    let firstFailure = '';
    for (const entry of entries) {
      const paperProfileId = entry.paperProfileCode
        ? profiles.find((p) => p.code === entry.paperProfileCode)?.id
        : undefined;
      const payload = {
        templateCode: entry.templateCode,
        name: entry.name || entry.templateCode,
        engine: ENGINES.includes(entry.engine as typeof ENGINES[number]) ? entry.engine : 'RAW_TEXT',
        content: entry.content,
        paperProfileId,
      };
      const existing = templates.find((tpl) => tpl.templateCode === entry.templateCode);
      try {
        if (existing) {
          await apiFetch(`/v1/templates/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          updated++;
        } else {
          await apiFetch('/v1/templates', { method: 'POST', body: JSON.stringify(payload) });
          created++;
        }
      } catch (err: unknown) {
        // Continuing past a bad entry is deliberate — one malformed template
        // must not abort a 40-template import. What was missing is the reason:
        // the summary reported "3 failed" and nothing else.
        failed++;
        if (!firstFailure) firstFailure = `${entry.templateCode}: ${errorMessage(err)}`;
      }
    }
    setBusy(false);
    const summary = t('page.templates.importDone')
      .replace('{created}', String(created))
      .replace('{updated}', String(updated))
      .replace('{failed}', String(failed));
    setMessage({
      tone: failed > 0 ? 'error' : 'ok',
      text: firstFailure ? `${summary} — ${firstFailure}` : summary,
    });
    load();
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
    const needle = search.trim().toLowerCase();
    const rows = templates.filter((tpl) => {
      if (chip !== 'ALL' && tpl.status !== chip && tpl.engine !== chip) return false;
      if (!needle) return true;
      const haystack = `${tpl.templateCode} ${tpl.name} ${tpl.engine} ${tpl.status}`.toLowerCase();
      return haystack.includes(needle);
    });
    return rows.sort((a, b) => {
      const av = a.updatedAt ?? a.createdAt ?? '';
      const bv = b.updatedAt ?? b.createdAt ?? '';
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    });
  }, [templates, chip, search, sortDesc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const from = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, filtered.length);
  const visiblePages = useMemo<(number | 'gap-start' | 'gap-end')[]>(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(pageCount - 1, currentPage + 1);
    const items: (number | 'gap-start' | 'gap-end')[] = [1];
    if (start > 2) items.push('gap-start');
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) items.push(pageNumber);
    if (end < pageCount - 1) items.push('gap-end');
    items.push(pageCount);
    return items;
  }, [currentPage, pageCount]);

  useEffect(() => { setPage(1); }, [chip, search, pageSize]);

  const previewBody = (
    <div className="tpl-preview-stage">
      {previewError ? (
        <p className="tpl-preview-empty">{previewError}</p>
      ) : previewHtml ? (
        <div className="tpl-preview-paper" dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(previewHtml) }} />
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
        {!workspaceOpen && <div className="tpl-page-tools">
          <label className="tpl-search">
            <TemplateIcon name="search" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('page.templates.searchPlaceholder')}
              aria-label={t('page.templates.searchPlaceholder')}
            />
          </label>
          <button type="button" className="tpl-btn tpl-btn--ghost" onClick={exportTemplates}>
            <TemplateIcon name="download" /> {t('page.templates.exportBtn')}
          </button>
          <button
            type="button"
            className="tpl-btn tpl-btn--ghost"
            onClick={() => importInputRef.current?.click()}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            <TemplateIcon name={busy ? 'refresh' : 'upload'} spin={busy} /> {busy ? t('page.templates.importing') : t('page.templates.importBtn')}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="tpl-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importTemplates(file);
            }}
          />
          <button type="button" className="tpl-btn tpl-btn--primary" onClick={newTemplate}>
            <TemplateIcon name="plus" /> {t('page.templates.newTemplate')}
          </button>
        </div>}
      </header>

      {message && (
        <div className={`ds-toast ds-toast--${message.tone === 'ok' ? 'success' : 'error'}`} role="status">
          <span>{message.text}</span>
          <button type="button" className="ds-toast__close" onClick={() => setMessage(null)} aria-label={t('common.close')}><TemplateIcon name="close" /></button>
        </div>
      )}

      {/* An empty template list must never be mistaken for "none configured". */}
      {templatesResource.error != null && (
        <ErrorBanner
          error={templatesResource.error}
          title={t('page.templates.loadFailed')}
          onRetry={templatesResource.refresh}
        />
      )}

      {profilesResource.error != null && (
        <ErrorBanner
          error={profilesResource.error}
          title={t('page.templates.profilesLoadFailed')}
          onRetry={profilesResource.refresh}
        />
      )}

      {(templatesResource.lastSuccessAt != null || templatesResource.error != null) && <div className="page-header">
        <span />
        <Freshness
          lastSuccessAt={templatesResource.lastSuccessAt}
          stale={templatesResource.stale}
          refreshing={templatesResource.refreshing}
          onRefresh={templatesResource.refresh}
        />
      </div>}

      {workspaceOpen ? <>
        <div className="tpl-workspace-bar">
          <button type="button" className="tpl-btn tpl-btn--ghost" onClick={requestCloseWorkspace}>
            <TemplateIcon name="back" /> {t('page.templates.backToLibrary')}
          </button>
          <span>{editingId ? form.templateCode : t('page.templates.newTemplate')}</span>
        </div>
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
                    <span className="tpl-engine-card__icon" aria-hidden="true"><TemplateIcon name={ENGINE_ICON[engine]} /></span>
                    <span className="tpl-engine-card__text">
                      <strong>{engine}</strong>
                      <small>{t(`page.templates.engineDesc.${engine}`)}</small>
                    </span>
                    {form.engine === engine && <span className="tpl-engine-card__check" aria-hidden="true"><TemplateIcon name="check" /></span>}
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
                <div className="tpl-vars__barcode-actions">
                  <button type="button" onClick={() => insertBarcodeToken('barcode')} title={t('page.templates.insertBarcodeHint')}>
                    <TemplateIcon name="barcode" /> {t('page.templates.insertBarcode')}
                  </button>
                  <button type="button" onClick={() => insertBarcodeToken('qrcode')} title={t('page.templates.insertQrcodeHint')}>
                    <TemplateIcon name="qrcode" /> {t('page.templates.insertQrcode')}
                  </button>
                </div>
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
              <TemplateIcon name="preview" /> {t('page.templates.previewBtn')}
            </button>
            <div className="tpl-editor-actions__right">
              <button type="button" className="tpl-btn tpl-btn--primary" onClick={() => void submit()} disabled={busy} aria-busy={busy || undefined}>
                <TemplateIcon name={busy ? 'refresh' : 'save'} spin={busy} /> {busy ? t('page.templates.saving') : editingId ? t('page.templates.saveBtn') : t('page.templates.createTemplate')}
              </button>
              <button
                type="button"
                className="tpl-btn tpl-btn--link"
                onClick={requestCloseWorkspace}
              >
                {t('page.templates.cancelEdit')}
              </button>
            </div>
          </div>
        </section>

        <section className="tpl-card tpl-preview" ref={previewRef}>
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
                <TemplateIcon name="refresh" /> {t('common.refresh')}
              </button>
              <button
                type="button"
                className="tpl-btn tpl-btn--ghost"
                onClick={() => setFullPage(true)}
                disabled={!previewHtml}
              >
                <TemplateIcon name="expand" /> {t('page.templates.fullPage')}
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
      </> : (

      <section className="tpl-card tpl-list" ref={libraryRef}>
        <div className="tpl-list-header">
          <h2 className="tpl-card-title">{t('page.templates.listTitle')}</h2>
          <div className="tpl-list-tools">
            <button type="button" className="tpl-icon-btn tpl-icon-btn--surface" onClick={() => void load()} disabled={templatesResource.refreshing} aria-busy={templatesResource.refreshing || undefined} title={t('common.refresh')} aria-label={t('common.refresh')}><TemplateIcon name="refresh" spin={templatesResource.refreshing} /></button>
            <button
              type="button"
              className="tpl-icon-btn tpl-icon-btn--surface"
              onClick={() => setSortDesc((v) => !v)}
              title={t('page.templates.updated')}
              aria-label={t('page.templates.sortByUpdated')}
              aria-pressed={sortDesc}
            >
              <TemplateIcon name={sortDesc ? 'sortDesc' : 'sortAsc'} />
            </button>
          </div>
        </div>

        {templatesResource.loading && templatesResource.data === undefined ? (
          <LoadingState />
        ) : templatesResource.error != null && templatesResource.data === undefined ? null : templates.length === 0 ? (
          <EmptyState
            title={t('page.templates.emptyTitle')}
            hint={t('page.templates.emptyHint')}
            action={<button type="button" className="tpl-btn tpl-btn--primary" onClick={newTemplate}><TemplateIcon name="plus" /> {t('page.templates.newTemplate')}</button>}
          />
        ) : <>
          <div className="tpl-chips" aria-label={t('page.templates.filters')}>
          <button
            type="button"
            className={`tpl-chip${chip === 'ALL' ? ' is-active' : ''}`}
            aria-pressed={chip === 'ALL'}
            onClick={() => setChip('ALL')}
          >
            {t('page.templates.filterAll')} <b>{templates.length}</b>
          </button>
          {Object.entries(statusCounts).map(([status, count]) => (
            <button
              type="button"
              key={status}
              className={`tpl-chip${chip === status ? ' is-active' : ''}`}
              aria-pressed={chip === status}
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
              aria-pressed={chip === engine}
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
                  <td data-label={t('page.templates.code')}><code>{tpl.templateCode}</code></td>
                  <td data-label={t('page.templates.name')} className="tpl-cell-name"><span className="truncate">{tpl.name}</span></td>
                  <td data-label={t('page.templates.engine')}><span className="tpl-engine-pill">{tpl.engine}</span></td>
                  <td data-label={t('page.templates.version')}>{tpl.version}</td>
                  <td data-label={t('page.templates.status')}><span className={`tpl-badge ${STATUS_TONE[tpl.status] ?? ''}`}>{tpl.status}</span></td>
                  <td data-label={t('page.templates.updated')} className="tpl-cell-time">{formatDate(tpl.updatedAt ?? tpl.createdAt, locale)}</td>
                  <td data-label={t('page.templates.actions')}>
                    <div className="tpl-row-actions">
                      <button
                        type="button"
                        className="tpl-icon-btn"
                        title={t('common.preview')}
                        aria-label={t('page.templates.previewTemplate').replace('{name}', tpl.name)}
                        onClick={() => void renderServerPreview(tpl)}
                      ><TemplateIcon name="preview" /></button>
                      <button
                        type="button"
                        className="tpl-icon-btn"
                        title={t('page.templates.duplicate')}
                        aria-label={t('page.templates.duplicateTemplate').replace('{name}', tpl.name)}
                        onClick={() => void duplicate(tpl)}
                      ><TemplateIcon name="duplicate" /></button>
                      <button
                        type="button"
                        className="tpl-icon-btn"
                        title={t('page.templates.edit')}
                        aria-label={t('page.templates.editTemplateNamed').replace('{name}', tpl.name)}
                        onClick={() => startEdit(tpl)}
                      ><TemplateIcon name="edit" /></button>
                      <div className="tpl-menu-wrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="tpl-icon-btn"
                          title={t('page.templates.more')}
                          aria-label={t('page.templates.moreTemplateActions').replace('{name}', tpl.name)}
                          aria-expanded={menuFor === tpl.id}
                          aria-haspopup="menu"
                          onClick={() => setMenuFor(menuFor === tpl.id ? null : tpl.id)}
                        ><TemplateIcon name="more" /></button>
                        {menuFor === tpl.id && (
                          <div className="tpl-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => void publish(tpl.id)}>
                              <TemplateIcon name="check" /> {t('common.publish')}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="tpl-menu__danger"
                              onClick={() => { setMenuFor(null); setPendingDelete(tpl); }}
                            >
                              <TemplateIcon name="delete" /> {t('page.templates.delete')}
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
              className="tpl-icon-btn tpl-icon-btn--surface"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label={t('page.templates.previousPage')}
            ><TemplateIcon name="back" /></button>
            {visiblePages.map((item) => typeof item === 'number' ? (
                <button
                  type="button"
                  key={item}
                  className={`tpl-page-btn${item === currentPage ? ' is-active' : ''}`}
                  aria-current={item === currentPage ? 'page' : undefined}
                  aria-label={t('page.templates.pageNumber').replace('{n}', String(item))}
                  onClick={() => setPage(item)}
                >{item}</button>
              ) : <span key={item} className="tpl-pagination__gap" aria-hidden="true">…</span>
            )}
            <button
              type="button"
              className="tpl-icon-btn tpl-icon-btn--surface"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={currentPage >= pageCount}
              aria-label={t('page.templates.nextPage')}
            ><TemplateIcon name="next" /></button>
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
        </>}
      </section>
      )}

      {confirmDiscard && (
        <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="template-discard-title" aria-describedby="template-discard-body" onClick={() => setConfirmDiscard(false)}>
          <div ref={discardModalRef} tabIndex={-1} className="ds-modal__panel ds-modal__panel--sm" onClick={(e) => e.stopPropagation()}>
            <div className="ds-modal__header">
              <h2 id="template-discard-title">{t('page.templates.discardTitle')}</h2>
              <button type="button" className="ds-btn ds-btn--icon" onClick={() => setConfirmDiscard(false)} aria-label={t('common.close')}>
                <TemplateIcon name="close" />
              </button>
            </div>
            <div className="ds-confirm__body">
              <p id="template-discard-body">{t('page.templates.discardBody')}</p>
            </div>
            <div className="ds-modal__actions">
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setConfirmDiscard(false)}>
                {t('page.templates.keepEditing')}
              </button>
              <button type="button" className="ds-btn ds-btn--danger" onClick={() => { setConfirmDiscard(false); closeWorkspace(); }}>
                <TemplateIcon name="delete" /> {t('page.templates.discardChanges')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="template-delete-title" onClick={() => setPendingDelete(null)}>
          <div ref={deleteModalRef} tabIndex={-1} className="ds-modal__panel ds-modal__panel--sm" onClick={(e) => e.stopPropagation()}>
            <div className="ds-modal__header">
              <h2 id="template-delete-title">{t('page.templates.deleteTitle')}</h2>
              <button
                type="button"
                className="ds-btn ds-btn--icon"
                onClick={() => setPendingDelete(null)}
                aria-label={t('common.cancel')}
              ><TemplateIcon name="close" /></button>
            </div>
            <div className="ds-confirm__body">
              <p>{t('page.templates.deleteBody').replace('{name}', pendingDelete.name)}</p>
              <code>{pendingDelete.templateCode}</code>
            </div>
            <div className="ds-modal__actions">
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setPendingDelete(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="ds-btn ds-btn--danger" onClick={() => void confirmDelete()}>
                <TemplateIcon name="delete" /> {t('page.templates.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {fullPage && (
        <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="template-preview-title" onClick={() => setFullPage(false)}>
          <div ref={fullPreviewModalRef} tabIndex={-1} className="ds-modal__panel" style={{ width: 'min(900px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <div className="ds-modal__header">
              <h2 id="template-preview-title">{t('page.templates.previewTitle')}</h2>
              <button
                type="button"
                className="ds-btn ds-btn--icon"
                onClick={() => setFullPage(false)}
                aria-label={t('page.templates.closePreview')}
              ><TemplateIcon name="close" /></button>
            </div>
            <div className="ds-modal__body" style={{ display: 'grid', placeItems: 'center', background: 'var(--neutral-page)' }}>
              <div className="tpl-preview-paper" dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(previewHtml) }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
