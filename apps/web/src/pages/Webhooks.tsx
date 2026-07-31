import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { ErrorBanner, Freshness } from '../components/PageState.js';
import { saveOrDownloadJsonFile } from '../utils/fileExport.js';
import { parseWebhookImportJson } from '../features/webhooks/parseImportJson.js';

interface Endpoint {
  id: string;
  endpointCode: string;
  name: string;
  sourceSystem: string;
  authMode: string;
  enabled: boolean;
  routePolicyId: string;
  callbackTransport: 'NONE' | 'HTTP' | 'NATS' | 'BOTH';
  callbackUrl?: string;
  callbackNatsSubject?: string;
  callbackPayloadTemplate?: Record<string, unknown>;
  callbackOnPrintResult: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface Policy {
  id: string;
  policyCode: string;
  name: string;
}

interface CallbackTransportResult {
  attempted: boolean;
  success: boolean;
  target?: string;
  httpStatus?: number;
  error?: string;
  durationMs: number;
}

interface CallbackTestResponse {
  ok: boolean;
  id: string;
  transport: string;
  delivery: { http?: CallbackTransportResult; nats?: CallbackTransportResult };
}

interface CallbackAttempt {
  id: string;
  endpointId: string;
  endpointCode: string;
  transport: 'HTTP' | 'NATS';
  target: string;
  outcome: 'success' | 'failed' | 'skipped';
  httpStatus?: number;
  errorMessage?: string;
  durationMs: number;
  trigger: 'live' | 'test';
  occurredAt: string;
}

const DEFAULT_JSON_TEMPLATE = `{
  "event": "\${.event}",
  "printerId": "\${.printerId}",
  "jobId": "\${.jobId}",
  "status": "\${.status}",
  "timestamp": "\${.timestamp}"
}`;

const AVAILABLE_VARIABLES = [
  '$.event',
  '$.printerId',
  '$.jobId',
  '$.status',
  '$.timestamp',
  '$.fieldName',
];

const SOURCE_SYSTEM_PRESETS = [
  'integration-service',
  'his-system',
  'pos-gateway',
  'erp-backend',
  'lab-intake',
];

export default function Webhooks() {
  const { t } = useLocale();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [form, setForm] = useState({
    endpointCode: '',
    name: '',
    sourceSystem: 'integration-service',
    authMode: 'NONE',
    routePolicyId: '',
    callbackTransport: 'NONE' as Endpoint['callbackTransport'],
    callbackUrl: '',
    callbackNatsSubject: '',
    callbackPayloadTemplate: DEFAULT_JSON_TEMPLATE,
    callbackOnPrintResult: false,
  });

  // UI State
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tabFilter, setTabFilter] = useState<'all' | 'active' | 'draft' | 'none_callback'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'none_callback'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedEndpointModal, setSelectedEndpointModal] = useState<Endpoint | null>(null);

  // Bulk Selection & Import/Export State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importModalEndpoints, setImportModalEndpoints] = useState<Partial<Endpoint>[] | null>(null);
  const [overwriteExistingOnImport, setOverwriteExistingOnImport] = useState(true);
  const [pendingDeleteEndpoint, setPendingDeleteEndpoint] = useState<Endpoint | null>(null);

  // Callback delivery log — the REAL outcome of every webhook callback
  // attempt (live traffic + sandbox test fires), so "did it actually
  // succeed?" has a visible answer instead of just a unit test.
  const [callbackLog, setCallbackLog] = useState<CallbackAttempt[]>([]);
  const [callbackLogLoading, setCallbackLogLoading] = useState(false);
  const [callbackLogFailedOnly, setCallbackLogFailedOnly] = useState(false);

  const endpointCodeInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formCardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Endpoints + policies move onto the shared resource machinery. The policy
  // list in particular was `.catch(() => {})`: with it empty, every endpoint
  // rendered as bound to nothing.
  const fetchEndpoints = useCallback(() => apiFetch<Endpoint[]>('/v1/webhook-endpoints'), []);
  const fetchPolicies = useCallback(() => apiFetch<Policy[]>('/v1/webhook-route-policies'), []);

  const endpointsResource = useApiResource(fetchEndpoints);
  const policiesResource = useApiResource(fetchPolicies);

  const loadData = useCallback(() => {
    endpointsResource.refresh();
    policiesResource.refresh();
  }, [endpointsResource.refresh, policiesResource.refresh]);

  useEffect(() => {
    if (!endpointsResource.data) return;
    const rows = endpointsResource.data;
    setEndpoints(rows);
    // Drop selected ids that no longer exist.
    setSelectedIds((prev) => prev.filter((id) => rows.some((e) => e.id === id)));
  }, [endpointsResource.data]);

  useEffect(() => {
    if (policiesResource.data) setPolicies(policiesResource.data);
  }, [policiesResource.data]);

  const fetchCallbackLog = useCallback(
    () =>
      apiFetch<CallbackAttempt[]>(
        `/v1/webhook-endpoints/callback-log${callbackLogFailedOnly ? '?limit=100&outcome=failed' : '?limit=100'}`,
      ),
    [callbackLogFailedOnly],
  );
  const callbackLogResource = useApiResource(fetchCallbackLog);
  const loadCallbackLog = callbackLogResource.refresh;

  useEffect(() => {
    setCallbackLog(callbackLogResource.data ?? []);
  }, [callbackLogResource.data]);

  useEffect(() => {
    setCallbackLogLoading(callbackLogResource.loading || callbackLogResource.refreshing);
  }, [callbackLogResource.loading, callbackLogResource.refreshing]);

  // Keyboard shortcut Ctrl+K to focus search box
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      endpointCode: '',
      name: '',
      sourceSystem: 'integration-service',
      authMode: 'NONE',
      routePolicyId: '',
      callbackTransport: 'NONE',
      callbackUrl: '',
      callbackNatsSubject: '',
      callbackPayloadTemplate: DEFAULT_JSON_TEMPLATE,
      callbackOnPrintResult: false,
    });
  };

  const scrollToFormAndFocus = () => {
    resetForm();
    formCardRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => {
      endpointCodeInputRef.current?.focus();
    }, 300);
  };

  const insertVariableIntoTemplate = (variable: string) => {
    const varPattern = `\${.${variable.replace('$.', '')}}`;
    const textarea = textareaRef.current;
    if (!textarea) {
      setForm((prev) => ({
        ...prev,
        callbackPayloadTemplate: prev.callbackPayloadTemplate + ' ' + varPattern,
      }));
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = form.callbackPayloadTemplate;
    const updated = current.substring(0, start) + varPattern + current.substring(end);
    setForm((prev) => ({ ...prev, callbackPayloadTemplate: updated }));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + varPattern.length, start + varPattern.length);
    }, 0);
  };

  async function handleSave(isEnabled: boolean) {
    if (!form.endpointCode.trim()) {
      showToast(t('page.webhooks.toastCodeRequired'), 'error');
      return;
    }
    if (!form.name.trim()) {
      showToast(t('page.webhooks.toastNameRequired'), 'error');
      return;
    }

    let parsedPayloadTemplate: Record<string, unknown> | undefined = undefined;
    if (form.callbackPayloadTemplate.trim()) {
      try {
        parsedPayloadTemplate = JSON.parse(form.callbackPayloadTemplate);
      } catch {
        showToast(t('page.webhooks.toastInvalidPayloadJson'), 'error');
        return;
      }
    }

    const body: Record<string, unknown> = {
      endpointCode: form.endpointCode.trim(),
      name: form.name.trim(),
      sourceSystem: form.sourceSystem.trim() || 'integration-service',
      authMode: form.authMode,
      routePolicyId: form.routePolicyId,
      enabled: isEnabled,
      callbackTransport: form.callbackTransport,
      callbackUrl: form.callbackUrl.trim() || undefined,
      callbackNatsSubject: form.callbackNatsSubject.trim() || undefined,
      callbackPayloadTemplate: parsedPayloadTemplate,
      callbackOnPrintResult: form.callbackOnPrintResult,
    };

    try {
      if (editingId) {
        await apiFetch(`/v1/webhook-endpoints/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        showToast(isEnabled ? t('page.webhooks.toastUpdated') : t('page.webhooks.toastDraftUpdated'));
      } else {
        await apiFetch('/v1/webhook-endpoints', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        showToast(isEnabled ? t('page.webhooks.toastCreated') : t('page.webhooks.toastDraftCreated'));
      }

      resetForm();
      loadData();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : t('page.webhooks.toastSaveError');
      showToast(errMsg, 'error');
    }
  }

  function startEdit(e: Endpoint) {
    setEditingId(e.id);
    setForm({
      endpointCode: e.endpointCode,
      name: e.name,
      sourceSystem: e.sourceSystem || 'integration-service',
      authMode: e.authMode || 'NONE',
      routePolicyId: e.routePolicyId || '',
      callbackTransport: e.callbackTransport || 'NONE',
      callbackUrl: e.callbackUrl ?? '',
      callbackNatsSubject: e.callbackNatsSubject ?? '',
      callbackPayloadTemplate: e.callbackPayloadTemplate
        ? JSON.stringify(e.callbackPayloadTemplate, null, 2)
        : DEFAULT_JSON_TEMPLATE,
      callbackOnPrintResult: !!e.callbackOnPrintResult,
    });
    formCardRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  /** Fires a real callback-test and reports the ACTUAL delivery outcome per
   * transport — status code / error included — instead of a blind "success"
   * toast regardless of whether the HTTP POST or NATS publish really landed.
   * Also refreshes the callback log so the attempt shows up immediately. */
  async function testCallback(e?: Endpoint) {
    const targetId = e?.id || editingId;
    if (!targetId) {
      showToast(t('page.webhooks.toastNeedEndpointForTest'), 'info');
      return;
    }

    try {
      showToast(t('page.webhooks.toastTestingCallback'), 'info');
      const res = await apiFetch<CallbackTestResponse>(
        `/v1/webhook-endpoints/${targetId}/callback-test`,
        {
          method: 'POST',
          body: JSON.stringify({
            samplePayload: {
              event: 'PRINT_COMPLETED',
              printerId: 'PRN-001',
              jobId: 'JOB-12345',
              status: 'COMPLETED',
              timestamp: new Date().toISOString(),
            },
          }),
        }
      );

      const describe = (label: string, r?: CallbackTransportResult): string | null => {
        if (!r) return null;
        if (!r.attempted) return `${label}: ${t('page.webhooks.outcomeSkipped')} (${r.error || t('page.webhooks.notSent')})`;
        if (r.success) return `${label}: ${t('page.webhooks.outcomeSuccess')}${r.httpStatus ? ` (${r.httpStatus})` : ''}`;
        return `${label}: ${t('page.webhooks.outcomeFailed')}${r.httpStatus ? ` (${r.httpStatus})` : ''}${r.error ? ` — ${r.error}` : ''}`;
      };
      const parts = [describe('HTTP', res.delivery.http), describe('NATS', res.delivery.nats)].filter(Boolean);
      showToast(
        parts.length > 0 ? parts.join(' | ') : t('page.webhooks.toastNoCallbackConfigured'),
        res.ok ? 'success' : 'error',
      );
      loadCallbackLog();
    } catch (err: unknown) {
      showToast(`${t('page.webhooks.toastCallbackTestFailed')} ${errorMessage(err)}`, 'error');
    }
  }

  async function toggleStatus(e: Endpoint) {
    try {
      await apiFetch(`/v1/webhook-endpoints/${e.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !e.enabled }),
      });
      const statusLabel = !e.enabled ? t('page.webhooks.statusEnabled') : t('page.webhooks.statusDraft');
      showToast(t('page.webhooks.toastStatusChanged').replace('{code}', e.endpointCode).replace('{status}', statusLabel));
      loadData();
    } catch (err: unknown) {
      showToast(`${t('page.webhooks.toastStatusChangeFailed')} ${errorMessage(err)}`, 'error');
    }
  }

  async function handleDelete(e: Endpoint) {
    setPendingDeleteEndpoint(e);
  }

  async function confirmDeleteEndpoint() {
    const e = pendingDeleteEndpoint;
    if (!e) return;
    setPendingDeleteEndpoint(null);
    try {
      await apiFetch(`/v1/webhook-endpoints/${e.id}`, { method: 'DELETE' });
      showToast(t('page.webhooks.toastDeleted').replace('{code}', e.endpointCode));
      if (editingId === e.id) resetForm();
      loadData();
    } catch (err: unknown) {
      showToast(`${t('page.webhooks.toastDeleteFailed')} ${errorMessage(err)}`, 'error');
    }
  }

  // --- Export Feature ---
  const handleExportJSON = async (targetEndpoints?: Endpoint[]) => {
    const listToExport = targetEndpoints || (selectedIds.length > 0
      ? endpoints.filter((e) => selectedIds.includes(e.id))
      : endpoints);

    if (listToExport.length === 0) {
      showToast(t('page.webhooks.toastNothingToExport'), 'info');
      return;
    }

    const exportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: listToExport.length,
      endpoints: listToExport.map((e) => ({
        endpointCode: e.endpointCode,
        name: e.name,
        sourceSystem: e.sourceSystem,
        authMode: e.authMode,
        enabled: e.enabled,
        routePolicyId: e.routePolicyId,
        callbackTransport: e.callbackTransport,
        callbackUrl: e.callbackUrl,
        callbackNatsSubject: e.callbackNatsSubject,
        callbackPayloadTemplate: e.callbackPayloadTemplate,
        callbackOnPrintResult: e.callbackOnPrintResult,
      })),
    };

    const filename = `webhook-endpoints-export-${new Date().toISOString().slice(0, 10)}.json`;
    const res = await saveOrDownloadJsonFile(filename, exportPayload);
    if (res.cancelled) return;

    if (res.success) {
      showToast(res.message || t('page.webhooks.toastExported').replace('{n}', String(listToExport.length)));
    } else {
      showToast(res.message || t('page.webhooks.toastExportFailed'), 'error');
    }
  };

  // --- Import Feature ---
  const handleFileChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    // Clear immediately so choosing the same file again still triggers change.
    ev.target.value = '';
    try {
      const parsed = parseWebhookImportJson(await file.arrayBuffer());
      const importedList: Partial<Endpoint>[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { endpoints?: unknown }).endpoints)
        ? (parsed as { endpoints: Partial<Endpoint>[] }).endpoints
        : [];

      if (importedList.length === 0) {
        showToast(t('page.webhooks.toastImportEmpty'), 'error');
        return;
      }

      // Validate required fields
      const validList = importedList.filter((item) => item.endpointCode && item.name);
      if (validList.length === 0) {
        showToast(t('page.webhooks.toastImportInvalidStructure'), 'error');
        return;
      }

      setImportModalEndpoints(validList);
    } catch (err: unknown) {
      showToast(`${t('page.webhooks.toastImportReadFailed')} ${errorMessage(err)}`, 'error');
    }
  };

  const confirmImport = async () => {
    if (!importModalEndpoints || importModalEndpoints.length === 0) return;

    let successCount = 0;
    let firstImportFailure = '';
    showToast(t('page.webhooks.toastImporting').replace('{n}', String(importModalEndpoints.length)), 'info');

    for (const item of importModalEndpoints) {
      if (!item.endpointCode || !item.name) continue;

      const existing = endpoints.find((e) => e.endpointCode === item.endpointCode);
      const payload: Record<string, unknown> = {
        endpointCode: item.endpointCode,
        name: item.name,
        sourceSystem: item.sourceSystem || 'integration-service',
        authMode: item.authMode || 'NONE',
        routePolicyId: item.routePolicyId || '',
        enabled: item.enabled ?? true,
        callbackTransport: item.callbackTransport || 'NONE',
        callbackUrl: item.callbackUrl || undefined,
        callbackNatsSubject: item.callbackNatsSubject || undefined,
        callbackPayloadTemplate: item.callbackPayloadTemplate || undefined,
        callbackOnPrintResult: !!item.callbackOnPrintResult,
      };

      try {
        if (existing && overwriteExistingOnImport) {
          await apiFetch(`/v1/webhook-endpoints/${existing.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          successCount++;
        } else if (!existing) {
          await apiFetch('/v1/webhook-endpoints', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          successCount++;
        }
      } catch (err: unknown) {
        // Continuing is deliberate — one rejected endpoint must not abort the
        // rest of the import. The reason is now carried into the summary
        // instead of being dropped entirely.
        if (!firstImportFailure) {
          firstImportFailure = `${item.endpointCode ?? '?'}: ${errorMessage(err)}`;
        }
      }
    }

    setImportModalEndpoints(null);
    const importSummary = t('page.webhooks.toastImported')
      .replace('{success}', String(successCount))
      .replace('{total}', String(importModalEndpoints.length));
    showToast(
      firstImportFailure ? `${importSummary} — ${firstImportFailure}` : importSummary,
      firstImportFailure ? 'error' : 'success',
    );
    loadData();
  };

  // --- Batch Delete Feature ---
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(t('page.webhooks.confirmBatchDelete').replace('{n}', String(selectedIds.length)))) return;

    showToast(t('page.webhooks.toastBatchDeleting').replace('{n}', String(selectedIds.length)), 'info');
    let deletedCount = 0;
    let firstDeleteFailure = '';

    await Promise.all(
      selectedIds.map(async (id) => {
        try {
          await apiFetch(`/v1/webhook-endpoints/${id}`, { method: 'DELETE' });
          deletedCount++;
        } catch (err: unknown) {
          // Per-item failure does not abort the batch, but "deleted 3" out of 5
          // selected used to be the only signal that anything went wrong.
          if (!firstDeleteFailure) firstDeleteFailure = errorMessage(err);
        }
      })
    );

    setSelectedIds([]);
    const deleteSummary = t('page.webhooks.toastBatchDeleted').replace('{n}', String(deletedCount));
    const failedCount = selectedIds.length - deletedCount;
    showToast(
      failedCount > 0
        ? `${deleteSummary} — ${t('page.webhooks.toastBatchDeleteFailures').replace('{n}', String(failedCount))} ${firstDeleteFailure}`
        : deleteSummary,
      failedCount > 0 ? 'error' : 'success',
    );
    loadData();
  };

  // Calculate tabs count
  const counts = useMemo(() => {
    return {
      all: endpoints.length,
      active: endpoints.filter((e) => e.enabled).length,
      draft: endpoints.filter((e) => !e.enabled).length,
      none_callback: endpoints.filter((e) => e.callbackTransport === 'NONE').length,
    };
  }, [endpoints]);

  // Filtered Endpoints
  const filteredEndpoints = useMemo(() => {
    return endpoints.filter((e) => {
      // Tab filter
      if (tabFilter === 'active' && !e.enabled) return false;
      if (tabFilter === 'draft' && e.enabled) return false;
      if (tabFilter === 'none_callback' && e.callbackTransport !== 'NONE') return false;

      // Status dropdown filter
      if (statusFilter === 'active' && !e.enabled) return false;
      if (statusFilter === 'draft' && e.enabled) return false;
      if (statusFilter === 'none_callback' && e.callbackTransport !== 'NONE') return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const codeMatch = e.endpointCode.toLowerCase().includes(q);
        const nameMatch = e.name.toLowerCase().includes(q);
        const sourceMatch = e.sourceSystem.toLowerCase().includes(q);
        return codeMatch || nameMatch || sourceMatch;
      }
      return true;
    });
  }, [endpoints, tabFilter, statusFilter, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredEndpoints.length / pageSize) || 1;
  const paginatedEndpoints = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredEndpoints.slice(start, start + pageSize);
  }, [filteredEndpoints, page, pageSize]);

  // Checkbox Selection logic
  const isAllPaginatedSelected = useMemo(() => {
    if (paginatedEndpoints.length === 0) return false;
    return paginatedEndpoints.every((e) => selectedIds.includes(e.id));
  }, [paginatedEndpoints, selectedIds]);

  const toggleSelectAllPaginated = () => {
    if (isAllPaginatedSelected) {
      const pageIds = paginatedEndpoints.map((e) => e.id);
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      const pageIds = paginatedEndpoints.map((e) => e.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Lines count for template textarea
  const lineNumbers = useMemo(() => {
    const lineCount = (form.callbackPayloadTemplate.match(/\n/g) || []).length + 1;
    return Array.from({ length: Math.max(lineCount, 7) }, (_, i) => i + 1);
  }, [form.callbackPayloadTemplate]);

  const formatDate = (d?: string | Date) => {
    if (!d) return '-';
    try {
      const date = new Date(d);
      return date.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(d);
    }
  };

  return (
    <div className="wh-container">
      {/* Hidden File Input for Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Toast Notification Banner */}
      {toast && (
        <div className={`ds-toast ds-toast--${toast.type}`}>
          <span>{toast.message}</span>
          <button
            className="ds-toast__close"
            onClick={() => setToast(null)}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      )}

      {/* An endpoint list that failed to load must not read as "no webhooks
          configured" — that invites re-creating endpoints that already exist. */}
      {endpointsResource.error != null && (
        <ErrorBanner
          error={endpointsResource.error}
          title={t('page.webhooks.toastLoadFailed')}
          onRetry={endpointsResource.refresh}
        />
      )}

      {policiesResource.error != null && (
        <ErrorBanner
          error={policiesResource.error}
          title={t('page.webhooks.policiesLoadFailed')}
          onRetry={policiesResource.refresh}
        />
      )}

      {callbackLogResource.error != null && (
        <ErrorBanner
          error={callbackLogResource.error}
          title={t('page.webhooks.callbackLogLoadFailed')}
          onRetry={callbackLogResource.refresh}
        />
      )}

      {/* Top Page Header */}
      <header className="wh-header">
        <div className="wh-header-title-area">
          <div className="wh-header-icon">🔗</div>
          <div className="wh-header-text">
            <h1>{t('page.webhooks.title')}</h1>
            <p>{t('page.webhooks.subtitle')}</p>
            <Freshness
              lastSuccessAt={endpointsResource.lastSuccessAt}
              stale={endpointsResource.stale}
              refreshing={endpointsResource.refreshing}
              onRefresh={loadData}
            />
          </div>
        </div>

        <div className="wh-header-actions">
          <button className="ds-btn ds-btn--ghost" onClick={() => handleExportJSON()} title={t('page.webhooks.exportTitle')}>
            ⤓ {t('page.webhooks.export')}
          </button>
          <button className="ds-btn ds-btn--ghost" onClick={() => fileInputRef.current?.click()} title={t('page.webhooks.importTitle')}>
            ⤒ {t('page.webhooks.import')}
          </button>

          <div className="wh-search-box">
            <span className="wh-search-icon-left">🔍</span>
            <input
              aria-label={t('page.webhooks.searchPlaceholder')}
              ref={searchInputRef}
              type="text"
              className="wh-search-input"
              placeholder={t('page.webhooks.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <span className="wh-search-badge">Ctrl + K</span>
          </div>

          <button className="ds-btn ds-btn--primary" onClick={scrollToFormAndFocus}>
            <span>+</span> {t('page.webhooks.create')}
          </button>
        </div>
      </header>

      {/* Bulk Selection Action Bar */}
      {selectedIds.length > 0 && (
        <div className="wh-bulk-bar">
          <div>
            ✓ {t('page.webhooks.selectCount').replace('{n}', String(selectedIds.length))}
          </div>
          <div className="wh-bulk-actions">
            <button className="ds-btn ds-btn--ghost" onClick={() => handleExportJSON(endpoints.filter((e) => selectedIds.includes(e.id)))}>
              ⤓ {t('page.webhooks.exportSelected')}
            </button>
            <button className="ds-btn ds-btn--danger" onClick={() => void handleBatchDelete()}>
              🗑️ {t('page.webhooks.deleteSelected').replace('{n}', String(selectedIds.length))}
            </button>
            <button className="ds-btn ds-btn--ghost" onClick={() => setSelectedIds([])}>
              ✕ {t('page.webhooks.clearSelection')}
            </button>
          </div>
        </div>
      )}

      {/* Main Card 1: Form Section */}
      <div className="wh-card" ref={formCardRef}>
        <div className="wh-card-title">
          <span>{editingId ? t('page.webhooks.editingTitle').replace('{code}', form.endpointCode) : t('page.webhooks.createCardTitle')}</span>
          {editingId && (
            <button
              className="wh-action-btn"
              onClick={resetForm}
              style={{ fontSize: '0.8rem', fontWeight: 500 }}
            >
              ✕ {t('page.webhooks.cancelEdit')}
            </button>
          )}
        </div>

        <div className="wh-form-layout">
          {/* Left Column: Form Fields */}
          <div className="wh-form-main">
            {/* 1. Basic Info */}
            <div className="wh-form-section-title">{t('page.webhooks.basicInfo')}</div>
            <div className="wh-grid-4">
              <div className="wh-field">
                <label className="wh-field-label">
                  {t('page.webhooks.endpointCode')} <span className="required">*</span>
                </label>
                <input
                  aria-label={t('page.webhooks.endpointCode')}
                  ref={endpointCodeInputRef}
                  className="wh-input"
                  placeholder={t('page.webhooks.endpointCodePlaceholder')}
                  value={form.endpointCode}
                  disabled={!!editingId}
                  onChange={(e) => setForm({ ...form, endpointCode: e.target.value })}
                />
                <span className="wh-field-hint">{t('page.webhooks.endpointCodeHint')}</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">
                  {t('page.webhooks.name')} <span className="required">*</span>
                </label>
                <input
                  aria-label={t('page.webhooks.name')}
                  className="wh-input"
                  placeholder={t('page.webhooks.namePlaceholder')}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <span className="wh-field-hint">{t('page.webhooks.nameHint')}</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">{t('page.webhooks.source')}</label>
                <input
                  aria-label={t('page.webhooks.source')}
                  className="wh-input"
                  list="source-systems-list"
                  placeholder={t('page.webhooks.sourcePlaceholder')}
                  value={form.sourceSystem}
                  onChange={(e) => setForm({ ...form, sourceSystem: e.target.value })}
                />
                <datalist id="source-systems-list">
                  {SOURCE_SYSTEM_PRESETS.map((sys) => (
                    <option key={sys} value={sys} />
                  ))}
                </datalist>
                <span className="wh-field-hint">{t('page.webhooks.sourceHint')}</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">{t('page.webhooks.authPolicyLabel')}</label>
                <select
                  aria-label={t('page.webhooks.authPolicyLabel')}
                  className="wh-select"
                  value={form.routePolicyId || form.authMode}
                  onChange={(e) => {
                    const val = e.target.value;
                    const matchedPolicy = policies.find((p) => p.id === val);
                    if (matchedPolicy) {
                      setForm({ ...form, routePolicyId: val });
                    } else {
                      setForm({ ...form, routePolicyId: '', authMode: val });
                    }
                  }}
                >
                  <option value="NONE">NONE</option>
                  <option value="API_KEY">API_KEY</option>
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.policyCode} ({p.name})
                    </option>
                  ))}
                </select>
                <span className="wh-field-hint">{t('page.webhooks.authPolicyHint')}</span>
              </div>
            </div>

            {/* 2. Callback Section */}
            <div className="wh-form-section-title" style={{ marginTop: '1.25rem' }}>
              {t('page.webhooks.callback')}
            </div>
            <div className="wh-grid-3">
              <div className="wh-field">
                <label className="wh-field-label">{t('page.webhooks.callbackModeLabel')}</label>
                <select
                  aria-label={t('page.webhooks.callbackModeLabel')}
                  className="wh-select"
                  value={form.callbackTransport}
                  onChange={(e) =>
                    setForm({ ...form, callbackTransport: e.target.value as Endpoint['callbackTransport'] })
                  }
                >
                  <option value="NONE">{t('page.webhooks.transport.none')}</option>
                  <option value="HTTP">HTTP</option>
                  <option value="NATS">NATS</option>
                  <option value="BOTH">BOTH (HTTP + NATS)</option>
                </select>
                <span className="wh-field-hint">{t('page.webhooks.callbackModeHint')}</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">
                  Callback URL <span>🔗</span>
                </label>
                <input
                  aria-label="Callback URL"
                  className="wh-input"
                  placeholder="https://example.com/webhook"
                  value={form.callbackUrl}
                  disabled={form.callbackTransport === 'NONE' || form.callbackTransport === 'NATS'}
                  onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })}
                />
                <span className="wh-field-hint">{t('page.webhooks.callbackUrlHint')}</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">{t('page.webhooks.natsSubjectLabel')}</label>
                <input
                  aria-label={t('page.webhooks.natsSubjectLabel')}
                  className="wh-input"
                  placeholder={t('page.webhooks.natsSubjectPlaceholder')}
                  value={form.callbackNatsSubject}
                  disabled={form.callbackTransport === 'NONE' || form.callbackTransport === 'HTTP'}
                  onChange={(e) => setForm({ ...form, callbackNatsSubject: e.target.value })}
                />
                <span className="wh-field-hint">{t('page.webhooks.natsSubjectHint')}</span>
              </div>
            </div>

            {/* 3. JSON Payload Template Editor */}
            <div className="wh-field" style={{ marginTop: '1rem' }}>
              <label className="wh-field-label">
                {t('page.webhooks.payloadTemplate')}
              </label>
              {/* The template shapes the ACCEPTANCE callback only. Terminal
                  result callbacks use a fixed, versioned envelope so every
                  receiver can rely on the same schema — say so here rather than
                  letting an operator configure a template that is then silently
                  ignored the moment they enable result callbacks. */}
              {form.callbackOnPrintResult && (
                <span className="wh-field-hint" style={{ color: '#8a5a00' }}>
                  ⚠ {t('page.webhooks.payloadTemplateIgnoredOnResult')}
                </span>
              )}

              <div className="wh-template-grid">
                {/* Code Editor Container */}
                <div className="wh-code-editor">
                  <div className="wh-line-numbers">
                    {lineNumbers.map((num) => (
                      <div key={num}>{num}</div>
                    ))}
                  </div>
                  <textarea
                    aria-label={t('page.webhooks.payloadTemplate')}
                    ref={textareaRef}
                    className="wh-code-textarea"
                    rows={7}
                    value={form.callbackPayloadTemplate}
                    onChange={(e) => setForm({ ...form, callbackPayloadTemplate: e.target.value })}
                  />
                </div>

                {/* Right Switch Toggle Box */}
                <div className="wh-toggle-box">
                  <div className="wh-toggle-row">
                    <span className="wh-toggle-label">{t('page.webhooks.sendOnPrintDone')}</span>
                    <label className="wh-switch">
                      <input
                        type="checkbox"
                        checked={form.callbackOnPrintResult}
                        onChange={(e) => setForm({ ...form, callbackOnPrintResult: e.target.checked })}
                      />
                      <span className="wh-slider"></span>
                    </label>
                  </div>
                  <span className="wh-field-hint" style={{ marginTop: 0 }}>
                    {t('page.webhooks.onPrintResult')}
                  </span>
                  {/* This toggle used to be wired to nothing: it persisted, and
                      no dispatch code read it. Spell out what each position now
                      actually does so the difference is testable by an
                      operator, not just by a developer. */}
                  <span className="wh-field-hint">
                    {form.callbackOnPrintResult
                      ? t('page.webhooks.onPrintResultOnHelp')
                      : t('page.webhooks.onPrintResultOffHelp')}
                  </span>
                  {form.callbackOnPrintResult &&
                    (form.callbackTransport === 'NATS' || form.callbackTransport === 'BOTH') && (
                      <span className="wh-field-hint" style={{ color: '#8a5a00' }}>
                        ⚠ {t('page.webhooks.natsBestEffortWarning')}
                      </span>
                    )}
                </div>
              </div>
            </div>

            {/* Form Buttons */}
            <div className="wh-form-actions">
              <button className="ds-btn ds-btn--ghost" onClick={() => void handleSave(false)}>
                {t('page.webhooks.saveDraft')}
              </button>
              <button className="ds-btn ds-btn--ghost" onClick={() => void testCallback()}>
                ▷ {t('page.webhooks.testShort')}
              </button>
              <button className="ds-btn ds-btn--primary" onClick={() => void handleSave(true)}>
                {editingId ? t('page.webhooks.saveEndpoint') : t('page.webhooks.createEndpoint')}
              </button>
            </div>
          </div>

          {/* Right Column: Sidebar Info Panel */}
          <div className="wh-sidebar">
            {/* Box 1: Sample Payload */}
            <div className="wh-panel">
              <div className="wh-panel-header">
                <span>{t('page.webhooks.samplePayload')}</span>
              </div>
              <pre className="wh-json-preview">
{`{
  "event": "PRINT_COMPLETED",
  "printerId": "PRN-001",
  "jobId": "JOB-12345",
  "status": "COMPLETED",
  "timestamp": "2025-05-22T10:30:00Z"
}`}
              </pre>
            </div>

            {/* Box 2: Available Variables Pills */}
            <div className="wh-panel">
              <div className="wh-panel-header">
                <span>{t('page.webhooks.availableVariables')}</span>
              </div>
              <div className="wh-var-pills">
                {AVAILABLE_VARIABLES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="wh-var-pill"
                    title={t('page.webhooks.insertVariableTitle').replace('{v}', v.replace('$.', ''))}
                    onClick={() => insertVariableIntoTemplate(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Box 3: Usage Instructions */}
            <div className="wh-panel">
              <div className="wh-panel-header">
                <span>{t('page.webhooks.howToUse')}</span>
              </div>
              <ul className="wh-guide-list">
                <li className="wh-guide-item">
                  <span className="wh-guide-icon">🔗</span>
                  <span>{t('page.webhooks.guide1')}</span>
                </li>
                <li className="wh-guide-item">
                  <span className="wh-guide-icon">▷</span>
                  <span>{t('page.webhooks.guide2')}</span>
                </li>
                <li className="wh-guide-item">
                  <span className="wh-guide-icon">▷</span>
                  <span>{t('page.webhooks.guide3')}</span>
                </li>
                <li className="wh-guide-item">
                  <span className="wh-guide-icon">▷</span>
                  <span>{t('page.webhooks.guide4')}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Main Card 2: Endpoints Table List */}
      <div className="wh-card">
        <div className="wh-table-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {t('page.webhooks.allEndpoints')}
            </h2>

            {/* Filter Tabs */}
            <div className="wh-tabs">
              <button
                className={`wh-tab ${tabFilter === 'all' ? 'wh-tab--active' : ''}`}
                onClick={() => setTabFilter('all')}
              >
                {t('page.webhooks.tabAll')} <span className="wh-tab-badge">{counts.all}</span>
              </button>
              <button
                className={`wh-tab ${tabFilter === 'active' ? 'wh-tab--active' : ''}`}
                onClick={() => setTabFilter('active')}
              >
                {t('page.webhooks.statusEnabled')} <span className="wh-tab-badge">{counts.active}</span>
              </button>
              <button
                className={`wh-tab ${tabFilter === 'draft' ? 'wh-tab--active' : ''}`}
                onClick={() => setTabFilter('draft')}
              >
                {t('page.webhooks.statusDraft')} <span className="wh-tab-badge">{counts.draft}</span>
              </button>
              <button
                className={`wh-tab ${tabFilter === 'none_callback' ? 'wh-tab--active' : ''}`}
                onClick={() => setTabFilter('none_callback')}
              >
                {t('page.webhooks.transport.none')} <span className="wh-tab-badge">{counts.none_callback}</span>
              </button>
            </div>
          </div>

          <div className="wh-table-controls">
            <div className="wh-search-box">
              <span className="wh-search-icon-left">🔍</span>
              <input
                aria-label={t('page.webhooks.searchPlaceholder')}
                type="text"
                className="wh-search-input"
                style={{ width: 190, paddingRight: '1rem' }}
                placeholder={t('page.webhooks.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              aria-label={t('page.webhooks.statusAllOption')}
              className="wh-select"
              style={{ height: 38 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">{t('page.webhooks.statusAllOption')}</option>
              <option value="active">{t('page.webhooks.statusEnabled')}</option>
              <option value="draft">{t('page.webhooks.statusDraft')}</option>
              <option value="none_callback">{t('page.webhooks.transport.none')}</option>
            </select>

            <button className="wh-icon-btn" title={t('common.refresh')} onClick={loadData}>
              🔁
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="wh-table-wrapper">
          <table className="wh-table">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }}>
                  <input
                    aria-label={t('page.webhooks.selectAllOnPage')}
                    type="checkbox"
                    checked={isAllPaginatedSelected}
                    onChange={toggleSelectAllPaginated}
                    disabled={paginatedEndpoints.length === 0}
                    title={t('page.webhooks.selectAllOnPage')}
                  />
                </th>
                <th>{t('page.webhooks.endpoint')}</th>
                <th>{t('page.webhooks.source')}</th>
                <th>{t('page.webhooks.auth')}</th>
                <th>{t('page.webhooks.enabled')}</th>
                <th>{t('page.webhooks.callback')}</th>
                <th>{t('page.webhooks.updatedAt')}</th>
                <th style={{ textAlign: 'right' }}>{t('page.webhooks.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEndpoints.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {t('page.webhooks.noResults')}
                  </td>
                </tr>
              ) : (
                paginatedEndpoints.map((e) => (
                  <tr key={e.id} style={{ background: selectedIds.includes(e.id) ? '#eff6ff' : undefined }}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        aria-label={`${t('page.webhooks.endpoint')} ${e.endpointCode}`}
                        type="checkbox"
                        checked={selectedIds.includes(e.id)}
                        onChange={() => toggleSelectRow(e.id)}
                      />
                    </td>
                    <td>
                      <button
                        className="wh-endpoint-link"
                        onClick={() => setSelectedEndpointModal(e)}
                        title={t('page.webhooks.viewIntakeUrlTitle')}
                      >
                        {e.endpointCode} <span>🔗</span>
                      </button>
                    </td>
                    <td>{e.sourceSystem || 'integration-service'}</td>
                    <td>{e.authMode || 'NONE'}</td>
                    <td>
                      {e.enabled ? (
                        <span className="ds-status-badge ds-status-badge--active">
                          {t('page.webhooks.statusEnabled')}
                        </span>
                      ) : (
                        <span className="ds-status-badge ds-status-badge--draft">
                          {t('page.webhooks.statusDraft')}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="wh-badge-transport">
                        {e.callbackTransport === 'NONE'
                          ? t('page.webhooks.transport.none')
                          : e.callbackTransport}
                      </span>
                    </td>
                    <td>{formatDate(e.updatedAt || e.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem' }}>
                        <button
                          className="wh-action-btn"
                          onClick={() => void testCallback(e)}
                          title={t('page.webhooks.testCallbackTitle')}
                        >
                          ▷ {t('page.webhooks.test')}
                        </button>
                        <button
                          className="wh-icon-btn"
                          onClick={() => startEdit(e)}
                          title={t('page.webhooks.edit')}
                        >
                          ✏️
                        </button>
                        <button
                          className="wh-icon-btn"
                          onClick={() => void toggleStatus(e)}
                          title={e.enabled ? t('page.webhooks.setDraftTitle') : t('page.webhooks.enableTitle')}
                        >
                          {e.enabled ? '🛑' : '🟢'}
                        </button>
                        <button
                          className="wh-icon-btn"
                          onClick={() => void handleDelete(e)}
                          title={t('page.webhooks.deleteTitle')}
                          style={{ color: '#ef4444' }}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="wh-pagination">
          <div>
            {t('page.webhooks.paginationSummary')
              .replace('{from}', String(filteredEndpoints.length === 0 ? 0 : (page - 1) * pageSize + 1))
              .replace('{to}', String(Math.min(page * pageSize, filteredEndpoints.length)))
              .replace('{total}', String(filteredEndpoints.length))}
          </div>

          <div className="wh-page-controls">
            <button
              className="wh-page-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            <span style={{ padding: '0 0.4rem', fontWeight: 600 }}>{page}</span>
            <button
              className="wh-page-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              ›
            </button>

            <select
              aria-label={t('page.webhooks.perPage').replace('{n}', String(pageSize))}
              className="wh-select"
              style={{ height: 32, padding: '0 0.5rem', fontSize: '0.8rem', marginLeft: '0.5rem' }}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={5}>{t('page.webhooks.perPage').replace('{n}', '5')}</option>
              <option value={10}>{t('page.webhooks.perPage').replace('{n}', '10')}</option>
              <option value={20}>{t('page.webhooks.perPage').replace('{n}', '20')}</option>
              <option value={50}>{t('page.webhooks.perPage').replace('{n}', '50')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Card 3: Callback delivery log — real success/failure history,
          not just "we called send()". Covers both live traffic and every
          "ทดสอบ callback" fire above. */}
      <div className="wh-card">
        <div className="wh-table-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {t('page.webhooks.callbackLogTitle')}
            </h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#475569' }}>
              <input
                type="checkbox"
                checked={callbackLogFailedOnly}
                onChange={(e) => setCallbackLogFailedOnly(e.target.checked)}
              />
              {t('page.webhooks.callbackLogFailedOnly')}
            </label>
          </div>
          <div className="wh-table-controls">
            <button className="wh-icon-btn" title={t('common.refresh')} onClick={loadCallbackLog} disabled={callbackLogLoading}>
              🔁
            </button>
          </div>
        </div>
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0 0 0.5rem' }}>
          {t('page.webhooks.callbackLogDescription')}
        </p>
        <div className="wh-table-wrapper">
          <table className="wh-table">
            <thead>
              <tr>
                <th>{t('page.webhooks.colTime')}</th>
                <th>{t('page.webhooks.endpoint')}</th>
                <th>{t('page.webhooks.colChannel')}</th>
                <th>{t('page.webhooks.colTrigger')}</th>
                <th>{t('page.webhooks.colOutcome')}</th>
                <th>{t('page.webhooks.colHttpStatus')}</th>
                <th>{t('page.webhooks.colDuration')}</th>
                <th>{t('page.webhooks.colDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {callbackLog.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {callbackLogLoading ? t('common.loading') : t('page.webhooks.noCallbackHistory')}
                  </td>
                </tr>
              ) : (
                callbackLog.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDate(a.occurredAt)}</td>
                    <td><code>{a.endpointCode}</code></td>
                    <td>{a.transport}</td>
                    <td>{a.trigger === 'test' ? t('page.webhooks.triggerTest') : t('page.webhooks.triggerLive')}</td>
                    <td>
                      {a.outcome === 'success' ? (
                        <span className="ds-status-badge ds-status-badge--success">{t('page.webhooks.outcomeSuccess')}</span>
                      ) : a.outcome === 'failed' ? (
                        <span className="ds-status-badge ds-status-badge--error">{t('page.webhooks.outcomeFailed')}</span>
                      ) : (
                        <span className="ds-status-badge ds-status-badge--neutral">{t('page.webhooks.outcomeSkipped')}</span>
                      )}
                    </td>
                    <td>{a.httpStatus ?? '—'}</td>
                    <td>{a.durationMs} ms</td>
                    <td style={{ maxWidth: 280, whiteSpace: 'normal', wordBreak: 'break-word', fontSize: '0.8rem', color: '#64748b' }}>
                      {a.errorMessage || a.target || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: Import Preview Confirmation */}
      {importModalEndpoints && (
        <div
          className="ds-modal"
          onClick={() => setImportModalEndpoints(null)}
        >
          <div
            className="ds-modal__panel ds-modal__panel--lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ds-modal__header">
              <h2>⤒ {t('page.webhooks.importModalTitle').replace('{n}', String(importModalEndpoints.length))}</h2>
              <button
                className="ds-btn ds-btn--icon"
                onClick={() => setImportModalEndpoints(null)}
                aria-label={t('common.close')}
              >✕</button>
            </div>

            <div className="ds-modal__body" style={{ padding: '1rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--neutral-text-muted)', margin: '0 0 1rem' }}>
                {t('page.webhooks.importPreviewIntro')}
              </p>

              <div
                style={{
                  maxHeight: 240,
                  overflowY: 'auto',
                  border: '1px solid var(--neutral-border)',
                  borderRadius: 'var(--rounded-md)',
                  marginBottom: '1rem',
                }}
              >
                <table className="wh-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>{t('page.webhooks.colEndpointCode')}</th>
                      <th>{t('page.webhooks.name')}</th>
                      <th>{t('page.webhooks.source')}</th>
                      <th>{t('page.webhooks.colExistingStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importModalEndpoints.map((item, idx) => {
                      const exists = endpoints.some((e) => e.endpointCode === item.endpointCode);
                      return (
                        <tr key={idx}>
                          <td><code>{item.endpointCode}</code></td>
                          <td>{item.name}</td>
                          <td>{item.sourceSystem || 'integration-service'}</td>
                          <td>
                            {exists ? (
                              <span className="ds-status-badge ds-status-badge--warning">{t('page.webhooks.existsAlready')}</span>
                            ) : (
                              <span className="ds-status-badge ds-status-badge--success">{t('page.webhooks.newItem')}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--neutral-text)', marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={overwriteExistingOnImport}
                  onChange={(e) => setOverwriteExistingOnImport(e.target.checked)}
                />
                <span>{t('page.webhooks.overwriteExisting')}</span>
              </label>
            </div>

            <div className="ds-modal__actions">
              <button className="ds-btn ds-btn--ghost" onClick={() => setImportModalEndpoints(null)}>
                {t('common.cancel')}
              </button>
              <button className="ds-btn ds-btn--primary" onClick={() => void confirmImport()}>
                {t('page.webhooks.confirmImport').replace('{n}', String(importModalEndpoints.length))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Endpoint Details */}
      {selectedEndpointModal && (
        <div
          className="ds-modal"
          onClick={() => setSelectedEndpointModal(null)}
        >
          <div
            className="ds-modal__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ds-modal__header">
              <h2>{t('page.webhooks.endpointDetailTitle').replace('{code}', selectedEndpointModal.endpointCode)}</h2>
              <button
                className="ds-btn ds-btn--icon"
                onClick={() => setSelectedEndpointModal(null)}
                aria-label={t('common.close')}
              >✕</button>
            </div>

            <div className="ds-modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.85rem', color: 'var(--neutral-text)' }}>
              <div>
                <strong>HTTP Intake URL (POST):</strong>
                <pre className="wh-json-preview" style={{ marginTop: '0.35rem' }}>
                  {`${window.location.origin}/v1/intake/${selectedEndpointModal.endpointCode}`}
                </pre>
              </div>

              <div>
                <strong>{t('page.webhooks.curlExampleLabel')}</strong>
                <pre className="wh-json-preview" style={{ marginTop: '0.35rem', whiteSpace: 'pre-wrap' }}>
{`curl -X POST "${window.location.origin}/v1/intake/${selectedEndpointModal.endpointCode}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "request_id": "REQ-1001",
    "hn": "HN-998877",
    "patient_name": "สมชาย ใจดี"
  }'`}
                </pre>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div><strong>{t('page.webhooks.sourceLabelColon')}</strong> {selectedEndpointModal.sourceSystem}</div>
                <div><strong>{t('page.webhooks.authLabelColon')}</strong> {selectedEndpointModal.authMode}</div>
                <div><strong>{t('page.webhooks.statusLabelColon')}</strong> {selectedEndpointModal.enabled
                  ? <span className="ds-status-badge ds-status-badge--active">{t('page.webhooks.statusEnabled')}</span>
                  : <span className="ds-status-badge ds-status-badge--draft">{t('page.webhooks.statusDraft')}</span>}</div>
                <div><strong>Callback:</strong> {selectedEndpointModal.callbackTransport}</div>
              </div>

              {selectedEndpointModal.callbackUrl && (
                <div><strong>Callback Target URL:</strong> {selectedEndpointModal.callbackUrl}</div>
              )}
              {selectedEndpointModal.callbackNatsSubject && (
                <div><strong>NATS Subject:</strong> {selectedEndpointModal.callbackNatsSubject}</div>
              )}
            </div>

            <div className="ds-modal__actions">
              <button
                className="ds-btn ds-btn--ghost"
                onClick={() => void testCallback(selectedEndpointModal)}
              >
                ▷ {t('page.webhooks.testCallbackTitle')}
              </button>
              <button
                className="ds-btn ds-btn--primary"
                onClick={() => setSelectedEndpointModal(null)}
              >
                {t('page.webhooks.ok')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Confirm Delete Endpoint */}
      {pendingDeleteEndpoint && (
        <div className="ds-modal" role="dialog" aria-modal="true" onClick={() => setPendingDeleteEndpoint(null)}>
          <div className="ds-modal__panel ds-modal__panel--sm" onClick={(e) => e.stopPropagation()}>
            <div className="ds-modal__header">
              <h2>{t('page.webhooks.deleteTitle')}</h2>
              <button className="ds-btn ds-btn--icon" onClick={() => setPendingDeleteEndpoint(null)} aria-label={t('common.close')}>✕</button>
            </div>
            <div className="ds-confirm__body">
              <p>{t('page.webhooks.confirmDeleteBody')}</p>
              <code>{pendingDeleteEndpoint.endpointCode}</code>
            </div>
            <div className="ds-modal__actions">
              <button className="ds-btn ds-btn--ghost" onClick={() => setPendingDeleteEndpoint(null)}>{t('common.cancel')}</button>
              <button className="ds-btn ds-btn--danger" onClick={() => void confirmDeleteEndpoint()}>🗑 {t('page.webhooks.deleteTitle')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

