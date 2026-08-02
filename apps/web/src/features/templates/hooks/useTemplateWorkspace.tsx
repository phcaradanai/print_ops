import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { apiFetch } from '../../../api/client.js';
import { ApiError, errorMessage } from '../../../api/errors.js';
import { useLocale } from '../../../i18n/index.js';
import { useApiResource } from '../../../hooks/useApiResource.js';
import { exportJsonFile } from '../../../tauri.js';
import type { 
  Template, PaperProfileOption, PreviewResponse, SampleMode, 
  TemplateExportFile, TemplateExportEntry 
} from '../model/types.js';
import { buildSample, localPreview, ENGINES } from './helpers.js';

const WS_PATH_KEY = 'printops-workspace-path';
const EXPORT_KIND = 'printops.templates';

export const EMPTY_FORM = {
  templateCode: '',
  name: '',
  engine: 'RAW_TEXT',
  content: 'TEST {{label}}\n{{barcode}}',
  paperProfileId: '',
};

export function classifyTemplateDeleteFailure(err: unknown): 'bound' | 'forbidden' | 'generic' {
  if (!(err instanceof ApiError)) return 'generic';
  if (err.status === 409) return 'bound';
  if (err.status === 403) return 'forbidden';
  return 'generic';
}

interface TemplateWorkspaceState {
  templates: Template[];
  profiles: PaperProfileOption[];
  templatesResource: ReturnType<typeof useApiResource<Template[]>>;
  profilesResource: ReturnType<typeof useApiResource<PaperProfileOption[]>>;
  load: () => void;

  message: { tone: 'ok' | 'error'; text: string } | null;
  setMessage: (m: { tone: 'ok' | 'error'; text: string } | null) => void;
  busy: boolean;

  workspaceOpen: boolean;
  setWorkspaceOpen: (open: boolean) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  
  form: typeof EMPTY_FORM;
  updateEditorForm: (next: typeof EMPTY_FORM | ((prev: typeof EMPTY_FORM) => typeof EMPTY_FORM)) => void;
  formDirty: boolean;
  baselineForm: typeof EMPTY_FORM;

  preview: PreviewResponse | null;
  previewHtml: string;
  previewNote: string;
  previewError: string;
  sampleMode: SampleMode;
  fullPage: boolean;
  setFullPage: (f: boolean) => void;

  search: string;
  setSearch: (s: string) => void;
  chip: string;
  setChip: (c: string) => void;
  sortDesc: boolean;
  setSortDesc: (d: boolean) => void;
  page: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
  
  pendingDelete: Template | null;
  setPendingDelete: (t: Template | null) => void;
  confirmDiscard: boolean;
  setConfirmDiscard: (c: boolean) => void;

  showLocalPreview: () => void;
  renderServerPreview: (tpl: Template, mode?: SampleMode, revealWorkspace?: boolean) => Promise<void>;
  refreshPreview: (mode: SampleMode) => void;
  submit: () => Promise<void>;
  duplicate: (tpl: Template) => Promise<void>;
  publish: (id: string) => Promise<void>;
  confirmDelete: () => Promise<void>;
  exportTemplates: () => Promise<void>;
  importTemplates: (file: File) => Promise<void>;
  startEdit: (tpl: Template) => void;
  newTemplate: () => void;
  requestCloseWorkspace: () => void;
  closeWorkspace: () => void;
}

const WorkspaceContext = createContext<TemplateWorkspaceState | null>(null);

export function useTemplateWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useTemplateWorkspace must be used within a TemplateWorkspaceProvider');
  return ctx;
}

