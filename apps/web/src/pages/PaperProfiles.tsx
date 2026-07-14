import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

// ── Types ──────────────────────────────────────────────────────────
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
  createdAt: Date;
  updatedAt: Date;
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

// ── Extended UI-only options (not persisted to backend yet) ────────
interface UxOptions {
  displayUnit: 'mm' | 'cm' | 'px';
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontColor: string;
  bgColor: string;
  watermarkText: string;
  watermarkOpacity: number;
  dynamicFields: DynamicField[];
}

interface DynamicField {
  id: string;
  key: string;
  label: string;
  defaultValue: string;
  type: 'text' | 'barcode' | 'date' | 'number';
  xMm: number;
  yMm: number;
  fontSize: number;
  bold: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
}

// ── Presets ────────────────────────────────────────────────────────
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
const DISPLAY_UNITS: ('mm' | 'cm' | 'px')[] = ['mm', 'cm', 'px'];
const FONT_LIST = [
  'system-ui, sans-serif',
  'ui-monospace, monospace',
  'Arial, sans-serif',
  '"Courier New", monospace',
  '"Times New Roman", serif',
  '"Segoe UI", sans-serif',
  'Tahoma, sans-serif',
  'Verdana, sans-serif',
];

const DEFAULT_FORM: PaperForm = {
  code: '', name: '',
  widthMm: 100, heightMm: 50,
  marginTopMm: 2, marginRightMm: 2,
  marginBottomMm: 2, marginLeftMm: 2,
  dpi: 203, orientation: 'portrait', unit: 'mm',
};

const DEFAULT_UX: UxOptions = {
  displayUnit: 'mm', fontFamily: 'system-ui, sans-serif',
  fontSize: 12, fontWeight: 'normal', fontColor: '#000000',
  bgColor: '#ffffff', watermarkText: '', watermarkOpacity: 15,
  dynamicFields: [],
};

function uid() { return Math.random().toString(36).slice(2, 10); }

// ── Unit helpers ───────────────────────────────────────────────────
function toPx(mm: number, dpi: number) { return (mm * dpi) / 25.4; }
function displayVal(mm: number, unit: 'mm' | 'cm' | 'px', dpi: number) {
  if (unit === 'cm') return (mm / 10).toFixed(1);
  if (unit === 'px') return Math.round(toPx(mm, dpi));
  return mm.toFixed(1);
}
function toMm(val: number, fromUnit: 'mm' | 'cm' | 'px', dpi: number) {
  if (fromUnit === 'cm') return val * 10;
  if (fromUnit === 'px') return (val * 25.4) / dpi;
  return val;
}

// ── Inline styles ──────────────────────────────────────────────────
const s = {
  label: { display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 600, color: '#374151' } as React.CSSProperties,
  input: { width: '100%', padding: '0.45rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 6, font: 'inherit', fontSize: '0.85rem' } as React.CSSProperties,
  smallInput: { width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, font: 'inherit', fontSize: '0.8rem' } as React.CSSProperties,
  sel: { width: '100%', padding: '0.45rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 6, font: 'inherit', fontSize: '0.85rem', background: '#fff' } as React.CSSProperties,
  btn: { padding: '0.5rem 1rem', border: 0, borderRadius: 6, background: '#1e1e2e', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' } as React.CSSProperties,
  btnSmall: { padding: '0.3rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.75rem' } as React.CSSProperties,
  btnDanger: { padding: '0.3rem 0.6rem', border: '1px solid #fecaca', borderRadius: 4, background: '#fff', color: '#dc2626', cursor: 'pointer', fontSize: '0.75rem' } as React.CSSProperties,
  section: { borderBottom: '1px solid #e5e7eb', padding: '0' } as React.CSSProperties,
};

// ── Collapsible Section ────────────────────────────────────────────
function Section({ title, defaultOpen, children, icon }: { title: string; defaultOpen?: boolean; children: React.ReactNode; icon?: string }) {
  const [open, setOpen] = useState(defaultOpen !== false);
  return (
    <div style={{ ...s.section, marginBottom: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.6rem 0.75rem', border: 0, background: 'transparent',
          cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: '#1e1e2e',
          textTransform: 'uppercase', letterSpacing: '0.03em',
        }}
      >
        <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '0.65rem', color: '#9ca3af' }}>▶</span>
        {icon && <span style={{ fontSize: '0.85rem' }}>{icon}</span>}
        {title}
        <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: '0.65rem' }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ padding: '0 0.75rem 0.75rem' }}>{children}</div>}
    </div>
  );
}

