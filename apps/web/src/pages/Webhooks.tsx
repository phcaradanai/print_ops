import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { saveOrDownloadJsonFile } from '../utils/fileExport.js';
import { parseWebhookImportJson } from '../features/webhooks/parseImportJson.js';
import { TransferIcon } from '../components/TransferIcon.js';
import { ActionIcon } from '../components/ActionIcon.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  CodeBlock,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  EmptyState,
  ErrorBanner,
  Fact,
  FactList,
  FormField,
  Freshness,
  Heading,
  IconButton,
  Inline,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  SectionHeading,
  Select,
  Stack,
  Tab,
  TableEmpty,
  TabList,
  Text,
  Textarea,
  Toolbar,
} from '../components/ui/index.js';

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
    <PageLayout className="wh-container" width="full" header={
      <div className="wh-header">
        <div className="wh-header-title-area">
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

        <Toolbar label={t('page.webhooks.title')} align="end" className="wh-header-actions">
          <Button variant="ghost" onClick={() => handleExportJSON()} title={t('page.webhooks.exportTitle')}>
            <TransferIcon action="export" /> {t('page.webhooks.export')}
          </Button>
          <Button variant="ghost" onClick={() => fileInputRef.current?.click()} title={t('page.webhooks.importTitle')}>
            <TransferIcon action="import" /> {t('page.webhooks.import')}
          </Button>

          {/* The shared input group owns the affix slots, so the search icon and
              the shortcut hint no longer need three page-local classes and a
              hand-placed absolute position. */}
          <Input
            aria-label={t('page.webhooks.searchPlaceholder')}
            ref={searchInputRef}
            type="search"
            placeholder={t('page.webhooks.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leading={<ActionIcon name="search" />}
            trailing={<Text size="label" tone="muted" nowrap>Ctrl + K</Text>}
          />

          <Button onClick={scrollToFormAndFocus}>{t('page.webhooks.create')}</Button>
        </Toolbar>
      </div>
    }>
      {/* Hidden File Input for Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Was a page-local toast with its own colours and a close button that no
          screen reader announced. `Alert` is assertive for errors and polite for
          confirmations, which is the behaviour this page always wanted. */}
      {toast && (
        <Alert
          tone={toast.type === 'error' ? 'error' : toast.type === 'info' ? 'info' : 'success'}
          onDismiss={() => setToast(null)}
          dismissLabel={t('common.close')}
        >
          {toast.message}
        </Alert>
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

      {/* Bulk Selection Action Bar */}
      {selectedIds.length > 0 && (
        <div className="wh-bulk-bar">
          <Inline gap="xs">
            <ActionIcon name="check" />
            <Text weight="semibold">
              {t('page.webhooks.selectCount').replace('{n}', String(selectedIds.length))}
            </Text>
          </Inline>
          <Inline gap="sm">
            <Button variant="ghost" onClick={() => handleExportJSON(endpoints.filter((e) => selectedIds.includes(e.id)))}>
              <TransferIcon action="export" /> {t('page.webhooks.exportSelected')}
            </Button>
            <Button variant="danger" onClick={() => void handleBatchDelete()}>
              <ActionIcon name="delete" /> {t('page.webhooks.deleteSelected').replace('{n}', String(selectedIds.length))}
            </Button>
            <Button variant="ghost" onClick={() => setSelectedIds([])}>
              {t('page.webhooks.clearSelection')}
            </Button>
          </Inline>
        </div>
      )}

      {/* Main Card 1: Form Section */}
      <Card ref={formCardRef}>
        <div className="wh-card-title">
          <span>{editingId ? t('page.webhooks.editingTitle').replace('{code}', form.endpointCode) : t('page.webhooks.createCardTitle')}</span>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>
              <ActionIcon name="close" /> {t('page.webhooks.cancelEdit')}
            </Button>
          )}
        </div>

        <div className="wh-form-layout">
          {/* Left Column: Form Fields */}
          <div className="wh-form-main">
            {/* 1. Basic Info */}
            <SectionHeading level={3} title={t('page.webhooks.basicInfo')} />
            {/* Each field was a hand-built `wh-field` stack: a `<label>` with no
                `htmlFor`, a duplicate `aria-label` compensating for it, and a
                loose hint span nothing pointed at. `FormField` generates the ids
                and wires `htmlFor` + `aria-describedby` so that cannot drift. */}
            <div className="wh-grid-4">
              <FormField
                label={t('page.webhooks.endpointCode')}
                hint={t('page.webhooks.endpointCodeHint')}
                required
                requiredLabel={t('common.required')}
              >
                {(control) => (
                  <Input
                    {...control}
                    ref={endpointCodeInputRef}
                    placeholder={t('page.webhooks.endpointCodePlaceholder')}
                    value={form.endpointCode}
                    disabled={!!editingId}
                    onChange={(e) => setForm({ ...form, endpointCode: e.target.value })}
                  />
                )}
              </FormField>

              <FormField
                label={t('page.webhooks.name')}
                hint={t('page.webhooks.nameHint')}
                required
                requiredLabel={t('common.required')}
              >
                {(control) => (
                  <Input
                    {...control}
                    placeholder={t('page.webhooks.namePlaceholder')}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                )}
              </FormField>

              <FormField label={t('page.webhooks.source')} hint={t('page.webhooks.sourceHint')}>
                {(control) => (
                  <>
                    <Input
                      {...control}
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
                  </>
                )}
              </FormField>

              <FormField label={t('page.webhooks.authPolicyLabel')} hint={t('page.webhooks.authPolicyHint')}>
                {(control) => (
                  <Select
                    {...control}
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
                  </Select>
                )}
              </FormField>
            </div>

            {/* 2. Callback Section */}
            <SectionHeading level={3} title={t('page.webhooks.callback')} />
            <div className="wh-grid-3">
              <FormField label={t('page.webhooks.callbackModeLabel')} hint={t('page.webhooks.callbackModeHint')}>
                {(control) => (
                  <Select
                    {...control}
                    value={form.callbackTransport}
                    onChange={(e) =>
                      setForm({ ...form, callbackTransport: e.target.value as Endpoint['callbackTransport'] })
                    }
                  >
                    <option value="NONE">{t('page.webhooks.transport.none')}</option>
                    <option value="HTTP">HTTP</option>
                    <option value="NATS">NATS</option>
                    <option value="BOTH">BOTH (HTTP + NATS)</option>
                  </Select>
                )}
              </FormField>

              <FormField label="Callback URL" hint={t('page.webhooks.callbackUrlHint')}>
                {(control) => (
                  <Input
                    {...control}
                    type="url"
                    placeholder="https://example.com/webhook"
                    value={form.callbackUrl}
                    disabled={form.callbackTransport === 'NONE' || form.callbackTransport === 'NATS'}
                    onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })}
                  />
                )}
              </FormField>

              <FormField label={t('page.webhooks.natsSubjectLabel')} hint={t('page.webhooks.natsSubjectHint')}>
                {(control) => (
                  <Input
                    {...control}
                    placeholder={t('page.webhooks.natsSubjectPlaceholder')}
                    value={form.callbackNatsSubject}
                    disabled={form.callbackTransport === 'NONE' || form.callbackTransport === 'HTTP'}
                    onChange={(e) => setForm({ ...form, callbackNatsSubject: e.target.value })}
                  />
                )}
              </FormField>
            </div>

            {/* 3. JSON Payload Template Editor */}
            <Stack gap="sm" className="wh-template-block">
              <FormField
                label={t('page.webhooks.payloadTemplate')}
                /* The template shapes the ACCEPTANCE callback only. Terminal
                   result callbacks use a fixed, versioned envelope so every
                   receiver can rely on the same schema — say so here rather than
                   letting an operator configure a template that is then silently
                   ignored the moment they enable result callbacks. */
                hint={form.callbackOnPrintResult ? t('page.webhooks.payloadTemplateIgnoredOnResult') : undefined}
              >
                {(control) => (
                  <div className="wh-template-grid">
                    {/* The line-number gutter is real editing affordance, so it
                        stays; the editing surface itself is now the shared
                        control, which carries focus, invalid and touch sizing. */}
                    <div className="wh-code-editor">
                      <div className="wh-line-numbers" aria-hidden="true">
                        {lineNumbers.map((num) => (
                          <div key={num}>{num}</div>
                        ))}
                      </div>
                      <Textarea
                        {...control}
                        ref={textareaRef}
                        mono
                        resize="vertical"
                        rows={7}
                        value={form.callbackPayloadTemplate}
                        onChange={(e) => setForm({ ...form, callbackPayloadTemplate: e.target.value })}
                      />
                    </div>

                    <Stack gap="sm" className="wh-toggle-box">
                      {/* This toggle used to be wired to nothing: it persisted, and
                          no dispatch code read it. Spell out what each position now
                          actually does so the difference is testable by an
                          operator, not just by a developer. */}
                      <Checkbox
                        label={t('page.webhooks.sendOnPrintDone')}
                        description={t('page.webhooks.onPrintResult')}
                        checked={form.callbackOnPrintResult}
                        onChange={(e) => setForm({ ...form, callbackOnPrintResult: e.target.checked })}
                      />
                      <Text size="label" tone="muted">
                        {form.callbackOnPrintResult
                          ? t('page.webhooks.onPrintResultOnHelp')
                          : t('page.webhooks.onPrintResultOffHelp')}
                      </Text>
                      {form.callbackOnPrintResult &&
                        (form.callbackTransport === 'NATS' || form.callbackTransport === 'BOTH') && (
                          <Text size="label" tone="warning">
                            {t('page.webhooks.natsBestEffortWarning')}
                          </Text>
                        )}
                    </Stack>
                  </div>
                )}
              </FormField>
            </Stack>

            {/* Form Buttons */}
            <Inline gap="sm" className="wh-form-actions">
              <Button variant="ghost" onClick={() => void handleSave(false)}>
                {t('page.webhooks.saveDraft')}
              </Button>
              <Button variant="secondary" onClick={() => void testCallback()}>
                {t('page.webhooks.testShort')}
              </Button>
              <Button onClick={() => void handleSave(true)}>
                {editingId ? t('page.webhooks.saveEndpoint') : t('page.webhooks.createEndpoint')}
              </Button>
            </Inline>
          </div>

          {/* Right Column: Sidebar Info Panel */}
          <div className="wh-sidebar">
            {/* Box 1: Sample Payload */}
            <Panel title={t('page.webhooks.samplePayload')} padding="lg">
              <CodeBlock label={t('page.webhooks.samplePayload')} scroll={false}>
{`{
  "event": "PRINT_COMPLETED",
  "printerId": "PRN-001",
  "jobId": "JOB-12345",
  "status": "COMPLETED",
  "timestamp": "2025-05-22T10:30:00Z"
}`}
              </CodeBlock>
            </Panel>

            {/* Box 2: Available Variables. These insert into the template, so
                they are chips — the shape the system reserves for exactly this. */}
            <Panel title={t('page.webhooks.availableVariables')} padding="lg">
              <Inline gap="xs">
                {AVAILABLE_VARIABLES.map((v) => (
                  <Chip
                    key={v}
                    title={t('page.webhooks.insertVariableTitle').replace('{v}', v.replace('$.', ''))}
                    onClick={() => insertVariableIntoTemplate(v)}
                  >
                    {v}
                  </Chip>
                ))}
              </Inline>
            </Panel>

            {/* Box 3: Usage Instructions */}
            <Panel title={t('page.webhooks.howToUse')} padding="lg">
              <ul className="wh-guide-list">
                <li className="wh-guide-item"><Text>{t('page.webhooks.guide1')}</Text></li>
                <li className="wh-guide-item"><Text>{t('page.webhooks.guide2')}</Text></li>
                <li className="wh-guide-item"><Text>{t('page.webhooks.guide3')}</Text></li>
                <li className="wh-guide-item"><Text>{t('page.webhooks.guide4')}</Text></li>
              </ul>
            </Panel>
          </div>
        </div>
      </Card>

      {/* Main Card 2: Endpoints Table List */}
      <Card>
        <div className="wh-table-header">
          <Inline gap="lg">
            <Heading level={2}>{t('page.webhooks.allEndpoints')}</Heading>

            {/* Filter Tabs */}
            <TabList label={t('page.webhooks.allEndpoints')}>
              <Tab selected={tabFilter === 'all'} count={counts.all} onClick={() => setTabFilter('all')}>
                {t('page.webhooks.tabAll')}
              </Tab>
              <Tab selected={tabFilter === 'active'} count={counts.active} onClick={() => setTabFilter('active')}>
                {t('page.webhooks.statusEnabled')}
              </Tab>
              <Tab selected={tabFilter === 'draft'} count={counts.draft} onClick={() => setTabFilter('draft')}>
                {t('page.webhooks.statusDraft')}
              </Tab>
              <Tab selected={tabFilter === 'none_callback'} count={counts.none_callback} onClick={() => setTabFilter('none_callback')}>
                {t('page.webhooks.transport.none')}
              </Tab>
            </TabList>
          </Inline>

          <Toolbar label={t('page.webhooks.allEndpoints')} className="wh-table-controls">
            <Input
              aria-label={t('page.webhooks.searchPlaceholder')}
              type="search"
              controlSize="sm"
              className="wh-shared-search"
              leading={<ActionIcon name="search" />}
              placeholder={t('page.webhooks.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Select
              aria-label={t('page.webhooks.statusAllOption')}
              controlSize="sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">{t('page.webhooks.statusAllOption')}</option>
              <option value="active">{t('page.webhooks.statusEnabled')}</option>
              <option value="draft">{t('page.webhooks.statusDraft')}</option>
              <option value="none_callback">{t('page.webhooks.transport.none')}</option>
            </Select>
            <IconButton size="sm" label={t('common.refresh')} onClick={loadData}>
              <ActionIcon name="refresh" />
            </IconButton>
          </Toolbar>
        </div>

        {/* Table Content */}
        <DataTable label={t('page.webhooks.allEndpoints')} responsive>
            <thead>
              <tr>
                <DataHead>
                  <Checkbox
                    hideLabel
                    label={t('page.webhooks.selectAllOnPage')}
                    checked={isAllPaginatedSelected}
                    onChange={toggleSelectAllPaginated}
                    disabled={paginatedEndpoints.length === 0}
                    title={t('page.webhooks.selectAllOnPage')}
                  />
                </DataHead>
                <DataHead>{t('page.webhooks.endpoint')}</DataHead>
                <DataHead>{t('page.webhooks.source')}</DataHead>
                <DataHead>{t('page.webhooks.auth')}</DataHead>
                <DataHead>{t('page.webhooks.enabled')}</DataHead>
                <DataHead>{t('page.webhooks.callback')}</DataHead>
                <DataHead>{t('page.webhooks.updatedAt')}</DataHead>
                <DataHead>{t('page.webhooks.actions')}</DataHead>
              </tr>
            </thead>
            <tbody>
              {paginatedEndpoints.length === 0 ? (
                <TableEmpty columns={8}>
                  <EmptyState title={t('page.webhooks.noResults')} />
                </TableEmpty>
              ) : (
                paginatedEndpoints.map((e) => (
                  <tr key={e.id} data-selected={selectedIds.includes(e.id) || undefined}>
                    <DataCell label={t('page.webhooks.selectAllOnPage')}>
                      <Checkbox
                        hideLabel
                        label={`${t('page.webhooks.endpoint')} ${e.endpointCode}`}
                        checked={selectedIds.includes(e.id)}
                        onChange={() => toggleSelectRow(e.id)}
                      />
                    </DataCell>
                    <DataCell label={t('page.webhooks.endpoint')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedEndpointModal(e)}
                        title={t('page.webhooks.viewIntakeUrlTitle')}
                      >
                        <Mono>{e.endpointCode}</Mono> <ActionIcon name="link" />
                      </Button>
                    </DataCell>
                    <DataCell label={t('page.webhooks.source')}>{e.sourceSystem || 'integration-service'}</DataCell>
                    <DataCell label={t('page.webhooks.auth')}><Mono>{e.authMode || 'NONE'}</Mono></DataCell>
                    <DataCell label={t('page.webhooks.enabled')}>
                      <Badge tone={e.enabled ? 'success' : 'neutral'}>
                        {e.enabled ? t('page.webhooks.statusEnabled') : t('page.webhooks.statusDraft')}
                      </Badge>
                    </DataCell>
                    <DataCell label={t('page.webhooks.callback')}>
                      <Badge tone={e.callbackTransport === 'NONE' ? 'neutral' : 'info'}>
                        {e.callbackTransport === 'NONE'
                          ? t('page.webhooks.transport.none')
                          : e.callbackTransport}
                      </Badge>
                    </DataCell>
                    <DataCell label={t('page.webhooks.updatedAt')}>
                      <Text size="label" tone="muted" nowrap>{formatDate(e.updatedAt || e.createdAt)}</Text>
                    </DataCell>
                    <DataCell label={t('page.webhooks.actions')} actions>
                      <Toolbar label={t('page.webhooks.actions')} align="end">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void testCallback(e)}
                          title={t('page.webhooks.testCallbackTitle')}
                        >
                          <ActionIcon name="play" /> {t('page.webhooks.test')}
                        </Button>
                        <IconButton
                          size="sm"
                          label={t('page.webhooks.edit')}
                          onClick={() => startEdit(e)}
                        >
                          <ActionIcon name="edit" />
                        </IconButton>
                        <IconButton
                          size="sm"
                          label={e.enabled ? t('page.webhooks.setDraftTitle') : t('page.webhooks.enableTitle')}
                          onClick={() => void toggleStatus(e)}
                        >
                          <ActionIcon name={e.enabled ? 'pause' : 'check'} />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="danger"
                          label={t('page.webhooks.deleteTitle')}
                          onClick={() => void handleDelete(e)}
                        >
                          <ActionIcon name="delete" />
                        </IconButton>
                      </Toolbar>
                    </DataCell>
                  </tr>
                ))
              )}
            </tbody>
        </DataTable>

        {/* Pagination Footer */}
        <div className="wh-pagination">
          <Text size="label" tone="muted">
            {t('page.webhooks.paginationSummary')
              .replace('{from}', String(filteredEndpoints.length === 0 ? 0 : (page - 1) * pageSize + 1))
              .replace('{to}', String(Math.min(page * pageSize, filteredEndpoints.length)))
              .replace('{total}', String(filteredEndpoints.length))}
          </Text>

          {/* The page steppers were `‹` and `›` glyphs on a bare button with no
              accessible name — the arrow was the entire label. */}
          <Inline gap="sm">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('page.jobQueue.previous')}
            </Button>
            <Text size="label" weight="semibold" nowrap>{page}</Text>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t('page.jobQueue.next')}
            </Button>

            <Select
              aria-label={t('page.webhooks.perPage').replace('{n}', String(pageSize))}
              controlSize="sm"
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
            </Select>
          </Inline>
        </div>
      </Card>

      {/* Main Card 3: Callback delivery log — real success/failure history,
          not just "we called send()". Covers both live traffic and every
          "ทดสอบ callback" fire above. */}
      <Card>
        <div className="wh-table-header">
          <Inline gap="lg">
            <Heading level={2}>{t('page.webhooks.callbackLogTitle')}</Heading>
            <Checkbox
              label={t('page.webhooks.callbackLogFailedOnly')}
              checked={callbackLogFailedOnly}
              onChange={(e) => setCallbackLogFailedOnly(e.target.checked)}
            />
          </Inline>
          <IconButton label={t('common.refresh')} onClick={loadCallbackLog} disabled={callbackLogLoading}>
            <ActionIcon name="refresh" />
          </IconButton>
        </div>
        <Text as="p" tone="muted">{t('page.webhooks.callbackLogDescription')}</Text>
        <DataTable label={t('page.webhooks.callbackLogTitle')} responsive>
            <thead>
              <tr>
                <DataHead>{t('page.webhooks.colTime')}</DataHead>
                <DataHead>{t('page.webhooks.endpoint')}</DataHead>
                <DataHead>{t('page.webhooks.colChannel')}</DataHead>
                <DataHead>{t('page.webhooks.colTrigger')}</DataHead>
                <DataHead>{t('page.webhooks.colOutcome')}</DataHead>
                <DataHead>{t('page.webhooks.colHttpStatus')}</DataHead>
                <DataHead>{t('page.webhooks.colDuration')}</DataHead>
                <DataHead>{t('page.webhooks.colDetail')}</DataHead>
              </tr>
            </thead>
            <tbody>
              {callbackLog.length === 0 ? (
                <TableEmpty columns={8}>
                  {callbackLogLoading
                    ? <LoadingState />
                    : <EmptyState title={t('page.webhooks.noCallbackHistory')} />}
                </TableEmpty>
              ) : (
                callbackLog.map((a) => (
                  <tr key={a.id}>
                    <DataCell label={t('page.webhooks.colTime')}>
                      <Text size="label" tone="muted" nowrap>{formatDate(a.occurredAt)}</Text>
                    </DataCell>
                    <DataCell label={t('page.webhooks.endpoint')}><Mono>{a.endpointCode}</Mono></DataCell>
                    <DataCell label={t('page.webhooks.colChannel')}><Badge>{a.transport}</Badge></DataCell>
                    <DataCell label={t('page.webhooks.colTrigger')}>
                      {a.trigger === 'test' ? t('page.webhooks.triggerTest') : t('page.webhooks.triggerLive')}
                    </DataCell>
                    <DataCell label={t('page.webhooks.colOutcome')}>
                      <Badge tone={a.outcome === 'success' ? 'success' : a.outcome === 'failed' ? 'danger' : 'neutral'}>
                        {a.outcome === 'success'
                          ? t('page.webhooks.outcomeSuccess')
                          : a.outcome === 'failed'
                            ? t('page.webhooks.outcomeFailed')
                            : t('page.webhooks.outcomeSkipped')}
                      </Badge>
                    </DataCell>
                    <DataCell label={t('page.webhooks.colHttpStatus')}><Mono>{a.httpStatus ?? '—'}</Mono></DataCell>
                    <DataCell label={t('page.webhooks.colDuration')}><Mono>{a.durationMs} ms</Mono></DataCell>
                    <DataCell label={t('page.webhooks.colDetail')}>
                      <Text size="label" tone="muted">{a.errorMessage || a.target || '—'}</Text>
                    </DataCell>
                  </tr>
                ))
              )}
            </tbody>
        </DataTable>
      </Card>

      {/* All three overlays were hand-rolled `ds-modal` divs: no focus trap, no
          Escape, no focus restoration, and a backdrop that closed on any click
          that reached it. The shared `Dialog` provides all of that — which
          matters most for the delete confirmation, the one that destroys an
          endpoint an integration may still be posting to. */}

      {/* Modal 1: Import Preview Confirmation */}
      <Dialog
        open={importModalEndpoints !== null}
        onClose={() => setImportModalEndpoints(null)}
        title={t('page.webhooks.importModalTitle').replace('{n}', String(importModalEndpoints?.length ?? 0))}
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportModalEndpoints(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmImport()}>
              <TransferIcon action="import" />{' '}
              {t('page.webhooks.confirmImport').replace('{n}', String(importModalEndpoints?.length ?? 0))}
            </Button>
          </>
        }
      >
        {importModalEndpoints && (
          <Stack gap="lg">
            <Text as="p" tone="muted">{t('page.webhooks.importPreviewIntro')}</Text>

            <DataTable label={t('page.webhooks.importModalTitle').replace('{n}', String(importModalEndpoints.length))} responsive>
              <thead>
                <tr>
                  <DataHead>{t('page.webhooks.colEndpointCode')}</DataHead>
                  <DataHead>{t('page.webhooks.name')}</DataHead>
                  <DataHead>{t('page.webhooks.source')}</DataHead>
                  <DataHead>{t('page.webhooks.colExistingStatus')}</DataHead>
                </tr>
              </thead>
              <tbody>
                {importModalEndpoints.map((item, idx) => {
                  const exists = endpoints.some((e) => e.endpointCode === item.endpointCode);
                  return (
                    <tr key={idx}>
                      <DataCell label={t('page.webhooks.colEndpointCode')}>
                        <Mono>{item.endpointCode}</Mono>
                      </DataCell>
                      <DataCell label={t('page.webhooks.name')}>{item.name}</DataCell>
                      <DataCell label={t('page.webhooks.source')}>
                        {item.sourceSystem || 'integration-service'}
                      </DataCell>
                      <DataCell label={t('page.webhooks.colExistingStatus')}>
                        <Badge tone={exists ? 'warning' : 'success'}>
                          {exists ? t('page.webhooks.existsAlready') : t('page.webhooks.newItem')}
                        </Badge>
                      </DataCell>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>

            <Checkbox
              label={t('page.webhooks.overwriteExisting')}
              checked={overwriteExistingOnImport}
              onChange={(e) => setOverwriteExistingOnImport(e.target.checked)}
            />
          </Stack>
        )}
      </Dialog>

      {/* Modal 2: Endpoint Details */}
      <Dialog
        open={selectedEndpointModal !== null}
        onClose={() => setSelectedEndpointModal(null)}
        title={t('page.webhooks.endpointDetailTitle').replace('{code}', selectedEndpointModal?.endpointCode ?? '')}
        footer={
          <>
            <Button variant="secondary" onClick={() => selectedEndpointModal && void testCallback(selectedEndpointModal)}>
              <ActionIcon name="play" /> {t('page.webhooks.testCallbackTitle')}
            </Button>
            <Button onClick={() => setSelectedEndpointModal(null)}>{t('page.webhooks.ok')}</Button>
          </>
        }
      >
        {selectedEndpointModal && (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="label" tone="muted">HTTP Intake URL (POST)</Text>
              <CodeBlock label="HTTP Intake URL" scroll={false}>
                {`${window.location.origin}/v1/intake/${selectedEndpointModal.endpointCode}`}
              </CodeBlock>
            </Stack>

            <Stack gap="xs">
              <Text size="label" tone="muted">{t('page.webhooks.curlExampleLabel')}</Text>
              <CodeBlock label={t('page.webhooks.curlExampleLabel')}>
{`curl -X POST "${window.location.origin}/v1/intake/${selectedEndpointModal.endpointCode}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "request_id": "REQ-1001",
    "hn": "HN-998877",
    "patient_name": "สมชาย ใจดี"
  }'`}
              </CodeBlock>
            </Stack>

            <FactList>
              <Fact label={t('page.webhooks.sourceLabelColon')}>{selectedEndpointModal.sourceSystem}</Fact>
              <Fact label={t('page.webhooks.authLabelColon')}>
                <Mono>{selectedEndpointModal.authMode}</Mono>
              </Fact>
              <Fact label={t('page.webhooks.statusLabelColon')}>
                <Badge tone={selectedEndpointModal.enabled ? 'success' : 'neutral'}>
                  {selectedEndpointModal.enabled ? t('page.webhooks.statusEnabled') : t('page.webhooks.statusDraft')}
                </Badge>
              </Fact>
              <Fact label="Callback">
                <Badge tone={selectedEndpointModal.callbackTransport === 'NONE' ? 'neutral' : 'info'}>
                  {selectedEndpointModal.callbackTransport}
                </Badge>
              </Fact>
              {selectedEndpointModal.callbackUrl && (
                <Fact label="Callback Target URL">
                  <Mono>{selectedEndpointModal.callbackUrl}</Mono>
                </Fact>
              )}
              {selectedEndpointModal.callbackNatsSubject && (
                <Fact label="NATS Subject">
                  <Mono>{selectedEndpointModal.callbackNatsSubject}</Mono>
                </Fact>
              )}
            </FactList>
          </Stack>
        )}
      </Dialog>

      {/* Modal 3: Confirm Delete Endpoint */}
      <Dialog
        open={pendingDeleteEndpoint !== null}
        onClose={() => setPendingDeleteEndpoint(null)}
        title={t('page.webhooks.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDeleteEndpoint(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void confirmDeleteEndpoint()}>
              <ActionIcon name="delete" /> {t('page.webhooks.deleteTitle')}
            </Button>
          </>
        }
      >
        {pendingDeleteEndpoint && (
          <Stack gap="sm">
            <Text as="p">{t('page.webhooks.confirmDeleteBody')}</Text>
            <Mono weight="semibold">{pendingDeleteEndpoint.endpointCode}</Mono>
          </Stack>
        )}
      </Dialog>
    </PageLayout>
  );
}
