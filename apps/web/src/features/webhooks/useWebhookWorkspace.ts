import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { errorMessage } from '../../api/errors.js';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useLocale } from '../../i18n/index.js';
import { saveOrDownloadJsonFile } from '../../utils/fileExport.js';
import { parseWebhookImportJson } from './parseImportJson.js';
import {
  EMPTY_WEBHOOK_FORM,
  buildEndpointPayload,
  buildImportCandidates,
  callbackTestPayload,
  clampPage,
  describeTransportResult,
  endpointToForm,
  filterCallbackLog,
  filterEndpoints,
  paginate,
  validateWebhookForm,
} from './model.js';
import type {
  BatchDeleteResult,
  CallbackAttempt,
  CallbackLogFilters,
  CallbackTestResponse,
  Endpoint,
  EndpointStatusFilter,
  FeedbackMessage,
  ImportCandidate,
  ImportResult,
  Policy,
  WebhookEditorForm,
  WebhookValidationErrors,
  WebhookView,
} from './types.js';

let feedbackSequence = 0;

export function useWebhookWorkspace() {
  const { t } = useLocale();
  const [view, setView] = useState<WebhookView>('endpoints');
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [form, setForm] = useState<WebhookEditorForm>({ ...EMPTY_WEBHOOK_FORM });
  const [errors, setErrors] = useState<WebhookValidationErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EndpointStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [detailsEndpoint, setDetailsEndpoint] = useState<Endpoint | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Endpoint | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[] | null>(null);
  const [overwriteExisting, setOverwriteExisting] = useState(true);

  const [logFilters, setLogFilters] = useState<CallbackLogFilters>({
    failedOnly: false,
    transport: 'all',
    endpointId: '',
    trigger: 'all',
  });
  const [selectedAttempt, setSelectedAttempt] = useState<CallbackAttempt | null>(null);

  const fetchEndpoints = useCallback(() => apiFetch<Endpoint[]>('/v1/webhook-endpoints'), []);
  const fetchPolicies = useCallback(() => apiFetch<Policy[]>('/v1/webhook-route-policies'), []);
  const fetchCallbackLog = useCallback(
    () => apiFetch<CallbackAttempt[]>('/v1/webhook-endpoints/callback-log?limit=100'),
    [],
  );

  const endpointsResource = useApiResource(fetchEndpoints);
  const policiesResource = useApiResource(fetchPolicies);
  const callbackLogResource = useApiResource(fetchCallbackLog);

  useEffect(() => {
    if (!endpointsResource.data) return;
    setEndpoints(endpointsResource.data);
    setSelectedIds((current) => current.filter((id) => endpointsResource.data?.some((row) => row.id === id)));
  }, [endpointsResource.data]);

  useEffect(() => {
    if (policiesResource.data) setPolicies(policiesResource.data);
  }, [policiesResource.data]);

  useEffect(() => {
    if (!feedback || feedback.persistent || feedback.tone === 'error' || feedback.tone === 'warning') return;
    const id = window.setTimeout(() => {
      setFeedback((current) => current?.id === feedback.id ? null : current);
    }, 4500);
    return () => window.clearTimeout(id);
  }, [feedback]);

  const showFeedback = useCallback((message: Omit<FeedbackMessage, 'id'>) => {
    feedbackSequence += 1;
    setFeedback({ ...message, id: feedbackSequence });
  }, []);

  const refreshEndpoints = useCallback(() => {
    endpointsResource.refresh();
    policiesResource.refresh();
  }, [endpointsResource.refresh, policiesResource.refresh]);

  const filteredEndpoints = useMemo(
    () => filterEndpoints(endpoints, search, statusFilter),
    [endpoints, search, statusFilter],
  );

  const safePage = clampPage(page, filteredEndpoints.length, pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredEndpoints.length / pageSize));
  const pagedEndpoints = useMemo(
    () => paginate(filteredEndpoints, safePage, pageSize),
    [filteredEndpoints, safePage, pageSize],
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize]);

  const selectedEndpoints = useMemo(
    () => endpoints.filter((endpoint) => selectedIds.includes(endpoint.id)),
    [endpoints, selectedIds],
  );

  const visibleAttempts = useMemo(
    () => filterCallbackLog(callbackLogResource.data ?? [], logFilters),
    [callbackLogResource.data, logFilters],
  );

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_WEBHOOK_FORM });
    setErrors({});
    setView('editor');
  }, []);

  const openEdit = useCallback((endpoint: Endpoint) => {
    setEditingId(endpoint.id);
    setForm(endpointToForm(endpoint));
    setErrors({});
    setView('editor');
  }, []);

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_WEBHOOK_FORM });
    setErrors({});
    setView('endpoints');
  }, []);

  const updateForm = useCallback((patch: Partial<WebhookEditorForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    const keys = Object.keys(patch) as Array<keyof WebhookValidationErrors>;
    setErrors((current) => {
      const next = { ...current };
      keys.forEach((key) => delete next[key]);
      return next;
    });
  }, []);

  const saveEndpoint = useCallback(async (enabled: boolean) => {
    const nextErrors = validateWebhookForm(form, policies, policiesResource.error != null);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      showFeedback({ tone: 'error', text: t('page.webhooks.feedbackFixFields'), persistent: true });
      return false;
    }

    setBusy(true);
    try {
      const body = JSON.stringify(buildEndpointPayload(form, enabled));
      if (editingId) {
        await apiFetch(`/v1/webhook-endpoints/${editingId}`, { method: 'PUT', body });
      } else {
        await apiFetch('/v1/webhook-endpoints', { method: 'POST', body });
      }
      showFeedback({
        tone: 'success',
        text: editingId
          ? (enabled ? t('page.webhooks.toastUpdated') : t('page.webhooks.toastDraftUpdated'))
          : (enabled ? t('page.webhooks.toastCreated') : t('page.webhooks.toastDraftCreated')),
      });
      closeEditor();
      endpointsResource.refresh();
      return true;
    } catch (error) {
      showFeedback({
        tone: 'error',
        text: `${t('page.webhooks.toastSaveError')} — ${errorMessage(error)}`,
        persistent: true,
      });
      return false;
    } finally {
      setBusy(false);
    }
  }, [closeEditor, editingId, endpointsResource.refresh, form, policies, policiesResource.error, showFeedback, t]);

  const testCallback = useCallback(async (endpoint?: Endpoint) => {
    const endpointId = endpoint?.id ?? editingId;
    if (!endpointId) return;
    setBusy(true);
    try {
      const response = await apiFetch<CallbackTestResponse>(
        `/v1/webhook-endpoints/${endpointId}/callback-test`,
        { method: 'POST', body: JSON.stringify(callbackTestPayload()) },
      );
      const details = [
        describeTransportResult('HTTP', response.delivery.http, t),
        describeTransportResult('NATS', response.delivery.nats, t),
      ].filter((item): item is string => Boolean(item));
      showFeedback({
        tone: response.ok ? 'success' : 'error',
        text: t('page.webhooks.callbackTestResult'),
        details: details.length > 0 ? details : [t('page.webhooks.toastNoCallbackConfigured')],
        persistent: true,
        logEntryId: response.id,
      });
      callbackLogResource.refresh();
    } catch (error) {
      showFeedback({
        tone: 'error',
        text: `${t('page.webhooks.toastCallbackTestFailed')} — ${errorMessage(error)}`,
        persistent: true,
      });
    } finally {
      setBusy(false);
    }
  }, [callbackLogResource.refresh, editingId, showFeedback, t]);

  const toggleEndpoint = useCallback(async (endpoint: Endpoint) => {
    setBusy(true);
    try {
      await apiFetch(`/v1/webhook-endpoints/${endpoint.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !endpoint.enabled }),
      });
      showFeedback({
        tone: 'success',
        text: t('page.webhooks.toastStatusChanged')
          .replace('{code}', endpoint.endpointCode)
          .replace('{status}', !endpoint.enabled ? t('page.webhooks.statusEnabled') : t('page.webhooks.statusDraft')),
      });
      endpointsResource.refresh();
    } catch (error) {
      showFeedback({
        tone: 'error',
        text: `${t('page.webhooks.toastStatusChangeFailed')} — ${errorMessage(error)}`,
        persistent: true,
      });
    } finally {
      setBusy(false);
    }
  }, [endpointsResource.refresh, showFeedback, t]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiFetch(`/v1/webhook-endpoints/${pendingDelete.id}`, { method: 'DELETE' });
      showFeedback({
        tone: 'success',
        text: t('page.webhooks.toastDeleted').replace('{code}', pendingDelete.endpointCode),
      });
      setPendingDelete(null);
      setSelectedIds((current) => current.filter((id) => id !== pendingDelete.id));
      endpointsResource.refresh();
    } catch (error) {
      showFeedback({
        tone: 'error',
        text: `${t('page.webhooks.toastDeleteFailed')} — ${errorMessage(error)}`,
        persistent: true,
      });
    } finally {
      setBusy(false);
    }
  }, [endpointsResource.refresh, pendingDelete, showFeedback, t]);

  const confirmBatchDelete = useCallback(async () => {
    const targets = selectedEndpoints;
    if (targets.length === 0) return;
    setBusy(true);
    const result: BatchDeleteResult = { deletedIds: [], failed: [] };
    await Promise.all(targets.map(async (endpoint) => {
      try {
        await apiFetch(`/v1/webhook-endpoints/${endpoint.id}`, { method: 'DELETE' });
        result.deletedIds.push(endpoint.id);
      } catch (error) {
        result.failed.push({
          id: endpoint.id,
          endpointCode: endpoint.endpointCode,
          reason: errorMessage(error),
        });
      }
    }));

    setSelectedIds(result.failed.map((failure) => failure.id));
    setBatchDeleteOpen(false);
    showFeedback({
      tone: result.failed.length > 0 ? 'error' : 'success',
      text: result.failed.length > 0
        ? t('page.webhooks.batchPartial')
            .replace('{deleted}', String(result.deletedIds.length))
            .replace('{failed}', String(result.failed.length))
        : t('page.webhooks.toastBatchDeleted').replace('{n}', String(result.deletedIds.length)),
      details: result.failed.map((failure) => `${failure.endpointCode}: ${failure.reason}`),
      persistent: result.failed.length > 0,
    });
    endpointsResource.refresh();
    setBusy(false);
  }, [endpointsResource.refresh, selectedEndpoints, showFeedback, t]);

  const prepareImport = useCallback(async (file: File) => {
    try {
      const parsed = parseWebhookImportJson(await file.arrayBuffer());
      const items = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { endpoints?: unknown }).endpoints)
          ? (parsed as { endpoints: Partial<Endpoint>[] }).endpoints
          : [];
      if (items.length === 0) {
        showFeedback({ tone: 'error', text: t('page.webhooks.toastImportEmpty'), persistent: true });
        return;
      }
      setImportCandidates(buildImportCandidates(items as Partial<Endpoint>[], endpoints));
    } catch (error) {
      showFeedback({
        tone: 'error',
        text: `${t('page.webhooks.toastImportReadFailed')} — ${errorMessage(error)}`,
        persistent: true,
      });
    }
  }, [endpoints, showFeedback, t]);

  const confirmImport = useCallback(async () => {
    if (!importCandidates) return;
    setBusy(true);
    const result: ImportResult = { success: 0, skipped: 0, failed: [], total: importCandidates.length };

    for (const candidate of importCandidates) {
      if (candidate.status === 'invalid') {
        result.failed.push({ endpointCode: candidate.endpointCode, reason: candidate.errors.map(t).join(', ') });
        continue;
      }
      const existing = endpoints.find((endpoint) => endpoint.endpointCode === candidate.endpointCode);
      if (existing && !overwriteExisting) {
        result.skipped += 1;
        continue;
      }
      const item = candidate.endpoint;
      const payload: Record<string, unknown> = {
        endpointCode: candidate.endpointCode,
        name: String(item.name ?? '').trim(),
        sourceSystem: item.sourceSystem || 'integration-service',
        authMode: item.authMode || 'NONE',
        routePolicyId: item.routePolicyId || '',
        enabled: item.enabled ?? true,
        callbackTransport: item.callbackTransport || 'NONE',
        callbackUrl: item.callbackUrl || undefined,
        callbackNatsSubject: item.callbackNatsSubject || undefined,
        callbackPayloadTemplate: item.callbackPayloadTemplate || undefined,
        callbackOnPrintResult: Boolean(item.callbackOnPrintResult),
      };
      try {
        if (existing) {
          await apiFetch(`/v1/webhook-endpoints/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await apiFetch('/v1/webhook-endpoints', { method: 'POST', body: JSON.stringify(payload) });
        }
        result.success += 1;
      } catch (error) {
        result.failed.push({ endpointCode: candidate.endpointCode, reason: errorMessage(error) });
      }
    }

    setImportCandidates(null);
    showFeedback({
      tone: result.failed.length > 0 ? 'error' : 'success',
      text: t('page.webhooks.importResult')
        .replace('{success}', String(result.success))
        .replace('{skipped}', String(result.skipped))
        .replace('{failed}', String(result.failed.length)),
      details: result.failed.map((failure) => `${failure.endpointCode}: ${failure.reason}`),
      persistent: result.failed.length > 0,
    });
    endpointsResource.refresh();
    setBusy(false);
  }, [endpoints, endpointsResource.refresh, importCandidates, overwriteExisting, showFeedback, t]);

  const exportEndpoints = useCallback(async (scope: 'all' | 'filtered' | 'selected') => {
    const rows = scope === 'all' ? endpoints : scope === 'filtered' ? filteredEndpoints : selectedEndpoints;
    if (rows.length === 0) {
      showFeedback({ tone: 'info', text: t('page.webhooks.toastNothingToExport') });
      return;
    }
    const payload = {
      version: 1,
      scope,
      exportedAt: new Date().toISOString(),
      count: rows.length,
      endpoints: rows.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...endpoint }) => endpoint),
    };
    const result = await saveOrDownloadJsonFile(
      `webhook-endpoints-${scope}-${new Date().toISOString().slice(0, 10)}.json`,
      payload,
    );
    if (result.cancelled) return;
    showFeedback({
      tone: result.success ? 'success' : 'error',
      text: result.message || (result.success
        ? t('page.webhooks.toastExported').replace('{n}', String(rows.length))
        : t('page.webhooks.toastExportFailed')),
      persistent: !result.success,
    });
  }, [endpoints, filteredEndpoints, selectedEndpoints, showFeedback, t]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  }, []);

  const allPageSelected = pagedEndpoints.length > 0 && pagedEndpoints.every((endpoint) => selectedIds.includes(endpoint.id));
  const toggleSelectPage = useCallback(() => {
    const ids = pagedEndpoints.map((endpoint) => endpoint.id);
    setSelectedIds((current) => allPageSelected
      ? current.filter((id) => !ids.includes(id))
      : Array.from(new Set([...current, ...ids])));
  }, [allPageSelected, pagedEndpoints]);

  return {
    t,
    view,
    setView,
    endpoints,
    policies,
    form,
    updateForm,
    errors,
    editingId,
    busy,
    feedback,
    setFeedback,
    endpointsResource,
    policiesResource,
    callbackLogResource,
    refreshEndpoints,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    filteredEndpoints,
    pagedEndpoints,
    selectedIds,
    selectedEndpoints,
    allPageSelected,
    toggleSelect,
    toggleSelectPage,
    setSelectedIds,
    openCreate,
    openEdit,
    closeEditor,
    saveEndpoint,
    testCallback,
    toggleEndpoint,
    detailsEndpoint,
    setDetailsEndpoint,
    pendingDelete,
    setPendingDelete,
    confirmDelete,
    batchDeleteOpen,
    setBatchDeleteOpen,
    confirmBatchDelete,
    importCandidates,
    setImportCandidates,
    overwriteExisting,
    setOverwriteExisting,
    prepareImport,
    confirmImport,
    exportEndpoints,
    logFilters,
    setLogFilters,
    visibleAttempts,
    selectedAttempt,
    setSelectedAttempt,
  };
}

export type WebhookWorkspaceController = ReturnType<typeof useWebhookWorkspace>;
