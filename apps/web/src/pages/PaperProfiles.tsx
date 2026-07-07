import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface PaperProfile {
  id: string;
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  dpi: number;
  orientation: 'portrait' | 'landscape';
  unit: 'mm' | 'inch';
}

interface PaperForm {
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  dpi: number;
  orientation: 'portrait' | 'landscape';
  unit: 'mm' | 'inch';
}

const DEFAULT_FORM: PaperForm = {
  code: '',
  name: '',
  widthMm: 100,
  heightMm: 50,
  marginTopMm: 2,
  marginRightMm: 2,
  marginBottomMm: 2,
  marginLeftMm: 2,
  dpi: 203,
  orientation: 'portrait',
  unit: 'mm',
};

// Common paper / label presets in mm
const PAPER_PRESETS: { label: string; widthMm: number; heightMm: number; dpi: number }[] = [
  { label: 'A4 (210 × 297 mm)', widthMm: 210, heightMm: 297, dpi: 300 },
  { label: 'A5 (148 × 210 mm)', widthMm: 148, heightMm: 210, dpi: 300 },
  { label: 'Letter (216 × 279 mm)', widthMm: 216, heightMm: 279, dpi: 300 },
  { label: 'Label 100 × 50 mm', widthMm: 100, heightMm: 50, dpi: 203 },
  { label: 'Label 80 × 50 mm', widthMm: 80, heightMm: 50, dpi: 203 },
  { label: 'Label 60 × 40 mm', widthMm: 60, heightMm: 40, dpi: 203 },
  { label: 'Label 40 × 30 mm', widthMm: 40, heightMm: 30, dpi: 203 },
  { label: 'Receipt 80 × 297 mm', widthMm: 80, heightMm: 297, dpi: 203 },
];

const DPI_OPTIONS = [203, 300, 600];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.6rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  font: 'inherit',
  fontSize: '0.85rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.25rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#374151',
};

const sectionStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  padding: '0.85rem 0',
};
const sectionLastStyle: React.CSSProperties = {
  padding: '0.85rem 0',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#1e1e2e',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: '0.6rem',
};

const primaryBtn: React.CSSProperties = {
  padding: '0.6rem 1.2rem',
  border: 0,
  borderRadius: 6,
  background: '#1e1e2e',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.85rem',
};

const secondaryBtn: React.CSSProperties = {
  padding: '0.6rem 1.2rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.85rem',
};

const fieldBtn: React.CSSProperties = {
  padding: '0.45rem 0.6rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: '0.8rem',
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.35rem',
};