export function TemplateWorkspaceProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
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

  const previewRequestIdRef = useRef(0);

  const fetchTemplates = useCallback(() => apiFetch<Template[]>('/v1/templates'), []);
  const fetchProfiles = useCallback(() => apiFetch<PaperProfileOption[]>('/v1/paper-profiles'), []);

  const templatesResource = useApiResource(fetchTemplates);
  const profilesResource = useApiResource(fetchProfiles);
  const templates = templatesResource.data ?? [];
  const profiles = profilesResource.data ?? [];
  const load = useCallback(() => templatesResource.refresh(), [templatesResource]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const editingTemplate = templates.find((tpl) => tpl.id === editingId);
  const formProfile = profiles.find((p) => p.id === form.paperProfileId);

  const baselineForm = useMemo(() => editingTemplate ? {
    templateCode: editingTemplate.templateCode,
    name: editingTemplate.name,
    engine: editingTemplate.engine,
    content: editingTemplate.content,
    paperProfileId: editingTemplate.paperProfileId ?? '',
  } : EMPTY_FORM, [editingTemplate]);

  const formDirty = Object.keys(EMPTY_FORM).some((key) => form[key as keyof typeof form] !== baselineForm[key as keyof typeof baselineForm]);

  const updateEditorForm = useCallback((next: typeof EMPTY_FORM | ((prev: typeof EMPTY_FORM) => typeof EMPTY_FORM)) => {
    previewRequestIdRef.current += 1;
    setSelectedId(null);
    setPreview(null);
    setPreviewHtml('');
    setPreviewNote('');
    setPreviewError('');
    setForm(next);
  }, []);

  const showLocalPreview = useCallback(() => {
    previewRequestIdRef.current += 1;
    const sample = buildSample(sampleMode, form.content, formProfile);
    setSelectedId(null);
    setPreview(null);
    setPreviewError('');
    setPreviewNote(t('page.templates.localPreviewNote'));
    setPreviewHtml(localPreview(form.content, form.engine, sample, formProfile));
  }, [sampleMode, form, formProfile, t]);

  const renderServerPreview = useCallback(async (tpl: Template, mode: SampleMode = sampleMode, revealWorkspace = true) => {
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
      setPreviewHtml(res.renderedPreview); // sanitization happens in preview component
      setPreviewError('');
    } catch (err: unknown) {
      if (requestId !== previewRequestIdRef.current) return;
      setPreview(null);
      setPreviewHtml('');
      setPreviewError(`${t('page.templates.previewFailed')} ${errorMessage(err)}`);
    }
  }, [profiles, sampleMode, t]);

  const refreshPreview = useCallback((mode: SampleMode) => {
    setSampleMode(mode);
    const selected = templates.find((tpl) => tpl.id === selectedId);
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
  }, [formDirty, selectedId, templates, renderServerPreview, form, formProfile, t]);

  const submit = useCallback(async () => {
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
    } catch (err: unknown) {
      setMessage({ tone: 'error', text: `${t('page.templates.actionFailed')} ${errorMessage(err)}` });
    } finally {
      setBusy(false);
    }
  }, [form, editingId, load, t]);

  const startEdit = useCallback((tpl: Template) => {
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
  }, []);

  const newTemplate = useCallback(() => {
    previewRequestIdRef.current += 1;
    setWorkspaceOpen(true);
    setEditingId(null);
    setSelectedId(null);
    setPreview(null);
    setPreviewHtml('');
    setPreviewNote('');
    setPreviewError('');
    setForm({ ...EMPTY_FORM });
  }, []);

  const closeWorkspace = useCallback(() => {
    previewRequestIdRef.current += 1;
    setWorkspaceOpen(false);
    setEditingId(null);
    setSelectedId(null);
    setForm({ ...EMPTY_FORM });
    setPreview(null);
    setPreviewHtml('');
    setPreviewNote('');
    setPreviewError('');
  }, []);

  const requestCloseWorkspace = useCallback(() => {
    if (formDirty) {
      setConfirmDiscard(true);
      return;
    }
    closeWorkspace();
  }, [formDirty, closeWorkspace]);

  const duplicate = useCallback(async (tpl: Template) => {
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
  }, [load, t]);

  const publish = useCallback(async (id: string) => {
    try {
      await apiFetch(`/v1/templates/${id}/publish`, { method: 'POST' });
      setMessage({ tone: 'ok', text: t('page.templates.publishedOk') });
      await load();
    } catch (err: unknown) {
      setMessage({ tone: 'error', text: `${t('page.templates.actionFailed')} ${errorMessage(err)}` });
    }
  }, [load, t]);

  const confirmDelete = useCallback(async () => {
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
  }, [pendingDelete, selectedId, editingId, load, t]);

  const exportTemplates = useCallback(async () => {
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
  }, [templates, profiles, t]);

  const importTemplates = useCallback(async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      parsed = null;
    }
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as TemplateExportFile).templates)
        ? (parsed as TemplateExportFile).templates
        : null;
    if (!list) {
      setMessage({ tone: 'error', text: t('page.templates.importInvalid') });
      return;
    }
    const entries = list.filter((entry): entry is TemplateExportEntry =>
      typeof entry === 'object' && entry !== null &&
      typeof (entry as TemplateExportEntry).templateCode === 'string' &&
      typeof (entry as TemplateExportEntry).content === 'string');
    
    if (entries.length === 0) {
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
  }, [profiles, templates, load, t]);

  const value = {
    templates, profiles, templatesResource, profilesResource, load,
    message, setMessage, busy,
    workspaceOpen, setWorkspaceOpen, editingId, setEditingId, selectedId, setSelectedId,
    form, updateEditorForm, formDirty, baselineForm,
    preview, previewHtml, previewNote, previewError, sampleMode, fullPage, setFullPage,
    search, setSearch, chip, setChip, sortDesc, setSortDesc, page, setPage, pageSize, setPageSize,
    pendingDelete, setPendingDelete, confirmDiscard, setConfirmDiscard,
    showLocalPreview, renderServerPreview, refreshPreview, submit, duplicate, publish,
    confirmDelete, exportTemplates, importTemplates, startEdit, newTemplate,
    requestCloseWorkspace, closeWorkspace
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
