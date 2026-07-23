import { useEffect, useState, useRef, useMemo } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { saveOrDownloadJsonFile } from '../utils/fileExport.js';

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

  const endpointCodeInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formCardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = () => {
    void apiFetch<Endpoint[]>('/v1/webhook-endpoints').then((res) => {
      setEndpoints(res);
      // Remove selected IDs that no longer exist
      setSelectedIds((prev) => prev.filter((id) => res.some((e) => e.id === id)));
    }).catch(() => {
      showToast('ไม่สามารถโหลดข้อมูลเอนด์พอยต์ได้', 'error');
    });
    void apiFetch<Policy[]>('/v1/webhook-route-policies').then(setPolicies).catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, []);

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
      showToast('กรุณาระบุรหัสเอนด์พอยต์', 'error');
      return;
    }
    if (!form.name.trim()) {
      showToast('กรุณาระบุชื่อเอนด์พอยต์', 'error');
      return;
    }

    let parsedPayloadTemplate: Record<string, unknown> | undefined = undefined;
    if (form.callbackPayloadTemplate.trim()) {
      try {
        parsedPayloadTemplate = JSON.parse(form.callbackPayloadTemplate);
      } catch {
        showToast('เทมเพลต Payload (JSON) มีรูปแบบไม่ถูกต้อง', 'error');
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
        showToast(isEnabled ? 'บันทึกการแก้ไขเอนด์พอยต์เรียบร้อย' : 'บันทึกแบบร่างเอนด์พอยต์เรียบร้อย');
      } else {
        await apiFetch('/v1/webhook-endpoints', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        showToast(isEnabled ? 'สร้างเอนด์พอยต์ใหม่เรียบร้อย' : 'สร้างแบบร่างเอนด์พอยต์เรียบร้อย');
      }

      resetForm();
      loadData();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
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

  async function testCallback(e?: Endpoint) {
    const targetId = e?.id || editingId;
    if (!targetId) {
      showToast('กรุณาสร้างหรือเลือกเอนด์พอยต์ก่อนการทดสอบ Callback', 'info');
      return;
    }

    try {
      showToast('กำลังทดสอบส่ง Callback...', 'info');
      const res = await apiFetch<{ ok: boolean; transport: string }>(
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
      showToast(`ทดสอบส่ง Callback สำเร็จ! (${res.transport || e?.callbackTransport || form.callbackTransport})`, 'success');
    } catch {
      showToast('ทดสอบส่ง Callback ล้มเหลว กรุณาตรวจสอบ URL หรือ NATS subject', 'error');
    }
  }

  async function toggleStatus(e: Endpoint) {
    try {
      await apiFetch(`/v1/webhook-endpoints/${e.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !e.enabled }),
      });
      showToast(`เปลี่ยนสถานะเอนด์พอยต์ "${e.endpointCode}" เป็น ${!e.enabled ? 'เปิดใช้งาน' : 'ร่าง'} เรียบร้อย`);
      loadData();
    } catch {
      showToast('ไม่สามารถเปลี่ยนสถานะเอนด์พอยต์ได้', 'error');
    }
  }

  async function handleDelete(e: Endpoint) {
    if (!confirm(`คุณต้องการลบเอนด์พอยต์ "${e.endpointCode}" ใช่หรือไม่?`)) return;
    try {
      await apiFetch(`/v1/webhook-endpoints/${e.id}`, { method: 'DELETE' });
      showToast(`ลบเอนด์พอยต์ "${e.endpointCode}" เรียบร้อยแล้ว`);
      if (editingId === e.id) resetForm();
      loadData();
    } catch {
      showToast('ไม่สามารถลบเอนด์พอยต์ได้', 'error');
    }
  }

  // --- Export Feature ---
  const handleExportJSON = async (targetEndpoints?: Endpoint[]) => {
    const listToExport = targetEndpoints || (selectedIds.length > 0
      ? endpoints.filter((e) => selectedIds.includes(e.id))
      : endpoints);

    if (listToExport.length === 0) {
      showToast('ไม่มีข้อมูลเอนด์พอยต์สำหรับส่งออก', 'info');
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
      showToast(res.message || `ส่งออกเอนด์พอยต์จำนวน ${listToExport.length} รายการเป็นไฟล์ JSON เรียบร้อยแล้ว`);
    } else {
      showToast(res.message || 'ไม่สามารถส่งออกไฟล์ได้', 'error');
    }
  };

  // --- Import Feature ---
  const handleFileChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        const importedList: Partial<Endpoint>[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.endpoints)
          ? parsed.endpoints
          : [];

        if (importedList.length === 0) {
          showToast('ไม่พบข้อมูลเอนด์พอยต์ในไฟล์ JSON ที่เลือก', 'error');
          return;
        }

        // Validate required fields
        const validList = importedList.filter((item) => item.endpointCode && item.name);
        if (validList.length === 0) {
          showToast('ไฟล์ JSON ไม่มีโครงสร้างเอนด์พอยต์ที่ถูกต้อง (ต้องมี endpointCode และ name)', 'error');
          return;
        }

        setImportModalEndpoints(validList);
      } catch {
        showToast('ไม่สามารถอ่านไฟล์ JSON ได้ กรุณาตรวจสอบรูปแบบไฟล์', 'error');
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  };

  const confirmImport = async () => {
    if (!importModalEndpoints || importModalEndpoints.length === 0) return;

    let successCount = 0;
    showToast(`กำลังนำเข้าเอนด์พอยต์ ${importModalEndpoints.length} รายการ...`, 'info');

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
      } catch {
        // Continue import loop for remaining items
      }
    }

    setImportModalEndpoints(null);
    showToast(`นำเข้าเอนด์พอยต์สำเร็จ ${successCount} จาก ${importModalEndpoints.length} รายการ`);
    loadData();
  };

  // --- Batch Delete Feature ---
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`คุณต้องการลบเอนด์พอยต์จำนวน ${selectedIds.length} รายการที่เลือกใช่หรือไม่?`)) return;

    showToast(`กำลังลบเอนด์พอยต์ ${selectedIds.length} รายการ...`, 'info');
    let deletedCount = 0;

    await Promise.all(
      selectedIds.map(async (id) => {
        try {
          await apiFetch(`/v1/webhook-endpoints/${id}`, { method: 'DELETE' });
          deletedCount++;
        } catch {
          // ignore individual delete failure
        }
      })
    );

    setSelectedIds([]);
    showToast(`ลบเอนด์พอยต์เรียบร้อยแล้ว ${deletedCount} รายการ`);
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
        <div className={`wh-toast wh-toast--${toast.type}`}>
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Page Header */}
      <header className="wh-header">
        <div className="wh-header-title-area">
          <div className="wh-header-icon">🔗</div>
          <div className="wh-header-text">
            <h1>{t('page.webhooks.title')}</h1>
            <p>จัดการเอนด์พอยต์สำหรับรับเหตุการณ์จากระบบภายนอก และจัดการการตอบกลับ (Callback)</p>
          </div>
        </div>

        <div className="wh-header-actions">
          <button className="wh-btn-outline" onClick={() => handleExportJSON()} title="ส่งออกเอนด์พอยต์เป็นไฟล์ JSON">
            📥 {t('page.webhooks.export')}
          </button>
          <button className="wh-btn-outline" onClick={() => fileInputRef.current?.click()} title="นำเข้าเอนด์พอยต์จากไฟล์ JSON">
            📤 {t('page.webhooks.import')}
          </button>

          <div className="wh-search-box">
            <span className="wh-search-icon-left">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              className="wh-search-input"
              placeholder="ค้นหาเอนด์พอยต์..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <span className="wh-search-badge">Ctrl + K</span>
          </div>

          <button className="wh-btn-primary" onClick={scrollToFormAndFocus}>
            <span>+</span> {t('page.webhooks.create')}
          </button>
        </div>
      </header>

      {/* Bulk Selection Action Bar */}
      {selectedIds.length > 0 && (
        <div className="wh-bulk-bar">
          <div>
            ✓ เลือกอยู่ <strong>{selectedIds.length}</strong> รายการ
          </div>
          <div className="wh-bulk-actions">
            <button className="wh-btn-outline" style={{ height: 34, fontSize: '0.8rem' }} onClick={() => handleExportJSON(endpoints.filter((e) => selectedIds.includes(e.id)))}>
              📥 ส่งออกรายการที่เลือก
            </button>
            <button className="wh-btn-danger" onClick={() => void handleBatchDelete()}>
              🗑️ ลบรายการที่เลือก ({selectedIds.length})
            </button>
            <button className="wh-action-btn" style={{ height: 34, fontSize: '0.8rem' }} onClick={() => setSelectedIds([])}>
              ✕ ยกเลิกการเลือก
            </button>
          </div>
        </div>
      )}

      {/* Main Card 1: Form Section */}
      <div className="wh-card" ref={formCardRef}>
        <div className="wh-card-title">
          <span>{editingId ? `แก้ไขเอนด์พอยต์ (${form.endpointCode})` : 'สร้างเอนด์พอยต์ใหม่'}</span>
          {editingId && (
            <button
              className="wh-action-btn"
              onClick={resetForm}
              style={{ fontSize: '0.8rem', fontWeight: 500 }}
            >
              ✕ ยกเลิกการแก้ไข
            </button>
          )}
        </div>

        <div className="wh-form-layout">
          {/* Left Column: Form Fields */}
          <div className="wh-form-main">
            {/* 1. Basic Info */}
            <div className="wh-form-section-title">ข้อมูลพื้นฐาน</div>
            <div className="wh-grid-4">
              <div className="wh-field">
                <label className="wh-field-label">
                  {t('page.webhooks.endpointCode')} <span className="required">*</span>
                </label>
                <input
                  ref={endpointCodeInputRef}
                  className="wh-input"
                  placeholder="เช่น dev-intake"
                  value={form.endpointCode}
                  disabled={!!editingId}
                  onChange={(e) => setForm({ ...form, endpointCode: e.target.value })}
                />
                <span className="wh-field-hint">ตัวอักษร a-z, 0-9, และ _ เท่านั้น</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">
                  {t('page.webhooks.name')} <span className="required">*</span>
                </label>
                <input
                  className="wh-input"
                  placeholder="เช่น Dev Intake"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <span className="wh-field-hint">ชื่อที่ใช้แสดงในระบบ</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">แหล่งที่มา</label>
                <input
                  className="wh-input"
                  list="source-systems-list"
                  placeholder="เลือกแหล่งที่มา"
                  value={form.sourceSystem}
                  onChange={(e) => setForm({ ...form, sourceSystem: e.target.value })}
                />
                <datalist id="source-systems-list">
                  {SOURCE_SYSTEM_PRESETS.map((sys) => (
                    <option key={sys} value={sys} />
                  ))}
                </datalist>
                <span className="wh-field-hint">บริการหรือระบบต้นทาง</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">การรับรอง / นโยบาย</label>
                <select
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
                <span className="wh-field-hint">เลือกวิธีการรับรองหรือกำหนดนโยบาย</span>
              </div>
            </div>

            {/* 2. Callback Section */}
            <div className="wh-form-section-title" style={{ marginTop: '1.25rem' }}>
              การตอบกลับ (Callback)
            </div>
            <div className="wh-grid-3">
              <div className="wh-field">
                <label className="wh-field-label">โหมด Callback</label>
                <select
                  className="wh-select"
                  value={form.callbackTransport}
                  onChange={(e) =>
                    setForm({ ...form, callbackTransport: e.target.value as Endpoint['callbackTransport'] })
                  }
                >
                  <option value="NONE">ไม่ส่ง</option>
                  <option value="HTTP">HTTP</option>
                  <option value="NATS">NATS</option>
                  <option value="BOTH">BOTH (HTTP + NATS)</option>
                </select>
                <span className="wh-field-hint">เลือกรูปแบบการตอบกลับเมื่อเกิดเหตุการณ์</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">
                  Callback URL <span>🔗</span>
                </label>
                <input
                  className="wh-input"
                  placeholder="https://example.com/webhook"
                  value={form.callbackUrl}
                  disabled={form.callbackTransport === 'NONE' || form.callbackTransport === 'NATS'}
                  onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })}
                />
                <span className="wh-field-hint">ปลายทาง HTTP สำหรับรับข้อมูล</span>
              </div>

              <div className="wh-field">
                <label className="wh-field-label">NATS reply subject (ถ้าใช้)</label>
                <input
                  className="wh-input"
                  placeholder="เช่น printer.replies.dev-intake"
                  value={form.callbackNatsSubject}
                  disabled={form.callbackTransport === 'NONE' || form.callbackTransport === 'HTTP'}
                  onChange={(e) => setForm({ ...form, callbackNatsSubject: e.target.value })}
                />
                <span className="wh-field-hint">ระบุ NATS reply subject (ถ้าใช้)</span>
              </div>
            </div>

            {/* 3. JSON Payload Template Editor */}
            <div className="wh-field" style={{ marginTop: '1rem' }}>
              <label className="wh-field-label">
                เทมเพลต Payload (JSON; ใช้ {'${.field}'} เพื่ออ้างอิงค่ากลับ)
              </label>

              <div className="wh-template-grid">
                {/* Code Editor Container */}
                <div className="wh-code-editor">
                  <div className="wh-line-numbers">
                    {lineNumbers.map((num) => (
                      <div key={num}>{num}</div>
                    ))}
                  </div>
                  <textarea
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
                    <span className="wh-toggle-label">ส่งเมื่อพิมพ์เสร็จ</span>
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
                    ส่ง Callback เมื่อการพิมพ์เสร็จสมบูรณ์
                  </span>
                </div>
              </div>
            </div>

            {/* Form Buttons */}
            <div className="wh-form-actions">
              <button className="wh-btn-draft" onClick={() => void handleSave(false)}>
                บันทึกแบบร่าง
              </button>
              <button className="wh-btn-secondary" onClick={() => void testCallback()}>
                ▷ ทดสอบ
              </button>
              <button className="wh-btn-primary" onClick={() => void handleSave(true)}>
                {editingId ? 'บันทึกเอนด์พอยต์' : '🟦 สร้างเอนด์พอยต์'}
              </button>
            </div>
          </div>

          {/* Right Column: Sidebar Info Panel */}
          <div className="wh-sidebar">
            {/* Box 1: Sample Payload */}
            <div className="wh-panel">
              <div className="wh-panel-header">
                <span>ตัวอย่าง Payload</span>
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
                <span>ตัวแปรที่ใช้งานได้</span>
              </div>
              <div className="wh-var-pills">
                {AVAILABLE_VARIABLES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="wh-var-pill"
                    title={`กดเพื่อเพิ่ม \${.${v.replace('$.', '')}} เข้าในเทมเพลต`}
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
                <span>วิธีใช้งาน</span>
              </div>
              <ul className="wh-guide-list">
                <li className="wh-guide-item">
                  <span className="wh-guide-icon">🔗</span>
                  <span>ใช้เทมเพลต JSON และอ้างอิงค่าจากเหตุการณ์ด้วยรูปแบบ {'${.field}'}</span>
                </li>
                <li className="wh-guide-item">
                  <span className="wh-guide-icon">▷</span>
                  <span>เลือก Callback Mode เป็น "ไม่ส่ง" หากไม่ต้องการส่งผลตอบกลับ</span>
                </li>
                <li className="wh-guide-item">
                  <span className="wh-guide-icon">▷</span>
                  <span>สามารถทดสอบ Callback ก่อนบันทึกได้</span>
                </li>
                <li className="wh-guide-item">
                  <span className="wh-guide-icon">▷</span>
                  <span>NATS reply subject ใช้สำหรับการตอบกลับผ่านโปรโตคอล NATS</span>
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
              เอนด์พอยต์ทั้งหมด
            </h2>

            {/* Filter Tabs */}
            <div className="wh-tabs">
              <button
                className={`wh-tab ${tabFilter === 'all' ? 'wh-tab--active' : ''}`}
                onClick={() => setTabFilter('all')}
              >
                ทั้งหมด <span className="wh-tab-badge">{counts.all}</span>
              </button>
              <button
                className={`wh-tab ${tabFilter === 'active' ? 'wh-tab--active' : ''}`}
                onClick={() => setTabFilter('active')}
              >
                เปิดใช้งาน <span className="wh-tab-badge">{counts.active}</span>
              </button>
              <button
                className={`wh-tab ${tabFilter === 'draft' ? 'wh-tab--active' : ''}`}
                onClick={() => setTabFilter('draft')}
              >
                ร่าง <span className="wh-tab-badge">{counts.draft}</span>
              </button>
              <button
                className={`wh-tab ${tabFilter === 'none_callback' ? 'wh-tab--active' : ''}`}
                onClick={() => setTabFilter('none_callback')}
              >
                ไม่ส่ง <span className="wh-tab-badge">{counts.none_callback}</span>
              </button>
            </div>
          </div>

          <div className="wh-table-controls">
            <div className="wh-search-box">
              <span className="wh-search-icon-left">🔍</span>
              <input
                type="text"
                className="wh-search-input"
                style={{ width: 190, paddingRight: '1rem' }}
                placeholder="ค้นหาเอนด์พอยต์..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="wh-select"
              style={{ height: 38 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">สถานะ: ทั้งหมด</option>
              <option value="active">เปิดใช้งาน</option>
              <option value="draft">ร่าง</option>
              <option value="none_callback">ไม่ส่ง</option>
            </select>

            <button className="wh-icon-btn" title="รีเฟรชข้อมูล" onClick={loadData}>
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
                    type="checkbox"
                    checked={isAllPaginatedSelected}
                    onChange={toggleSelectAllPaginated}
                    title="เลือกทั้งหมดในหน้านี้"
                  />
                </th>
                <th>{t('page.webhooks.endpoint')}</th>
                <th>{t('page.webhooks.source')}</th>
                <th>{t('page.webhooks.auth')}</th>
                <th>{t('page.webhooks.enabled')}</th>
                <th>{t('page.webhooks.callback')}</th>
                <th>อัปเดตล่าสุด</th>
                <th style={{ textAlign: 'right' }}>{t('page.webhooks.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEndpoints.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    ไม่พบเอนด์พอยต์ที่ค้นหา
                  </td>
                </tr>
              ) : (
                paginatedEndpoints.map((e) => (
                  <tr key={e.id} style={{ background: selectedIds.includes(e.id) ? '#eff6ff' : undefined }}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(e.id)}
                        onChange={() => toggleSelectRow(e.id)}
                      />
                    </td>
                    <td>
                      <button
                        className="wh-endpoint-link"
                        onClick={() => setSelectedEndpointModal(e)}
                        title="คลิกเพื่อดู URL Intake และตัวอย่าง cURL"
                      >
                        {e.endpointCode} <span>🔗</span>
                      </button>
                    </td>
                    <td>{e.sourceSystem || 'integration-service'}</td>
                    <td>{e.authMode || 'NONE'}</td>
                    <td>
                      {e.enabled ? (
                        <span className="wh-status-badge wh-status-badge--active">
                          🟢 เปิดใช้งาน
                        </span>
                      ) : (
                        <span className="wh-status-badge wh-status-badge--draft">
                          🟠 ร่าง
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="wh-badge-transport">
                        {e.callbackTransport === 'NONE'
                          ? 'ไม่ส่ง'
                          : e.callbackTransport}
                      </span>
                    </td>
                    <td>{formatDate(e.updatedAt || e.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem' }}>
                        <button
                          className="wh-action-btn"
                          onClick={() => void testCallback(e)}
                          title="ทดสอบส่ง Callback"
                        >
                          ▷ ทดสอบ callback
                        </button>
                        <button
                          className="wh-icon-btn"
                          onClick={() => startEdit(e)}
                          title="แก้ไข"
                        >
                          ✏️
                        </button>
                        <button
                          className="wh-icon-btn"
                          onClick={() => void toggleStatus(e)}
                          title={e.enabled ? 'เปลี่ยนเป็นแบบร่าง' : 'เปิดใช้งาน'}
                        >
                          {e.enabled ? '🛑' : '🟢'}
                        </button>
                        <button
                          className="wh-icon-btn"
                          onClick={() => void handleDelete(e)}
                          title="ลบเอนด์พอยต์"
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
            แสดง {filteredEndpoints.length === 0 ? 0 : (page - 1) * pageSize + 1} ถึง{' '}
            {Math.min(page * pageSize, filteredEndpoints.length)} จาก {filteredEndpoints.length} รายการ
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
              className="wh-select"
              style={{ height: 32, padding: '0 0.5rem', fontSize: '0.8rem', marginLeft: '0.5rem' }}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={5}>5 / หน้า</option>
              <option value={10}>10 / หน้า</option>
              <option value={20}>20 / หน้า</option>
              <option value={50}>50 / หน้า</option>
            </select>
          </div>
        </div>
      </div>

      {/* Modal 1: Import Preview Confirmation */}
      {importModalEndpoints && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={() => setImportModalEndpoints(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              maxWidth: 600,
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>
                📤 นำเข้าเอนด์พอยต์ ({importModalEndpoints.length} รายการ)
              </h3>
              <button
                onClick={() => setImportModalEndpoints(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 1rem' }}>
              พบข้อมูลเอนด์พอยต์ในไฟล์ JSON ดังนี้ กรุณาตรวจสอบก่อนยืนยันการนำเข้าเข้าสู่ระบบ:
            </p>

            <div
              style={{
                maxHeight: 240,
                overflowY: 'auto',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                marginBottom: '1rem',
              }}
            >
              <table className="wh-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>รหัสเอนด์พอยต์</th>
                    <th>ชื่อ</th>
                    <th>แหล่งที่มา</th>
                    <th>สถานะเดิมในระบบ</th>
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
                            <span style={{ color: '#b45309', fontWeight: 600 }}>⚠️ มีอยู่แล้ว (จะอัปเดต)</span>
                          ) : (
                            <span style={{ color: '#15803d', fontWeight: 600 }}>✨ รายการใหม่</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#334155', marginBottom: '1.25rem' }}>
              <input
                type="checkbox"
                checked={overwriteExistingOnImport}
                onChange={(e) => setOverwriteExistingOnImport(e.target.checked)}
              />
              <span>เขียนทับเอนด์พอยต์ที่มีอยู่แล้วในระบบ</span>
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="wh-btn-outline" onClick={() => setImportModalEndpoints(null)}>
                ยกเลิก
              </button>
              <button className="wh-btn-primary" onClick={() => void confirmImport()}>
                ยืนยันการนำเข้า ({importModalEndpoints.length} รายการ)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Endpoint Details / Intake Test Modal */}
      {selectedEndpointModal && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={() => setSelectedEndpointModal(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              maxWidth: 580,
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>
                🔗 เอนด์พอยต์: {selectedEndpointModal.endpointCode}
              </h3>
              <button
                onClick={() => setSelectedEndpointModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.85rem', color: '#334155' }}>
              <div>
                <strong>HTTP Intake URL (POST):</strong>
                <pre className="wh-json-preview" style={{ marginTop: '0.35rem' }}>
                  {`${window.location.origin}/v1/intake/${selectedEndpointModal.endpointCode}`}
                </pre>
              </div>

              <div>
                <strong>ตัวอย่าง cURL command:</strong>
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
                <div><strong>แหล่งที่มา:</strong> {selectedEndpointModal.sourceSystem}</div>
                <div><strong>การรับรอง:</strong> {selectedEndpointModal.authMode}</div>
                <div><strong>สถานะ:</strong> {selectedEndpointModal.enabled ? '🟢 เปิดใช้งาน' : '🟠 ร่าง'}</div>
                <div><strong>Callback:</strong> {selectedEndpointModal.callbackTransport}</div>
              </div>

              {selectedEndpointModal.callbackUrl && (
                <div><strong>Callback Target URL:</strong> {selectedEndpointModal.callbackUrl}</div>
              )}
              {selectedEndpointModal.callbackNatsSubject && (
                <div><strong>NATS Subject:</strong> {selectedEndpointModal.callbackNatsSubject}</div>
              )}
            </div>

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                className="wh-btn-secondary"
                onClick={() => void testCallback(selectedEndpointModal)}
              >
                ▷ ทดสอบส่ง Callback
              </button>
              <button
                className="wh-btn-primary"
                onClick={() => setSelectedEndpointModal(null)}
              >
                ตกลง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

