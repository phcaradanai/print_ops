import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Printer {
  id: string;
  code: string;
  name: string;
  location?: string;
  protocol: string;
  connectionUri: string;
  isActive: boolean;
  status?: { code: string; checkedAt: string };
  capabilities?: {
    colorSupported: boolean;
    duplexSupported: boolean;
    maxPageWidth: number;
    maxPageHeight: number;
    maxCopies: number;
  };
  allowedTemplates?: string[];
  maxCopiesPerJob?: number;
}
interface Template {
  id: string;
  templateCode: string;
  name: string;
  engine: string;
  status: string;
  paperProfileId?: string;
}
interface Paper {
  id: string;
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
  orientation: 'portrait' | 'landscape';
}
interface Preview {
  renderedPreview: string;
  renderedPrintPayload: string;
  warnings: string[];
  renderTimeMs: number;
}

const STATUS_DOT: Record<string, string> = {
  idle: '#a6e3a1', online: '#a6e3a1', busy: '#fab387',
  offline: '#f38ba8', error: '#f38ba8', unknown: '#9399b2',
};

const DEFAULT_PAYLOAD = '{"label":"Test Label","barcode":"ABC123","hn_masked":"HN***"}';

// ---- shared styles (consistent with PaperProfiles page) ----
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.6rem', border: '1px solid #d1d5db',
  borderRadius: 6, font: 'inherit', fontSize: '0.85rem',
};
const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem',
  fontWeight: 600, color: '#374151',
};
const sectionStyle: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '0.85rem 0' };
const sectionLastStyle: React.CSSProperties = { padding: '0.85rem 0' };
const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.8rem', fontWeight: 700, color: '#1e1e2e',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem',
};
const primaryBtn: React.CSSProperties = {
  padding: '0.6rem 1.2rem', border: 0, borderRadius: 6, background: '#1e1e2e',
  color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
};
const secondaryBtn: React.CSSProperties = {
  padding: '0.6rem 1.2rem', border: '1px solid #d1d5db', borderRadius: 6,
  background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
};
const fieldBtn: React.CSSProperties = {
  padding: '0.45rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 6,
  background: '#fff', cursor: 'pointer', fontSize: '0.8rem', flex: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
};
const activeFieldBtn: React.CSSProperties = {
  background: '#1e1e2e', color: '#fff', borderColor: '#1e1e2e',
};
const cardStyle: React.CSSProperties = {
  background: '#fff', padding: '0 1.25rem', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

export default function TemplateSandbox() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);

  const [templateId, setTemplateId] = useState('');
  const [paperProfileId, setPaperProfileId] = useState('');
  const [printerId, setPrinterId] = useState('');
  const [payload, setPayload] = useState(DEFAULT_PAYLOAD);

  // Print options
  const [copies, setCopies] = useState(1);
  const [duplex, setDuplex] = useState(false);
  const [colorMode, setColorMode] = useState<'auto' | 'color' | 'monochrome'>('auto');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState({ init: true, render: false, print: false });
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // ---- load reference data ----
  useEffect(() => {
    void Promise.all([
      apiFetch<Template[]>('/v1/sandbox/templates').then(setTemplates).catch(() => {}),
      apiFetch<Paper[]>('/v1/paper-profiles').then(setPapers).catch(() => {}),
      apiFetch<Printer[]>('/printers').then(setPrinters).catch(() => {}),
    ]).finally(() => setLoading((s) => ({ ...s, init: false })));
  }, []);

  // ---- auto-select default paper when template changes ----
  const selectedTemplate = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId]);
  const selectedPrinter = useMemo(() => printers.find((p) => p.id === printerId), [printers, printerId]);

  useEffect(() => {
    if (selectedTemplate?.paperProfileId) setPaperProfileId(selectedTemplate.paperProfileId);
  }, [selectedTemplate]);

  // ---- toast auto-dismiss ----
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- JSON validation ----
  const payloadError = useMemo(() => {
    try { JSON.parse(payload); return ''; } catch { return 'JSON ไม่ถูกต้อง — ตรวจสอบรูปแบบอีกครั้ง'; }
  }, [payload]);

  const printerMaxCopies = selectedPrinter?.maxCopiesPerJob ?? selectedPrinter?.capabilities?.maxCopies;
  const copiesExceeded = printerMaxCopies != null && copies > printerMaxCopies;
  const templateAllowed = !selectedPrinter?.allowedTemplates || selectedPrinter.allowedTemplates.length === 0 || !selectedTemplate || selectedPrinter.allowedTemplates.includes(selectedTemplate.templateCode);
  const canPrint = !!printerId && !!templateId && !payloadError && !copiesExceeded && templateAllowed;

  // ---- actions ----
  async function renderPreview() {
    setError('');
    if (!templateId) { setError('กรุณาเลือก Template ก่อน'); return; }
    if (payloadError) { setError(payloadError); return; }
    setLoading((s) => ({ ...s, render: true }));
    try {
      const res = await apiFetch<Preview>('/v1/sandbox/render-preview', {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          paperProfileId: paperProfileId || undefined,
          samplePayload: JSON.parse(payload) as Record<string, unknown>,
        }),
      });
      setPreview(res);
    } catch {
      setError('Render ไม่สำเร็จ — ตรวจสอบ Template และ Payload');
    } finally {
      setLoading((s) => ({ ...s, render: false }));
    }
  }

  async function testPrint() {
    setError('');
    if (!canPrint) { setError('กรุณาเลือก Printer และ Template ให้ครบ'); return; }
    setLoading((s) => ({ ...s, print: true }));
    try {
      const res = await apiFetch<{ accepted: boolean; jobId: string; traceId: string; status: string; warnings: string[] }>('/v1/sandbox/test-print', {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          paperProfileId: paperProfileId || undefined,
          printerId,
          printerCode: selectedPrinter?.code,
          copies,
          duplex,
          colorMode,
          priority,
          samplePayload: JSON.parse(payload) as Record<string, unknown>,
        }),
      });
      if (res.status === 'SUCCESS') {
        setToast({ type: 'success', msg: `✅ พิมพ์สำเร็จ! Job ID: ${res.jobId.slice(0, 8)}… (${copies} ชุด ที่ "${selectedPrinter?.name}")` });
      } else {
        setToast({ type: 'error', msg: `❌ พิมพ์ล้มเหลว (สถานะ: ${res.status}) — ตรวจสอบเครื่องพิมพ์` });
      }
    } catch {
      setToast({ type: 'error', msg: '❌ ส่งคำสั่งพิมพ์ไม่สำเร็จ — ลองอีกครั้ง' });
    } finally {
      setLoading((s) => ({ ...s, print: false }));
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>🖨️ Template Sandbox</h1>
      <p style={{ color: '#6b7280', marginBottom: '1rem', fontSize: '0.9rem' }}>
        เลือกเครื่องพิมพ์ ทดลองพิมพ์ และดูตัวอย่างจาก Template — เหมือนหน้าต่างควบคุมก่อนสั่งพิมพ์จริง
      </p>

      {/* ===== Toast ===== */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 2000,
          padding: '0.7rem 1rem', borderRadius: 8,
          background: toast.type === 'success' ? '#dcfce7' : '#fee2e2',
          color: toast.type === 'success' ? '#166534' : '#991b1b',
          fontWeight: 600, fontSize: '0.85rem', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
          {toast.msg}
        </div>
      )}

      {loading.init ? (
        <p style={{ color: '#888' }}>กำลังโหลดข้อมูล…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1rem', alignItems: 'start' }}>
          {/* ===================== Config Panel ===================== */}
          <section style={cardStyle}>
            {/* --- Printer --- */}
            <div style={{ ...sectionStyle, paddingTop: '1.1rem' }}>
              <div style={sectionTitleStyle}>🖨️ Printer</div>
              <label style={labelStyle}>เลือกเครื่องพิมพ์ *</label>
              <select style={inputStyle} value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
                <option value="">— เลือกเครื่องพิมพ์ —</option>
                {printers.filter((p) => p.isActive).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code}){p.location ? ` · ${p.location}` : ''}
                    {p.status ? ` · ${p.status.code}` : ''}
                  </option>
                ))}
              </select>
              {selectedPrinter && (
                <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {selectedPrinter.status && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: '#f3f4f6', borderRadius: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[selectedPrinter.status.code] ?? '#ccc', display: 'inline-block' }} />
                      {selectedPrinter.status.code}
                    </span>
                  )}
                  <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: '#f3f4f6', borderRadius: 4 }}>{selectedPrinter.protocol}</span>
                  {selectedPrinter.capabilities?.duplexSupported && <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: '#f3f4f6', borderRadius: 4 }}>Duplex</span>}
                  {selectedPrinter.capabilities?.colorSupported && <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: '#f3f4f6', borderRadius: 4 }}>Color</span>}
                  {printerMaxCopies != null && <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: '#f3f4f6', borderRadius: 4 }}>Max {printerMaxCopies} ชุด</span>}
                </div>
              )}
              {!templateAllowed && (
                <div style={{ marginTop: '0.4rem', padding: '0.4rem 0.55rem', background: '#fef3c7', color: '#92400e', borderRadius: 4, fontSize: '0.75rem' }}>
                  ⚠️ Template "{selectedTemplate?.templateCode}" ไม่อยู่ในรายการที่อนุญาตของเครื่องพิมพ์นี้
                </div>
              )}
            </div>

            {/* --- Template & Paper --- */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>📄 Template & Paper</div>
              <div style={{ marginBottom: '0.5rem' }}>
                <label style={labelStyle}>Template *</label>
                <select style={inputStyle} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">— เลือก Template —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.templateCode} — {t.name}</option>
                  ))}
                </select>
                {selectedTemplate && (
                  <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: '#f3f4f6', borderRadius: 4 }}>{selectedTemplate.engine}</span>
                    <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: '#f3f4f6', borderRadius: 4 }}>{selectedTemplate.status}</span>
                  </div>
                )}
              </div>
              <div>
                <label style={labelStyle}>Paper Profile</label>
                <select style={inputStyle} value={paperProfileId} onChange={(e) => setPaperProfileId(e.target.value)}>
                  <option value="">Default (จาก Template)</option>
                  {papers.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} ({p.widthMm}×{p.heightMm}mm, {p.dpi}dpi)</option>
                  ))}
                </select>
              </div>
            </div>

            {/* --- Print Options --- */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>⚙️ Print Options</div>

              {/* Copies */}
              <div style={{ marginBottom: '0.6rem' }}>
                <label style={labelStyle}>Copies (จำนวนชุด)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <button
                    type="button"
                    style={{ ...secondaryBtn, padding: '0.35rem 0.7rem', fontSize: '0.9rem', minWidth: 34 }}
                    onClick={() => setCopies(Math.max(1, copies - 1))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    style={{ ...inputStyle, width: 64, textAlign: 'center' }}
                    value={copies}
                    onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
                  />
                  <button
                    type="button"
                    style={{ ...secondaryBtn, padding: '0.35rem 0.7rem', fontSize: '0.9rem', minWidth: 34 }}
                    onClick={() => setCopies(copies + 1)}
                  >
                    +
                  </button>
                </div>
                {copiesExceeded && (
                  <div style={{ marginTop: '0.3rem', padding: '0.35rem 0.5rem', background: '#fee2e2', color: '#991b1b', borderRadius: 4, fontSize: '0.72rem' }}>
                    เกินจำนวนสูงสุดของเครื่องพิมพ์ (สูงสุด {printerMaxCopies} ชุด)
                  </div>
                )}
              </div>

              {/* Duplex */}
              <div style={{ marginBottom: '0.6rem' }}>
                <label style={labelStyle}>Duplex (พิมพ์สองหน้า)</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button type="button" style={{ ...fieldBtn, ...(!duplex ? activeFieldBtn : {}) }} onClick={() => setDuplex(false)}>
                    ▯ หน้าเดียว
                  </button>
                  <button
                    type="button"
                    style={{ ...fieldBtn, ...(duplex ? activeFieldBtn : {}), ...(!selectedPrinter?.capabilities?.duplexSupported ? { opacity: 0.4 } : {}) }}
                    onClick={() => selectedPrinter?.capabilities?.duplexSupported && setDuplex(true)}
                  >
                    ⇄ สองหน้า
                  </button>
                </div>
              </div>

              {/* Color Mode */}
              <div style={{ marginBottom: '0.6rem' }}>
                <label style={labelStyle}>Color Mode</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {(['auto', 'color', 'monochrome'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      style={{ ...fieldBtn, ...(colorMode === m ? activeFieldBtn : {}) }}
                      onClick={() => setColorMode(m)}
                    >
                      {m === 'auto' ? 'Auto' : m === 'color' ? '🎨 สี' : '⚪ ขาวดำ'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Priority */}
              <div>
                <label style={labelStyle}>Priority</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {(['low', 'normal', 'high', 'urgent'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      style={{ ...fieldBtn, ...(priority === p ? activeFieldBtn : {}) }}
                      onClick={() => setPriority(p)}
                    >
                      {p === 'urgent' ? '🔴' : p === 'high' ? '🟠' : p === 'normal' ? '🟢' : '⚪'} {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* --- Payload --- */}
            <div style={sectionLastStyle}>
              <div style={sectionTitleStyle}>📦 Sample Payload (JSON)</div>
              <textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={6}
                style={{
                  ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.78rem', resize: 'vertical',
                  ...(payloadError ? { borderColor: '#f38ba8', background: '#fef2f2' } : {}),
                }}
              />
              {payloadError && (
                <div style={{ marginTop: '0.3rem', color: '#f38ba8', fontSize: '0.72rem' }}>{payloadError}</div>
              )}
            </div>

            {/* --- Actions --- */}
            {error && (
              <div style={{ padding: '0.55rem 0.7rem', background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: '0.8rem', marginBottom: '0.6rem' }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', paddingBottom: '1.1rem' }}>
              <button style={primaryBtn} onClick={() => void renderPreview()} disabled={loading.render}>
                {loading.render ? '⏳ Rendering…' : '👁️ Render Preview'}
              </button>
              <button
                style={{ ...primaryBtn, ...(canPrint && !loading.print ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }}
                onClick={() => void testPrint()}
                disabled={!canPrint || loading.print}
              >
                {loading.print ? '⏳ กำลังส่ง…' : '📤 สั่งพิมพ์ทดสอบ'}
              </button>
            </div>
          </section>

          {/* ===================== Preview Panel ===================== */}
          <section style={{ ...cardStyle, padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ fontSize: '1rem', margin: 0 }}>👁️ Preview</h2>
              {preview && (
                <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>render {preview.renderTimeMs}ms</span>
              )}
            </div>

            {!preview ? (
              <div style={{
                minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: '#f9fafb', borderRadius: 8, color: '#9ca3af', textAlign: 'center', padding: '2rem',
              }}>
                <span style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🖨️</span>
                <p style={{ fontSize: '0.85rem' }}>เลือก Template และกด <strong>Render Preview</strong> เพื่อดูตัวอย่าง</p>
              </div>
            ) : (
              <>
                {/* Preview canvas */}
                <div style={{
                  background: '#f9fafb', borderRadius: 8, padding: '1rem', minHeight: 200,
                  display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'auto',
                }}>
                  <div dangerouslySetInnerHTML={{ __html: preview.renderedPreview }} />
                </div>

                {/* Warnings */}
                {preview.warnings.length > 0 && (
                  <div style={{ marginTop: '0.6rem', padding: '0.55rem 0.7rem', background: '#fef3c7', color: '#92400e', borderRadius: 6, fontSize: '0.78rem' }}>
                    <strong>⚠️ Warnings:</strong>
                    <ul style={{ margin: '0.3rem 0 0 1rem', padding: 0 }}>
                      {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                {/* Generated payload */}
                <div style={{ marginTop: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e1e2e', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
                      📋 Generated Print Payload
                    </h3>
                    <button
                      type="button"
                      style={{ ...secondaryBtn, padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
                      onClick={() => navigator.clipboard.writeText(preview.renderedPrintPayload)}
                    >
                      📋 Copy
                    </button>
                  </div>
                  <pre style={{
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 240, overflow: 'auto',
                    margin: 0, padding: '0.7rem', background: '#1e1e2e', color: '#cdd6f4', borderRadius: 6,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '0.75rem',
                  }}>
                    {preview.renderedPrintPayload}
                  </pre>
                </div>
              </>
            )}

            {/* Print summary */}
            {(selectedPrinter || selectedTemplate) && (
              <div style={{ marginTop: '0.8rem', padding: '0.6rem 0.75rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, fontSize: '0.78rem', color: '#075985' }}>
                <strong>สรุปคำสั่งพิมพ์:</strong>{' '}
                {selectedPrinter?.name ?? '— ยังไม่เลือกเครื่องพิมพ์'}
                {' · '}
                {copies} ชุด
                {' · '}
                {duplex ? 'สองหน้า' : 'หน้าเดียว'}
                {' · '}
                {colorMode === 'color' ? 'สี' : colorMode === 'monochrome' ? 'ขาวดำ' : 'Auto'}
                {' · '}
                {priority}
                {selectedTemplate && ` · ${selectedTemplate.templateCode}`}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}