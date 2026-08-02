import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { apiFetch } from '../api/client.js';
import { ApiError, errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { exportJsonFile } from '../tauri.js';
import { qrQuietZoneMm, renderBarcodeSvg, type BarcodeKind, type BarcodeSymbology } from '../lib/barcode.js';
import { sanitizePreviewHtml } from '../lib/previewHtml.js';
import { TransferIcon } from '../components/TransferIcon.js';
import { TemplateRowMenu } from './TemplateRowMenu.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardDetail,
  CardDetailItem,
  Chip,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  EmptyState,
  ErrorBanner,
  FormField,
  Freshness,
  Heading,
  IconButton,
  Inline,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Select,
  Stack,
  TableEmpty,
  Text,
  Textarea,
  type BadgeTone,
} from '../components/ui/index.js';

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
  | 'duplicate' | 'edit' | 'expand' | 'label' | 'more'
  | 'next' | 'pdf' | 'plus' | 'preview' | 'printer' | 'qrcode' | 'refresh'
  | 'save' | 'search' | 'sortAsc' | 'sortDesc' | 'terminal' | 'text';

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
  }[name];

  return (
    <svg className={`tpl-action-icon${spin ? ' tpl-action-icon--spin' : ''}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

/** Template lifecycle mapped onto the shared badge tones. A draft is not a
 *  fault — it is simply not published yet — so it stays neutral. */
const STATUS_BADGE_TONE: Record<string, BadgeTone> = {
  PUBLISHED: 'success',
  DRAFT: 'neutral',
  DISABLED: 'warning',
  ARCHIVED: 'neutral',
};

const VARIABLES: { token: string; labelKey: string }[] = [
  { token: 'label', labelKey: 'page.templates.varLabel' },
  { token: 'barcode', labelKey: 'page.templates.varBarcode' },
  { token: 'date', labelKey: 'page.templates.varDate' },
  { token: 'time', labelKey: 'page.templates.varTime' },
  { token: 'seq', labelKey: 'page.templates.varSeq' },
];

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

export function placeholdersOf(content: string): string[] {
  return Array.from(new Set(
    Array.from(content.matchAll(COMBINED_PREVIEW_PATTERN))
      .map((match) => match[2] ?? match[3] ?? '')
      .filter(Boolean),
  ));
}

export function buildSample(
  mode: SampleMode,
  content: string,
  profile?: PaperProfileOption,
): Record<string, unknown> {
  if (mode === 'empty') return {};
  const payload: Record<string, unknown> = {};
  if (mode === 'profile') {
    if (!profile) return {};
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

export function classifyTemplateDeleteFailure(err: unknown): 'bound' | 'forbidden' | 'generic' {
  if (!(err instanceof ApiError)) return 'generic';
  if (err.status === 409) return 'bound';
  if (err.status === 403) return 'forbidden';
  return 'generic';
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
  const [pendingDelete, setPendingDelete] = useState<Template | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  // The three modal refs and their `useModalFocusTrap` calls are gone with the
  // hand-rolled overlays: `Dialog` traps focus, handles Escape and restores
  // focus on close for all three.
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const libraryRef = useRef<HTMLElement | null>(null);
  const previewRequestIdRef = useRef(0);

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

  function updateEditorForm(next: SetStateAction<typeof form>) {
    // Any user edit invalidates both the selected saved-template identity and
    // every proof generated for the previous form. This keeps stale server
    // responses and already-rendered proofs from being mistaken for evidence
    // of the values currently visible in the editor.
    previewRequestIdRef.current += 1;
    setSelectedId(null);
    setPreview(null);
    setPreviewHtml('');
    setPreviewNote('');
    setPreviewError('');
    setForm(next);
  }

  function insertSnippet(snippet: string) {
    const el = contentRef.current;
    if (!el) {
      updateEditorForm((prev) => ({ ...prev, content: prev.content + snippet }));
      return;
    }
    const start = el.selectionStart ?? form.content.length;
    const end = el.selectionEnd ?? start;
    const next = form.content.slice(0, start) + snippet + form.content.slice(end);
    updateEditorForm((prev) => ({ ...prev, content: next }));
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
    previewRequestIdRef.current += 1;
    const sample = buildSample(sampleMode, form.content, formProfile);
    setSelectedId(null);
    setPreview(null);
    setPreviewError('');
    setPreviewNote(t('page.templates.localPreviewNote'));
    setPreviewHtml(localPreview(form.content, form.engine, sample, formProfile));
  }

  async function renderServerPreview(tpl: Template, mode: SampleMode = sampleMode, revealWorkspace = true) {
    const requestId = ++previewRequestIdRef.current;
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
      if (requestId !== previewRequestIdRef.current) return;
      setPreview(res);
      setPreviewHtml(sanitizePreviewHtml(res.renderedPreview));
      setPreviewError('');
    } catch (err: unknown) {
      if (requestId !== previewRequestIdRef.current) return;
      setPreview(null);
      setPreviewHtml('');
      setPreviewError(`${t('page.templates.previewFailed')} ${errorMessage(err)}`);
    }
  }

  function refreshPreview(mode: SampleMode) {
    setSampleMode(mode);
    if (selected && !formDirty) {
      void renderServerPreview(selected, mode, false);
      return;
    }
    previewRequestIdRef.current += 1;
    setSelectedId(null);
    setPreview(null);
    setPreviewError('');
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
      previewRequestIdRef.current += 1;
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
    previewRequestIdRef.current += 1;
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
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function newTemplate() {
    previewRequestIdRef.current += 1;
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
    previewRequestIdRef.current += 1;
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
        previewRequestIdRef.current += 1;
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
      const failure = classifyTemplateDeleteFailure(err);
      const text = failure === 'bound'
        ? t('page.templates.deleteBound')
        : failure === 'forbidden'
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
    <PageLayout className="templates-page" width="full" header={
      <div className="tpl-page-header">
        <div className="tpl-page-heading">
          <h1>{t('page.templates.title')}</h1>
          <p>{t('page.templates.subtitle')}</p>
        </div>
        {!workspaceOpen && <div className="tpl-page-tools">
          <Input
            type="search"
            controlSize="sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('page.templates.searchPlaceholder')}
            aria-label={t('page.templates.searchPlaceholder')}
            leading={<TemplateIcon name="search" />}
          />
          <Button variant="ghost" onClick={exportTemplates}>
            <TransferIcon action="export" /> {t('page.templates.exportBtn')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => importInputRef.current?.click()}
            busy={busy}
            busyLabel={t('page.templates.importing')}
          >
            <TransferIcon action="import" /> {t('page.templates.importBtn')}
          </Button>
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
          <Button onClick={newTemplate}>
            <TemplateIcon name="plus" /> {t('page.templates.newTemplate')}
          </Button>
        </div>}
      </div>
    }>

      {message && (
        <Alert
          tone={message.tone === 'ok' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('common.close')}
        >
          {message.text}
        </Alert>
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
          <Button variant="ghost" onClick={requestCloseWorkspace}>
            <TemplateIcon name="back" /> {t('page.templates.backToLibrary')}
          </Button>
          <Text weight="semibold">{editingId ? form.templateCode : t('page.templates.newTemplate')}</Text>
        </div>
        <div className="tpl-layout">
        <Card className="tpl-editor" ref={formRef}>
          <Heading level={2}>
            {editingId ? t('page.templates.editTemplate') : t('page.templates.createTemplate')}
          </Heading>

          <div className="tpl-editor-top">
            {/* Each of these was a `<label>` wrapping its control with a `<b>*</b>`
                that assistive tech never announced. `FormField` carries the
                required marker with a real accessible name. */}
            <div className="tpl-field-grid">
              <FormField
                label={t('page.templates.templateCode')}
                required
                requiredLabel={t('common.required')}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={form.templateCode}
                    onChange={(e) => updateEditorForm({ ...form, templateCode: e.target.value })}
                    placeholder={t('page.templates.templateCodePlaceholder')}
                  />
                )}
              </FormField>
              <FormField
                label={t('page.templates.templateName')}
                required
                requiredLabel={t('common.required')}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={form.name}
                    onChange={(e) => updateEditorForm({ ...form, name: e.target.value })}
                    placeholder={t('page.templates.templateNamePlaceholder')}
                  />
                )}
              </FormField>
              <FormField label={t('page.templates.paperProfile')}>
                {(control) => (
                  <Select
                    {...control}
                    value={form.paperProfileId}
                    onChange={(e) => updateEditorForm({ ...form, paperProfileId: e.target.value })}
                  >
                    <option value="">{t('page.templates.selectPaperProfile')}</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                  </Select>
                )}
              </FormField>
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
                    onClick={() => updateEditorForm({ ...form, engine })}
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
                <Textarea
                  id="template-content"
                  className="tpl-editor-content"
                  mono={form.engine === 'JSON_LAYOUT' || form.engine === 'ZPL' || form.engine === 'RAW_TEXT' || form.engine === 'TSPL' || form.engine === 'EPL'}
                  value={form.content}
                  onChange={(e) => updateEditorForm({ ...form, content: e.target.value })}
                  ref={contentRef}
                  placeholder={t('page.templates.contentPlaceholder')}
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
            {/* Generating a proof must stay visibly separate from anything that
                commits — this button renders, it never prints. */}
            <Button variant="ghost" onClick={showLocalPreview}>
              <TemplateIcon name="preview" /> {t('page.templates.previewBtn')}
            </Button>
            <Inline gap="sm" className="tpl-editor-actions__right">
              <Button
                onClick={() => void submit()}
                busy={busy}
                busyLabel={t('page.templates.saving')}
              >
                <TemplateIcon name="save" />{' '}
                {editingId ? t('page.templates.saveBtn') : t('page.templates.createTemplate')}
              </Button>
              <Button variant="ghost" onClick={requestCloseWorkspace}>
                {t('page.templates.cancelEdit')}
              </Button>
            </Inline>
          </div>
        </Card>

        <Card className="tpl-preview" ref={previewRef}>
          <div className="tpl-preview-header">
            <Heading level={2}>{t('page.templates.previewTitle')}</Heading>
            <div className="tpl-preview-controls">
              <Select
                aria-label={t('page.templates.sampleInput')}
                controlSize="sm"
                value={sampleMode}
                onChange={(e) => refreshPreview(e.target.value as SampleMode)}
              >
                <option value="default">{t('page.templates.sampleDefault')}</option>
                <option value="profile">{t('page.templates.sampleProfile')}</option>
                <option value="empty">{t('page.templates.sampleEmpty')}</option>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => refreshPreview(sampleMode)}>
                <TemplateIcon name="refresh" /> {t('common.refresh')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFullPage(true)}
                disabled={!previewHtml}
              >
                <TemplateIcon name="expand" /> {t('page.templates.fullPage')}
              </Button>
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
            <CardDetail>
              <CardDetailItem label={t('page.templates.engine')}>{selected?.engine ?? form.engine}</CardDetailItem>
              <CardDetailItem label={t('page.templates.paperProfile')}>
                {(selected ? selectedProfile?.name : formProfile?.name) ?? t('page.templates.noPaperProfile')}
              </CardDetailItem>
              <CardDetailItem label={t('page.templates.version')}>{selected?.version ?? '—'}</CardDetailItem>
              <CardDetailItem label={t('page.templates.status')}>{selected?.status ?? t('page.templates.unsavedDraft')}</CardDetailItem>
              <CardDetailItem label={t('page.templates.createdBy')}>{selected?.createdBy ?? '—'}</CardDetailItem>
              <CardDetailItem label={t('page.templates.createdAt')}>{formatDate(selected?.createdAt, locale)}</CardDetailItem>
              <CardDetailItem label={t('page.templates.updatedAt')}>{formatDate(selected?.updatedAt, locale)}</CardDetailItem>
            </CardDetail>
          </div>
        </Card>
        </div>
      </> : (

      <Card className="tpl-list" ref={libraryRef}>
        <div className="tpl-list-header">
          <Heading level={2}>{t('page.templates.listTitle')}</Heading>
          <div className="tpl-list-tools">

            <IconButton
              label={t('common.refresh')}
              onClick={() => void load()}
              busy={templatesResource.refreshing}
            >
              <TemplateIcon name="refresh" spin={templatesResource.refreshing} />
            </IconButton>

            <IconButton
              label={t('page.templates.sortByUpdated')}
              title={t('page.templates.updated')}
              onClick={() => setSortDesc((v) => !v)}
              aria-pressed={sortDesc}
            >
              <TemplateIcon name={sortDesc ? 'sortDesc' : 'sortAsc'} />
            </IconButton>
          </div>
        </div>

        {templatesResource.loading && templatesResource.data === undefined ? (
          <LoadingState />
        ) : templatesResource.error != null && templatesResource.data === undefined ? null : templates.length === 0 ? (
          <EmptyState
            title={t('page.templates.emptyTitle')}
            hint={t('page.templates.emptyHint')}
            action={<Button onClick={newTemplate}><TemplateIcon name="plus" /> {t('page.templates.newTemplate')}</Button>}
          />
        ) : <>
          {/* These were `tpl-chip` buttons — a third pill implementation after
              `wh-var-pill` and `print-flow-pill`. All three are now `Chip`. */}
          <Inline gap="xs" className="tpl-chips" aria-label={t('page.templates.filters')}>
            <Chip selected={chip === 'ALL'} onClick={() => setChip('ALL')}>
              {t('page.templates.filterAll')} <Text size="label" weight="bold">{templates.length}</Text>
            </Chip>
            {Object.entries(statusCounts).map(([status, count]) => (
              <Chip key={status} selected={chip === status} onClick={() => setChip(status)}>
                {status} <Text size="label" weight="bold">{count}</Text>
              </Chip>
            ))}
            {Object.entries(engineCounts).map(([engine, count]) => (
              <Chip key={engine} selected={chip === engine} onClick={() => setChip(engine)}>
                {engine} <Text size="label" weight="bold">{count}</Text>
              </Chip>
            ))}
          </Inline>

          <DataTable label={t('page.templates.listTitle')} responsive>
            <thead>
              <tr>
                <DataHead>{t('page.templates.code')}</DataHead>
                <DataHead>{t('page.templates.name')}</DataHead>
                <DataHead>{t('page.templates.engine')}</DataHead>
                <DataHead>{t('page.templates.version')}</DataHead>
                <DataHead>{t('page.templates.status')}</DataHead>
                <DataHead>{t('page.templates.updated')}</DataHead>
                <DataHead>{t('page.templates.actions')}</DataHead>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((tpl) => (
                <tr key={tpl.id} className={tpl.id === selectedId ? 'is-selected' : undefined}>
                  <DataCell label={t('page.templates.code')}><Mono>{tpl.templateCode}</Mono></DataCell>
                  <DataCell label={t('page.templates.name')}>
                    <Text truncate title={tpl.name}>{tpl.name}</Text>
                  </DataCell>
                  <DataCell label={t('page.templates.engine')}><Badge>{tpl.engine}</Badge></DataCell>
                  <DataCell label={t('page.templates.version')}><Mono>{tpl.version}</Mono></DataCell>
                  <DataCell label={t('page.templates.status')}>
                    <Badge tone={STATUS_BADGE_TONE[tpl.status] ?? 'neutral'}>{tpl.status}</Badge>
                  </DataCell>
                  <DataCell label={t('page.templates.updated')}>
                    <Text size="label" tone="muted" nowrap>{formatDate(tpl.updatedAt ?? tpl.createdAt, locale)}</Text>
                  </DataCell>
                  <DataCell label={t('page.templates.actions')} actions>
                    <Inline gap="xs" className="tpl-row-actions">
                      <IconButton
                        size="sm"
                        label={t('page.templates.previewTemplate').replace('{name}', tpl.name)}
                        title={t('common.preview')}
                        onClick={() => void renderServerPreview(tpl)}
                      ><TemplateIcon name="preview" /></IconButton>
                      <IconButton
                        size="sm"
                        label={t('page.templates.duplicateTemplate').replace('{name}', tpl.name)}
                        title={t('page.templates.duplicate')}
                        onClick={() => void duplicate(tpl)}
                      ><TemplateIcon name="duplicate" /></IconButton>
                      <IconButton
                        size="sm"
                        label={t('page.templates.editTemplateNamed').replace('{name}', tpl.name)}
                        title={t('page.templates.edit')}
                        onClick={() => startEdit(tpl)}
                      ><TemplateIcon name="edit" /></IconButton>
                      <TemplateRowMenu
                        label={t('page.templates.moreTemplateActions').replace('{name}', tpl.name)}
                        icon={<TemplateIcon name="more" />}
                        items={[
                          {
                            id: 'publish',
                            label: t('common.publish'),
                            icon: <TemplateIcon name="check" />,
                            onSelect: () => void publish(tpl.id),
                          },
                          {
                            id: 'delete',
                            label: t('page.templates.delete'),
                            icon: <TemplateIcon name="delete" />,
                            danger: true,
                            restoreFocus: false,
                            onSelect: () => setPendingDelete(tpl),
                          },
                        ]}
                      />
                    </Inline>
                  </DataCell>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <TableEmpty columns={7}>
                  <EmptyState title={t('page.templates.noResults')} />
                </TableEmpty>
              )}
            </tbody>
          </DataTable>

        <div className="tpl-pagination">
          <Text size="label" tone="muted" className="tpl-pagination__count">
            {t('page.templates.showing')
              .replace('{from}', String(from))
              .replace('{to}', String(to))
              .replace('{total}', String(filtered.length))}
          </Text>
          <Inline gap="xs" className="tpl-pagination__pages">
            <IconButton
              size="sm"
              label={t('page.templates.previousPage')}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            ><TemplateIcon name="back" /></IconButton>
            {/* Page numbers are a selection, so they take the chip — the same
                pressed-state contract as every other filter in the product. */}
            {visiblePages.map((item) => typeof item === 'number' ? (
                <Chip
                  key={item}
                  selected={item === currentPage}
                  aria-current={item === currentPage ? 'page' : undefined}
                  aria-label={t('page.templates.pageNumber').replace('{n}', String(item))}
                  onClick={() => setPage(item)}
                >{item}</Chip>
              ) : <Text key={item} tone="muted" aria-hidden="true">…</Text>
            )}
            <IconButton
              size="sm"
              label={t('page.templates.nextPage')}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={currentPage >= pageCount}
            ><TemplateIcon name="next" /></IconButton>
          </Inline>
          <Select
            controlSize="sm"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label={t('page.templates.rowsPerPage').replace('{n}', String(pageSize))}
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>{t('page.templates.rowsPerPage').replace('{n}', String(n))}</option>
            ))}
          </Select>
          </div>
        </>}
      </Card>
      )}

      {/* Three more hand-rolled `ds-modal` overlays, each re-implementing the
          focus trap this page was already importing `useModalFocusTrap` for.
          `Dialog` owns all of it now. */}
      <Dialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title={t('page.templates.discardTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
              {t('page.templates.keepEditing')}
            </Button>
            <Button variant="danger" onClick={() => { setConfirmDiscard(false); closeWorkspace(); }}>
              <TemplateIcon name="delete" /> {t('page.templates.discardChanges')}
            </Button>
          </>
        }
      >
        <Text as="p">{t('page.templates.discardBody')}</Text>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('page.templates.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              <TemplateIcon name="delete" /> {t('page.templates.delete')}
            </Button>
          </>
        }
      >
        {pendingDelete && (
          <Stack gap="sm">
            <Text as="p">{t('page.templates.deleteBody').replace('{name}', pendingDelete.name)}</Text>
            <Mono weight="semibold">{pendingDelete.templateCode}</Mono>
          </Stack>
        )}
      </Dialog>

      {/* A proof, not a print. Nothing in this dialog reaches a device. */}
      <Dialog
        open={fullPage}
        onClose={() => setFullPage(false)}
        title={t('page.templates.previewTitle')}
      >
        <div className="tpl-preview-stage">
          <div className="tpl-preview-paper" dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(previewHtml) }} />
        </div>
      </Dialog>
    </PageLayout>
  );
}