// ── Color Picker ───────────────────────────────────────────────────
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <label style={{ ...s.label, marginBottom: 0, whiteSpace: 'nowrap', minWidth: 60 }}>{label}</label>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: 36, height: 30, padding: 0, border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }} />
      <input value={value} onChange={(e) => onChange(e.target.value)}
        style={{ ...s.smallInput, width: 80, fontFamily: 'monospace' }} />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export default function PaperProfiles() {
  const { t } = useLocale();
  const [profiles, setProfiles] = useState<PaperProfile[]>([]);
  const [form, setForm] = useState<PaperForm>(DEFAULT_FORM);
  const [ux, setUx] = useState<UxOptions>(DEFAULT_UX);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showDrawer, setShowDrawer] = useState<'fields' | 'appearance' | null>(null);
  const [stickyNote, setStickyNote] = useState<string | null>(null);

  const du = ux.displayUnit;
  const dpi = form.dpi;

  // ── Field helpers ──────────────────────────────────────────────────
  function patch<K extends keyof PaperForm>(key: K, val: PaperForm[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }
  function uxPatch<K extends keyof UxOptions>(key: K, val: UxOptions[K]) {
    setUx((u) => ({ ...u, [key]: val }));
  }
  function numeric(key: keyof PaperForm, raw: string) {
    const v = parseFloat(raw);
    if (!isNaN(v)) patch(key, v);
  }
  function convertDim(valMm: number): string {
    return String(displayVal(valMm, du, dpi));
  }
  function dimInput(key: keyof PaperForm, label: string) {
    const mmVal = form[key] as number;
    return (
      <div>
        <label style={s.label}>{label}</label>
        <input type="number" value={convertDim(mmVal)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) patch(key, toMm(v, du, dpi));
          }}
          style={s.input} step="any" />
      </div>
    );
  }

  // ── Dynamic fields ─────────────────────────────────────────────────
  function addField() {
    const f: DynamicField = {
      id: uid(), key: '', label: '', defaultValue: '',
      type: 'text', xMm: 5, yMm: 5,
      fontSize: 12, bold: false, color: '#000000', align: 'left',
    };
    uxPatch('dynamicFields', [...ux.dynamicFields, f]);
    setStickyNote('✨ Added new field — set its key, label & position');
    setTimeout(() => setStickyNote(null), 2500);
  }
  function updField(id: string, patch: Partial<DynamicField>) {
    uxPatch('dynamicFields', ux.dynamicFields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function delField(id: string) {
    uxPatch('dynamicFields', ux.dynamicFields.filter((f) => f.id !== id));
  }

  // ── API ────────────────────────────────────────────────────────────
  const load = () => apiFetch<PaperProfile[]>('/v1/paper-profiles').then(setProfiles).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function save() {
    const body = { ...form, code: form.code || form.name.toLowerCase().replace(/\\s+/g, '_') };
    if (editingId) {
      await apiFetch('/v1/paper-profiles/' + editingId, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await apiFetch('/v1/paper-profiles', { method: 'POST', body: JSON.stringify(body) });
    }
    setEditingId(null);
    setForm(DEFAULT_FORM);
    load();
  }

  function startEdit(p: PaperProfile) {
    setForm({
      code: p.code, name: p.name,
      widthMm: p.widthMm, heightMm: p.heightMm,
      marginTopMm: p.marginTopMm, marginRightMm: p.marginRightMm,
      marginBottomMm: p.marginBottomMm, marginLeftMm: p.marginLeftMm,
      dpi: p.dpi, orientation: p.orientation, unit: p.unit,
    });
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function applyPreset(p: typeof PAPER_PRESETS[number]) {
    setForm((f) => ({ ...f, widthMm: p.widthMm, heightMm: p.heightMm, dpi: p.dpi }));
    setPresetsOpen(false);
  }

  // ── Preview calc ───────────────────────────────────────────────────
  const maxPvSize = 320;
  const scale = Math.min(maxPvSize / form.widthMm, maxPvSize / form.heightMm, 2);
  const pvW = form.widthMm * scale;
  const pvH = form.heightMm * scale;
  const pvMT = form.marginTopMm * scale;
  const pvMR = form.marginRightMm * scale;
  const pvMB = form.marginBottomMm * scale;
  const pvML = form.marginLeftMm * scale;
  const pvPrintW = pvW - pvML - pvMR;
  const pvPrintH = pvH - pvMT - pvMB;

  const isPortrait = form.orientation === 'portrait';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 0 }}>
      {/* ─── Sticky Note ─── */}
      {stickyNote && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 50,
          padding: '0.55rem 0.85rem', borderRadius: 8,
          background: '#fef9c3', color: '#92400e',
          fontSize: '0.85rem', fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          animation: 'fadeIn 0.25s ease',
        }}>
          <span>💡</span> {stickyNote}
        </div>
      )}

      {/* ─── Top bar ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Paper Profiles</h1>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button style={s.btnSmall} onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? t('page.paperProfiles.hidePreview') : t('page.paperProfiles.showPreview')}
          </button>
          <button style={s.btnSmall} onClick={() => setShowDrawer(showDrawer === 'fields' ? null : 'fields')}>
            {showDrawer === 'fields' ? t('page.paperProfiles.closeFields') : t('page.paperProfiles.fields')}
          </button>
          <button style={s.btnSmall} onClick={() => setShowDrawer(showDrawer === 'appearance' ? null : 'appearance')}>
            {showDrawer === 'appearance' ? t('page.paperProfiles.closeStyle') : t('page.paperProfiles.style')}
          </button>
        </div>
      </div>

      {/* ─── Main layout ─── */}
      <div style={{ flex: 1, display: 'flex', gap: '0.75rem', minHeight: 0, position: 'relative' }}>
        {/* ===== LEFT: Form ===== */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {/* ── Presets ── */}
          <div style={{ padding: '0.6rem 0.75rem', borderBottom: '1px solid #e5e7eb' }}>
            <button style={{ ...s.btnSmall, width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={() => setPresetsOpen(!presetsOpen)}>
              <span>{t('page.paperProfiles.presets')}</span> <span>{presetsOpen ? '▲' : '▼'}</span>
            </button>
            {presetsOpen && (
              <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {PAPER_PRESETS.map((p) => (
                  <button key={p.label} style={{ ...s.btnSmall, textAlign: 'left', fontSize: '0.75rem' }}
                    onClick={() => applyPreset(p)}>{p.label}</button>
                ))}
              </div>
            )}
          </div>

          <Section title={t('page.paperProfiles.basicInfo')} icon="📄">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={s.label}>Code</label>
                <input value={form.code} onChange={(e) => patch('code', e.target.value)} placeholder="auto" style={s.input} />
              </div>
              <div>
                <label style={s.label}>Name *</label>
                <input value={form.name} onChange={(e) => patch('name', e.target.value)} placeholder="My Label" style={s.input} />
              </div>
            </div>
          </Section>

          <Section title={t('page.paperProfiles.dimensions')} icon="📐">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={s.label}>Display unit</label>
                <select value={du} onChange={(e) => uxPatch('displayUnit', e.target.value as 'mm' | 'cm' | 'px')} style={s.sel}>
                  {DISPLAY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Orientation</label>
                <select value={form.orientation} onChange={(e) => patch('orientation', e.target.value as 'portrait' | 'landscape')} style={s.sel}>
                  <option value="portrait">Portrait ▯</option>
                  <option value="landscape">Landscape ▭</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
              {dimInput('widthMm', 'Width (' + du + ')')}
              {dimInput('heightMm', 'Height (' + du + ')')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.25rem' }}>
              <div>
                <label style={s.label}>DPI</label>
                <select value={form.dpi} onChange={(e) => numeric('dpi', e.target.value)} style={s.sel}>
                  {DPI_OPTIONS.map((d) => <option key={d} value={d}>{d} dpi</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Unit (storage)</label>
                <select value={form.unit} onChange={(e) => patch('unit', e.target.value as 'mm' | 'inch')} style={s.sel}>
                  <option value="mm">mm</option>
                  <option value="inch">inch</option>
                </select>
              </div>
            </div>
          </Section>

          <Section title={t('page.paperProfiles.margins')} icon="⬜" defaultOpen={false}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {dimInput('marginTopMm', 'Top (' + du + ')')}
              {dimInput('marginRightMm', 'Right (' + du + ')')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.25rem' }}>
              {dimInput('marginBottomMm', 'Bottom (' + du + ')')}
              {dimInput('marginLeftMm', 'Left (' + du + ')')}
            </div>
          </Section>

          {/* ── Dynamic fields (inline in form) ── */}
          <Section title={t('page.paperProfiles.fieldsCount').replace('{n}', String(ux.dynamicFields.length))} icon='⚡'>
            {ux.dynamicFields.length === 0 && (
              <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0.5rem 0' }}>
                {t('page.paperProfiles.noCustomFields')}. {t('page.paperProfiles.clickAddField')}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {ux.dynamicFields.map((f) => (
                <div key={f.id} style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa', position: 'relative' }}>
                  <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                    <input placeholder="key" value={f.key} onChange={(e) => updField(f.id, { key: e.target.value })}
                      style={{ ...s.smallInput, width: 90, fontFamily: 'monospace' }} />
                    <input placeholder="Label" value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })}
                      style={{ ...s.smallInput, flex: 1 }} />
                    <select value={f.type} onChange={(e) => updField(f.id, { type: e.target.value as DynamicField['type'] })}
                      style={{ ...s.sel, width: 80, padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}>
                      <option value="text">Aa</option>
                      <option value="barcode">‖‖</option>
                      <option value="date">📅</option>
                      <option value="number">#</option>
                    </select>
                    <button style={s.btnDanger} onClick={() => delField(f.id)}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input placeholder="default" value={f.defaultValue} onChange={(e) => updField(f.id, { defaultValue: e.target.value })}
                      style={{ ...s.smallInput, width: 80 }} />
                    <label style={{ fontSize: '0.7rem', color: '#6b7280' }}>X:</label>
                    <input type="number" value={f.xMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }}
                      style={{ ...s.smallInput, width: 50 }} />
                    <label style={{ fontSize: '0.7rem', color: '#6b7280' }}>Y:</label>
                    <input type="number" value={f.yMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }}
                      style={{ ...s.smallInput, width: 50 }} />
                    <input type="number" value={f.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: v }); }}
                      style={{ ...s.smallInput, width: 50 }} title="Font size pt" />
                    <input type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })}
                      style={{ width: 28, height: 24, padding: 0, border: '1px solid #d1d5db', borderRadius: 3, cursor: 'pointer' }} />
                    <select value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })}
                      style={{ ...s.sel, width: 60, padding: '0.25rem 0.3rem', fontSize: '0.7rem' }}>
                      <option value="left">⬅</option><option value="center">⬡</option><option value="right">➡</option>
                    </select>
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                      <input type="checkbox" checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} /> B
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <button style={{ ...s.btnSmall, marginTop: '0.5rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#93c5fd' }}
              onClick={addField}>{t('page.paperProfiles.addField')}</button>
          </Section>

          {/* ── Save ── */}
          <div style={{ padding: '0.75rem', display: 'flex', gap: '0.5rem' }}>
            <button style={s.btn} onClick={() => void save()}>
              {editingId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}
            </button>
            {editingId && (
              <button style={{ ...s.btnSmall, padding: '0.5rem 1rem' }} onClick={() => { setEditingId(null); setForm(DEFAULT_FORM); }}>
                {t('common.cancel')}
              </button>
            )}
          </div>
        </div>

        {/* ===== RIGHT: Preview ===== */}
        {showPreview && (
          <div style={{
            width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
            background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            overflow: 'hidden', position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 8rem)',
          }}>
            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>📺 Preview</span>
              <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>
                {displayVal(form.widthMm, du, dpi)} × {displayVal(form.heightMm, du, dpi)} {du}
              </span>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'grid', placeItems: 'center', padding: '1rem', background: '#f3f4f6' }}>
              {/* Realistic paper */}
              <div style={{
                width: pvW, height: pvH,
                background: ux.bgColor,
                borderRadius: 1,
                boxShadow: '0 2px 8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
                position: 'relative', overflow: 'hidden',
                rotate: isPortrait ? '0deg' : '90deg',
                transform: 'scale(' + Math.min(1, 300 / Math.max(pvW, pvH)) + ')',
                transformOrigin: 'center center',
              }}>
                {/* Watermark */}
                {ux.watermarkText && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'grid', placeItems: 'center',
                    fontSize: form.widthMm * scale * 0.08,
                    color: ux.fontColor,
                    opacity: ux.watermarkOpacity / 100,
                    transform: 'rotate(-30deg)',
                    fontWeight: 700, pointerEvents: 'none',
                    zIndex: 0, whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {ux.watermarkText}
                  </div>
                )}

                {/* Printable area */}
                <div style={{
                  position: 'absolute',
                  left: pvML, top: pvMT,
                  width: pvPrintW, height: pvPrintH,
                  border: '1px dashed rgba(0,0,0,0.12)',
                  pointerEvents: 'none', zIndex: 1,
                }}>
                  {/* Dynamic fields in preview */}
                  {ux.dynamicFields.map((f) => {
                    const fx = f.xMm * scale;
                    const fy = f.yMm * scale;
                    return (
                      <div key={f.id} style={{
                        position: 'absolute',
                        left: fx, top: fy,
                        fontSize: f.fontSize * 0.75,
                        fontWeight: f.bold ? 700 : 400,
                        color: f.color,
                        textAlign: f.align,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        fontFamily: ux.fontFamily,
                      }}>
                        {f.label || f.key || 'field'}
                      </div>
                    );
                  })}
                </div>

                {/* Margin indicators */}
                {[{ d: pvMT, side: 'top' as const }, { d: pvMR, side: 'right' as const }, { d: pvMB, side: 'bottom' as const }, { d: pvML, side: 'left' as const }].map((m) => (
                  <div key={m.side} style={{
                    position: 'absolute',
                    ...(m.side === 'top' ? { top: 0, left: 0, right: 0, height: m.d } : {}),
                    ...(m.side === 'bottom' ? { bottom: 0, left: 0, right: 0, height: m.d } : {}),
                    ...(m.side === 'left' ? { left: 0, top: 0, bottom: 0, width: m.d } : {}),
                    ...(m.side === 'right' ? { right: 0, top: 0, bottom: 0, width: m.d } : {}),
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.15)',
                    pointerEvents: 'none', zIndex: 1,
                  }} />
                ))}
              </div>
            </div>

            {/* Quick info */}
            <div style={{
              padding: '0.5rem 0.75rem', borderTop: '1px solid #e5e7eb',
              fontSize: '0.7rem', color: '#6b7280', lineHeight: 1.5,
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.5rem',
            }}>
              <span>Size: {form.widthMm} × {form.heightMm} mm</span>
              <span>DPI: {form.dpi}</span>
              <span>Printable: {(form.widthMm - form.marginLeftMm - form.marginRightMm).toFixed(1)} × {(form.heightMm - form.marginTopMm - form.marginBottomMm).toFixed(1)} mm</span>
              <span>Pixels: {Math.round(toPx(form.widthMm, form.dpi))} × {Math.round(toPx(form.heightMm, form.dpi))} px</span>
              <span>Scale: {scale.toFixed(2)}x</span>
              <span>Fields: {ux.dynamicFields.length}</span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Drawer: Fields ─── */}
      {showDrawer === 'fields' && (
        <div style={{
          position: 'fixed', right: 0, top: 0, bottom: 0, width: 380, maxWidth: '90vw',
          background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 100,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'slideInRight 0.25s ease',
        }}>
          <div style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('page.paperProfiles.dynamicFieldsEditor')}</span>
            <button style={s.btnSmall} onClick={() => setShowDrawer(null)}>{t('page.paperProfiles.close')}</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
            {ux.dynamicFields.length === 0 && (
              <p style={{ fontSize: '0.85rem', color: '#9ca3af', textAlign: 'center', marginTop: '2rem' }}>
                {t('page.paperProfiles.fieldsDrawerEmpty')}<br />{t('page.paperProfiles.clickAddField')}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {ux.dynamicFields.map((f) => (
                <div key={f.id} style={{ padding: '0.65rem', border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <code style={{ fontSize: '0.8rem', fontWeight: 600 }}>{f.key || '(no key)'}</code>
                    <button style={s.btnDanger} onClick={() => delField(f.id)}>{t('page.paperProfiles.remove')}</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', fontSize: '0.75rem' }}>
                    <div><label style={{ color: '#6b7280' }}>Label</label><input value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>Type</label><select value={f.type} onChange={(e) => updField(f.id, { type: e.target.value as DynamicField['type'] })} style={{ ...s.sel, padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}><option value="text">Text</option><option value="barcode">Barcode</option><option value="date">Date</option><option value="number">Number</option></select></div>
                    <div><label style={{ color: '#6b7280' }}>Default</label><input value={f.defaultValue} onChange={(e) => updField(f.id, { defaultValue: e.target.value })} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>Font size</label><input type="number" value={f.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: v }); }} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>X (mm)</label><input type="number" value={f.xMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>Y (mm)</label><input type="number" value={f.yMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>Color</label><input type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })} style={{ width: '100%', height: 28, padding: 0, border: '1px solid #d1d5db', borderRadius: 4 }} /></div>
                    <div><label style={{ color: '#6b7280' }}>Align</label><select value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })} style={{ ...s.sel, padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', gridColumn: '1 / -1' }}>
                      <input type="checkbox" id={'bold-'+f.id} checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} />
                      <label htmlFor={'bold-'+f.id} style={{ fontSize: '0.75rem' }}>Bold</label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button style={{ ...s.btnSmall, marginTop: '0.75rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#93c5fd' }}
              onClick={addField}>{t('page.paperProfiles.addField')}</button>
          </div>
        </div>
      )}

      {/* ─── Drawer: Appearance ─── */}
      {showDrawer === 'appearance' && (
        <div style={{
          position: 'fixed', right: 0, top: 0, bottom: 0, width: 340, maxWidth: '90vw',
          background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 100,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'slideInRight 0.25s ease',
        }}>
          <div style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t('page.paperProfiles.appearanceStyle')}</span>
            <button style={s.btnSmall} onClick={() => setShowDrawer(null)}>{t('page.paperProfiles.close')}</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={s.label}>Font Family</label>
                <select value={ux.fontFamily} onChange={(e) => uxPatch('fontFamily', e.target.value)} style={s.sel}>
                  {FONT_LIST.map((f) => <option key={f} value={f}>{f.replace(/['"]/g, '')}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={s.label}>Font Size (pt)</label>
                  <input type="number" value={ux.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) uxPatch('fontSize', v); }}
                    style={s.input} min={6} max={72} />
                </div>
                <div>
                  <label style={s.label}>Font Weight</label>
                  <select value={ux.fontWeight} onChange={(e) => uxPatch('fontWeight', e.target.value as 'normal' | 'bold')} style={s.sel}>
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                  </select>
                </div>
              </div>
              <ColorInput label="Font Color" value={ux.fontColor} onChange={(v) => uxPatch('fontColor', v)} />
              <ColorInput label="Background" value={ux.bgColor} onChange={(v) => uxPatch('bgColor', v)} />
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.5rem' }}>
                <label style={s.label}>Watermark Text</label>
                <input value={ux.watermarkText} onChange={(e) => uxPatch('watermarkText', e.target.value)}
                  placeholder="e.g. DRAFT / SAMPLE" style={s.input} />
              </div>
              <div>
                <label style={s.label}>Watermark Opacity: {ux.watermarkOpacity}%</label>
                <input type="range" min={0} max={50} value={ux.watermarkOpacity}
                  onChange={(e) => uxPatch('watermarkOpacity', parseInt(e.target.value))}
                  style={{ width: '100%' }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Profile list ─── */}
      <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ padding: '0.65rem 0.85rem', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '0.95rem', margin: 0 }}>{t('page.paperProfiles.savedProfiles').replace('{n}', String(profiles.length))}</h2>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['Code', 'Name', 'Size', 'Margins (T/R/B/L)', 'Orient', 'DPI', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '0.5rem 0.6rem', textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>
                    No paper profiles yet
                  </td>
                </tr>
              )}
              {profiles.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem 0.6rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.code}</td>
                  <td style={{ padding: '0.5rem 0.6rem' }}>{p.name}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.widthMm}×{p.heightMm}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.7rem', color: '#6b7280' }}>{p.marginTopMm}/{p.marginRightMm}/{p.marginBottomMm}/{p.marginLeftMm}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.orientation === 'portrait' ? '▯' : '▭'}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.dpi}</td>
                  <td style={{ padding: '0.5rem 0.6rem' }}>
                    <button style={{ ...s.btnSmall, padding: '0.25rem 0.5rem', fontSize: '0.7rem' }} onClick={() => startEdit(p)}>✏️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Style tag for animations ─── */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}