export default function PaperProfiles() {
  const [profiles, setProfiles] = useState<PaperProfile[]>([]);
  const [form, setForm] = useState<PaperForm>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    apiFetch<PaperProfile[]>('/v1/paper-profiles').then(setProfiles).catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  function applyPreset(preset: string) {
    const found = PAPER_PRESETS.find((p) => p.label === preset);
    if (!found) return;
    setForm((f) => ({
      ...f,
      widthMm: found.widthMm,
      heightMm: found.heightMm,
      dpi: found.dpi,
      name: f.name || found.label.replace(/\s*\(.*\)/, ''),
    }));
  }

  function startEdit(p: PaperProfile) {
    setEditingId(p.id);
    setForm({
      code: p.code,
      name: p.name,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
      marginTopMm: p.marginTopMm,
      marginRightMm: p.marginRightMm,
      marginBottomMm: p.marginBottomMm,
      marginLeftMm: p.marginLeftMm,
      dpi: p.dpi,
      orientation: p.orientation,
      unit: p.unit,
    });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError('');
  }

  async function save() {
    setError('');
    if (!form.code.trim() || !form.name.trim()) {
      setError('กรุณากรอก Code และ Name');
      return;
    }
    try {
      if (editingId) {
        await apiFetch(`/v1/paper-profiles/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
      } else {
        await apiFetch('/v1/paper-profiles', {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      resetForm();
      void load();
    } catch {
      setError('บันทึกไม่สำเร็จ — ตรวจสอบ Code ซ้ำหรือค่าที่กรอก');
    }
  }

  // Swap dimensions when orientation changes
  function toggleOrientation() {
    setForm((f) => ({
      ...f,
      orientation: f.orientation === 'portrait' ? 'landscape' : 'portrait',
      widthMm: f.heightMm,
      heightMm: f.widthMm,
    }));
  }

  // ---- Paper Preview ----
  const isPortrait = form.orientation === 'portrait';
  const previewMaxW = 220;
  const previewMaxH = 220;
  const ratio = form.widthMm / form.heightMm;
  let pvW: number, pvH: number;
  if (ratio >= previewMaxW / previewMaxH) {
    pvW = previewMaxW;
    pvH = previewMaxW / ratio;
  } else {
    pvH = previewMaxH;
    pvW = previewMaxH * ratio;
  }
  const mx = (mm: number) => Math.min((mm / form.widthMm) * pvW, pvW / 2);
  const my = (mm: number) => Math.min((mm / form.heightMm) * pvH, pvH / 2);

  return (
    <div>
      <h1>Paper Profiles</h1>
      <p style={{ color: '#6b7280', marginBottom: '1rem', fontSize: '0.9rem' }}>
        กำหนดขนาดกระดาษ / ฉลาก รวมถึงระยะขอบ ทิศทาง และคุณภาพการพิมพ์ (DPI) — เหมือนการตั้งค่าก่อนสั่งพิมพ์จริง
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
        {/* ===== Form Panel ===== */}
        <section style={{ background: '#fff', padding: '0 1.25rem', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1.1rem' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>
              {editingId ? '✏️ แก้ไข Paper Profile' : '➕ สร้าง Paper Profile'}
            </h2>
            {editingId && (
              <button style={{ ...secondaryBtn, padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={resetForm}>
                ยกเลิกแก้ไข
              </button>
            )}
          </div>

          {/* --- Identity --- */}
          <div style={sectionStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.6rem' }}>
              <div>
                <label style={labelStyle}>Code *</label>
                <input
                  style={inputStyle}
                  placeholder="LABEL_100X50"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>Name *</label>
                <input
                  style={inputStyle}
                  placeholder="Label 100 × 50 mm"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* --- Paper Size --- */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>📏 Paper Size</div>
            <div style={{ marginBottom: '0.6rem' }}>
              <label style={labelStyle}>Preset / Template</label>
              <select
                style={inputStyle}
                value=""
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="" disabled>
                  — เลือกขนาดมาตรฐาน หรือกรอกเอง —
                </option>
                {PAPER_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '0.6rem', alignItems: 'end' }}>
              <div>
                <label style={labelStyle}>Width ({form.unit})</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={form.widthMm}
                  onChange={(e) => setForm({ ...form, widthMm: Number(e.target.value) })}
                />
              </div>
              <div>
                <label style={labelStyle}>Height ({form.unit})</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={form.heightMm}
                  onChange={(e) => setForm({ ...form, heightMm: Number(e.target.value) })}
                />
              </div>
              <div>
                <label style={labelStyle}>Unit</label>
                <select
                  style={inputStyle}
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value as 'mm' | 'inch' })}
                >
                  <option value="mm">mm</option>
                  <option value="inch">inch</option>
                </select>
              </div>
            </div>
          </div>

          {/* --- Orientation --- */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>🔄 Orientation</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                style={{
                  ...fieldBtn,
                  ...(isPortrait ? { background: '#1e1e2e', color: '#fff', borderColor: '#1e1e2e' } : {}),
                }}
                onClick={() => !isPortrait && toggleOrientation()}
              >
                ▯ Portrait
              </button>
              <button
                style={{
                  ...fieldBtn,
                  ...(!isPortrait ? { background: '#1e1e2e', color: '#fff', borderColor: '#1e1e2e' } : {}),
                }}
                onClick={() => isPortrait && toggleOrientation()}
              >
                ▭ Landscape
              </button>
            </div>
          </div>

          {/* --- Margins --- */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>⬓ Margins ({form.unit})</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <div>
                <label style={labelStyle}>Top</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={form.marginTopMm}
                  onChange={(e) => setForm({ ...form, marginTopMm: Number(e.target.value) })}
                />
              </div>
              <div>
                <label style={labelStyle}>Bottom</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={form.marginBottomMm}
                  onChange={(e) => setForm({ ...form, marginBottomMm: Number(e.target.value) })}
                />
              </div>
              <div>
                <label style={labelStyle}>Left</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={form.marginLeftMm}
                  onChange={(e) => setForm({ ...form, marginLeftMm: Number(e.target.value) })}
                />
              </div>
              <div>
                <label style={labelStyle}>Right</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={form.marginRightMm}
                  onChange={(e) => setForm({ ...form, marginRightMm: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          {/* --- Quality --- */}
          <div style={sectionLastStyle}>
            <div style={sectionTitleStyle}>🖨️ Print Quality (Resolution)</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {DPI_OPTIONS.map((d) => (
                <button
                  key={d}
                  style={{
                    ...fieldBtn,
                    ...(form.dpi === d ? { background: '#1e1e2e', color: '#fff', borderColor: '#1e1e2e' } : {}),
                  }}
                  onClick={() => setForm({ ...form, dpi: d })}
                >
                  {d} dpi
                </button>
              ))}
            </div>
          </div>

          {/* --- Error + Actions --- */}
          {error && (
            <div style={{ padding: '0.55rem 0.7rem', background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: '0.8rem', marginBottom: '0.6rem' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', paddingBottom: '1.1rem' }}>
            <button style={primaryBtn} onClick={() => void save()}>
              {editingId ? '💾 Update' : '➕ Create'}
            </button>
            <button style={secondaryBtn} onClick={resetForm}>
              ↺ Reset
            </button>
          </div>
        </section>

        {/* ===== Preview Panel ===== */}
        <section style={{ background: '#fff', padding: '1.25rem', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>📋 Preview</h2>

          {/* Paper visualization */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 260, background: '#f9fafb', borderRadius: 8, padding: '1.2rem', position: 'relative' }}>
            <div
              style={{
                width: pvW,
                height: pvH,
                border: '2px solid #1e1e2e',
                background: '#fff',
                position: 'relative',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            >
              {/* Margin box */}
              <div
                style={{
                  position: 'absolute',
                  top: my(form.marginTopMm),
                  right: mx(form.marginRightMm),
                  bottom: my(form.marginBottomMm),
                  left: mx(form.marginLeftMm),
                  border: '1px dashed #6b7280',
                  background: 'rgba(30,30,46,0.03)',
                }}
              />
              {/* Content label */}
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: '#9ca3af',
                  fontSize: '0.7rem',
                  textAlign: 'center',
                }}
              >
                {isPortrait ? '▯' : '▭'} {form.orientation}
              </div>
            </div>

            {/* Dimension labels */}
            <div style={{ marginTop: '0.6rem', textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e1e2e' }}>
                {form.widthMm} × {form.heightMm} {form.unit}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                Printable: {(form.widthMm - form.marginLeftMm - form.marginRightMm).toFixed(1)} × {(form.heightMm - form.marginTopMm - form.marginBottomMm).toFixed(1)} {form.unit}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.2rem' }}>
                {form.dpi} dpi · {(form.widthMm * form.dpi / 25.4).toFixed(0)} × {(form.heightMm * form.dpi / 25.4).toFixed(0)} px
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ===== Profile List ===== */}
      <div style={{ marginTop: '1rem', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Saved Profiles ({profiles.length})</h2>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Code', 'Name', 'Size', 'Margins (T/R/B/L)', 'Orientation', 'DPI', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #eee' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.85rem' }}>
                  ยังไม่มี paper profile — สร้างใหม่ด้านบน
                </td>
              </tr>
            )}
            {profiles.map((p) => {
              const isEditing = p.id === editingId;
              return (
                <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6', ...(isEditing ? { background: '#fef9c3' } : {}) }}>
                  <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.code}</td>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>{p.name}</td>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>
                    {p.widthMm} × {p.heightMm} {p.unit}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.75rem', color: '#6b7280' }}>
                    {p.marginTopMm} / {p.marginRightMm} / {p.marginBottomMm} / {p.marginLeftMm}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>
                    {p.orientation === 'portrait' ? '▯ Portrait' : '▭ Landscape'}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>{p.dpi}</td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <button style={{ ...secondaryBtn, padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => startEdit(p)}>
                      ✏️ Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}