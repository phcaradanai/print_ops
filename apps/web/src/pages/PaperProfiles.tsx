import { useEffect, useMemo, useRef, useState } from 'react';
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
  input: { width: '100%', maxWidth: 420, padding: '0.45rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 6, font: 'inherit', fontSize: '0.85rem' } as React.CSSProperties,
  smallInput: { width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, font: 'inherit', fontSize: '0.8rem' } as React.CSSProperties,
  sel: { width: '100%', maxWidth: 420, padding: '0.45rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 6, font: 'inherit', fontSize: '0.85rem', background: '#fff' } as React.CSSProperties,
  btn: { padding: '0.5rem 1rem', border: 0, borderRadius: 6, background: '#1e1e2e', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' } as React.CSSProperties,
  btnSmall: { padding: '0.3rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.75rem' } as React.CSSProperties,
  btnDanger: { padding: '0.3rem 0.6rem', border: '1px solid #fecaca', borderRadius: 4, background: '#fff', color: '#dc2626', cursor: 'pointer', fontSize: '0.75rem' } as React.CSSProperties,
  section: { borderBottom: '1px solid #e5e7eb', padding: '0' } as React.CSSProperties,
};

// ── Collapsible Section ────────────────────────────────────────────
function Section({ title, defaultOpen, children, icon, open, onToggle }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode; icon?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen !== false);
  const isOpen = open !== undefined ? open : internalOpen;
  const handleToggle = () => { if (onToggle) onToggle(); else setInternalOpen(!isOpen); };
  return (
    <div className="pp-section" style={{ ...s.section, marginBottom: 0 }}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        className="pp-section__toggle"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.6rem 0.75rem', border: 0, background: 'transparent',
          cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: '#1e1e2e',
          textTransform: 'uppercase', letterSpacing: '0.03em',
        }}
      >
        <span style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '0.65rem', color: '#9ca3af' }}>▶</span>
        {icon && <span style={{ fontSize: '0.85rem' }}>{icon}</span>}
        {title}
        <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: '0.65rem' }}>{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="pp-section__body" style={{ padding: '0 0.75rem 0.75rem' }}>{children}</div>}
    </div>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={'pp-icon-btn' + (active ? ' pp-icon-btn--active' : '')}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
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

function PreviewSheet({
  form,
  ux,
  scale,
  rotateSheet = true,
  sheetRef,
  selectedFieldId,
  onFieldPointerDown,
  onFieldSelect,
}: {
  form: PaperForm;
  ux: UxOptions;
  scale: number;
  rotateSheet?: boolean;
  sheetRef?: React.RefObject<HTMLDivElement>;
  selectedFieldId?: string | null;
  onFieldPointerDown?: (event: React.PointerEvent<HTMLButtonElement>, id: string) => void;
  onFieldSelect?: (id: string) => void;
}) {
  const pvW = form.widthMm * scale;
  const pvH = form.heightMm * scale;
  const pvMT = form.marginTopMm * scale;
  const pvMR = form.marginRightMm * scale;
  const pvMB = form.marginBottomMm * scale;
  const pvML = form.marginLeftMm * scale;
  const pvPrintW = pvW - pvML - pvMR;
  const pvPrintH = pvH - pvMT - pvMB;
  const interactive = Boolean(onFieldPointerDown);
  const naturalOrientation = form.widthMm > form.heightMm ? 'landscape' : 'portrait';
  const needsRotation = naturalOrientation !== form.orientation;

  return (
    <div
      ref={sheetRef}
      style={{
        width: pvW,
        height: pvH,
        background: ux.bgColor,
        borderRadius: 1,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
        position: 'relative',
        overflow: 'hidden',
        transform: rotateSheet && needsRotation ? 'rotate(90deg)' : undefined,
        transformOrigin: 'center center',
      }}
    >
      {ux.watermarkText && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: form.widthMm * scale * 0.08, color: ux.fontColor,
          opacity: ux.watermarkOpacity / 100, transform: 'rotate(-30deg)',
          fontWeight: 700, pointerEvents: 'none', zIndex: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {ux.watermarkText}
        </div>
      )}

      <div style={{
        position: 'absolute', left: pvML, top: pvMT, width: pvPrintW, height: pvPrintH,
        border: '1px dashed rgba(0,0,0,0.18)', zIndex: 1,
      }}>
        {ux.dynamicFields.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-label={`${f.key || f.label || 'field'} at ${f.xMm}, ${f.yMm} mm`}
            onPointerDown={interactive ? (event) => onFieldPointerDown?.(event, f.id) : undefined}
            onClick={interactive ? () => onFieldSelect?.(f.id) : undefined}
            style={{
              position: 'absolute', left: f.xMm * scale, top: f.yMm * scale,
              fontSize: f.fontSize * 0.75, fontWeight: f.bold ? 700 : 400,
              color: f.color, textAlign: f.align, whiteSpace: 'nowrap',
              fontFamily: ux.fontFamily, pointerEvents: interactive ? 'auto' : 'none',
              cursor: interactive ? 'grab' : 'default',
              padding: interactive ? '0.15rem 0.25rem' : 0,
              border: selectedFieldId === f.id ? '1px solid #1e66f5' : '1px solid transparent',
              borderRadius: 3,
              background: selectedFieldId === f.id ? 'rgba(30,102,245,0.1)' : 'transparent',
              zIndex: 2,
            }}
          >
            {f.label || f.key || 'field'}
          </button>
        ))}
      </div>

      {[{ d: pvMT, side: 'top' as const }, { d: pvMR, side: 'right' as const }, { d: pvMB, side: 'bottom' as const }, { d: pvML, side: 'left' as const }].map((m) => (
        <div key={m.side} style={{
          position: 'absolute',
          ...(m.side === 'top' ? { top: 0, left: 0, right: 0, height: m.d } : {}),
          ...(m.side === 'bottom' ? { bottom: 0, left: 0, right: 0, height: m.d } : {}),
          ...(m.side === 'left' ? { left: 0, top: 0, bottom: 0, width: m.d } : {}),
          ...(m.side === 'right' ? { right: 0, top: 0, bottom: 0, width: m.d } : {}),
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
          pointerEvents: 'none', zIndex: 1,
        }} />
      ))}
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [showDrawer, setShowDrawer] = useState<'fields' | 'appearance' | null>(null);
  const [stickyNote, setStickyNote] = useState<string | null>(null);
  const previewSheetRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const modalStageRef = useRef<HTMLDivElement>(null);
  const [modalStageSize, setModalStageSize] = useState({ width: 0, height: 0 });

  // ── Section tracking (for sticky index & collapse/expand all) ──────
  type SectionKey = 'basicInfo' | 'dimensions' | 'margins' | 'fields';
  const [sectionsOpen, setSectionsOpen] = useState<Record<SectionKey, boolean>>({
    basicInfo: true, dimensions: true, margins: false, fields: true,
  });
  const basicInfoRef = useRef<HTMLDivElement>(null);
  const dimensionsRef = useRef<HTMLDivElement>(null);
  const marginsRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const sectionRefs: Record<SectionKey, React.RefObject<HTMLDivElement>> = {
    basicInfo: basicInfoRef, dimensions: dimensionsRef, margins: marginsRef, fields: fieldsRef,
  };
  function toggleSection(key: SectionKey) {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function scrollToSection(key: SectionKey) {
    sectionRefs[key].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!sectionsOpen[key]) toggleSection(key);
  }
  function expandAll() {
    setSectionsOpen({ basicInfo: true, dimensions: true, margins: true, fields: true });
  }
  function collapseAll() {
    setSectionsOpen({ basicInfo: false, dimensions: false, margins: false, fields: false });
  }
  const allExpanded = Object.values(sectionsOpen).every(Boolean);

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
  function dimInput(key: keyof PaperForm, labelKey: string) {
    const mmVal = form[key] as number;
    return (
      <div>
        <label style={s.label}>{t(labelKey) + ' (' + du + ')'}</label>
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
  const naturalOrientation = form.widthMm > form.heightMm ? 'landscape' : 'portrait';
  const needsRotation = naturalOrientation !== form.orientation;
  const previewWidthMm = needsRotation ? form.heightMm : form.widthMm;
  const previewHeightMm = needsRotation ? form.widthMm : form.heightMm;
  const scale = Math.min(maxPvSize / previewWidthMm, maxPvSize / previewHeightMm, 2);

  useEffect(() => {
    if (!previewOpen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOpen(false);
    };
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    onResize();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [previewOpen]);

  useEffect(() => {
    if (!previewOpen || !modalStageRef.current) return;
    const el = modalStageRef.current;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setModalStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [previewOpen]);

  const modalScale = useMemo(() => {
    const { width: stageW, height: stageH } = modalStageSize;
    if (stageW === 0 || stageH === 0) {
      return Math.max(0.35, Math.min(
        20,
        ((viewport.width <= 820 ? viewport.width * 0.92 : viewport.width * 0.62) - 80) / previewWidthMm,
        (viewport.height - (viewport.width <= 820 ? 420 : 190)) / previewHeightMm,
      ));
    }
    const margin = 24; // small breathing room so the sheet doesn't touch the edges
    const availableW = Math.max(1, stageW - margin * 2);
    const availableH = Math.max(1, stageH - margin * 2);
    const scale = Math.min(availableW / previewWidthMm, availableH / previewHeightMm);
    return Math.max(0.5, Math.min(20, scale));
  }, [modalStageSize, previewWidthMm, previewHeightMm, viewport.width, viewport.height]);

  useEffect(() => {
    if (!draggingFieldId) return;
    const onPointerMove = (event: PointerEvent) => {
      const sheet = previewSheetRef.current;
      if (!sheet) return;
      const rect = sheet.getBoundingClientRect();
      const printableWidth = Math.max(0, form.widthMm - form.marginLeftMm - form.marginRightMm);
      const printableHeight = Math.max(0, form.heightMm - form.marginTopMm - form.marginBottomMm);
      const visualX = (event.clientX - rect.left) / modalScale;
      const visualY = (event.clientY - rect.top) / modalScale;
      // CSS rotate(90deg) maps original (x, y) to visual (height - y, x).
      const originalX = needsRotation ? visualY : visualX;
      const originalY = needsRotation ? form.heightMm - visualX : visualY;
      const xMm = Math.min(printableWidth, Math.max(0, originalX - form.marginLeftMm));
      const yMm = Math.min(printableHeight, Math.max(0, originalY - form.marginTopMm));
      setUx((current) => ({
        ...current,
        dynamicFields: current.dynamicFields.map((field) => (
          field.id === draggingFieldId
            ? { ...field, xMm: Number(xMm.toFixed(1)), yMm: Number(yMm.toFixed(1)) }
            : field
        )),
      }));
    };
    const onPointerUp = () => setDraggingFieldId(null);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, [draggingFieldId, form.heightMm, form.marginBottomMm, form.marginLeftMm, form.marginRightMm, form.marginTopMm, form.widthMm, modalScale, needsRotation]);

  function startDraggingField(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    setSelectedFieldId(id);
    setDraggingFieldId(id);
  }

  // ── Escape key to close drawers ────────────────────────────────────
  useEffect(() => {
    if (!showDrawer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDrawer(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showDrawer]);

  return (
    <div className="paper-profiles-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 0 }}>
      {/* ─── Sticky Note ─── */}
      {stickyNote && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 50,
          padding: '0.55rem 0.85rem', borderRadius: 8,
          background: '#fef9c3', color: '#92400e',
          fontSize: '0.85rem', fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          animation: 'ppStickyNoteIn 0.25s ease',
        }}>
          <span>💡</span> {stickyNote}
        </div>
      )}

      {/* ─── Top bar ─── */}
      <header className="pp-page-header">
        <div className="pp-page-heading">
          <span className="pp-page-heading__icon" aria-hidden="true">📄</span>
          <div>
            <h1>{t('page.paperProfiles.title')}</h1>
            <div className="pp-page-heading__meta">
              <span>{form.code || 'auto'}</span>
              <span>{displayVal(form.widthMm, du, dpi)} × {displayVal(form.heightMm, du, dpi)} {du}</span>
            </div>
          </div>
        </div>
        <div className="pp-toolbar" role="toolbar" aria-label={t('page.paperProfiles.pageActions')}>
          <IconButton icon="⛶" label={t('page.paperProfiles.fullPreview')} onClick={() => setPreviewOpen(true)} active />
          <IconButton icon="◫" label={t('page.paperProfiles.togglePreview')} onClick={() => setShowPreview(!showPreview)} active={showPreview} />
          <IconButton icon="⚡" label={t('page.paperProfiles.toggleFields')} onClick={() => setShowDrawer(showDrawer === 'fields' ? null : 'fields')} active={showDrawer === 'fields'} />
          <IconButton icon="🎨" label={t('page.paperProfiles.toggleStyle')} onClick={() => setShowDrawer(showDrawer === 'appearance' ? null : 'appearance')} active={showDrawer === 'appearance'} />
        </div>
      </header>

      {/* ─── Main layout ─── */}
      <div className="pp-main-layout" style={{ flex: 1, display: 'flex', gap: '0.75rem', minHeight: 0, position: 'relative' }}>
        {/* ===== LEFT: Form ===== */}
        <div className="pp-form-panel" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          {/* ── Unified toolbar ── */}
          <div className="pp-command-bar">
            <nav className="pp-index" role="navigation" aria-label={t('page.paperProfiles.sectionIndex')}>
              {(['basicInfo', 'dimensions', 'margins', 'fields'] as SectionKey[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  className="pp-index-btn"
                  onClick={() => scrollToSection(key)}
                  title={t('page.paperProfiles.' + key)}
                  aria-label={t('page.paperProfiles.' + key)}
                >
                  <span aria-hidden="true">{key === 'basicInfo' ? '📄' : key === 'dimensions' ? '📐' : key === 'margins' ? '⬜' : '⚡'}</span>
                </button>
              ))}
            </nav>
            <div className="pp-command-actions">
              <div className="pp-command-status" aria-live="polite">
                <span className="pp-command-status__dot" aria-hidden="true">●</span>
                <span>{editingId ? t('page.paperProfiles.editingProfile') : t('page.paperProfiles.readyToSave')}</span>
              </div>
              <div className="pp-presets">
                <button type="button" className="pp-icon-btn" onClick={() => setPresetsOpen(!presetsOpen)}
                  title={t('page.paperProfiles.presets')} aria-label={t('page.paperProfiles.presets')} aria-expanded={presetsOpen}>
                  <span aria-hidden="true">📋</span>
                </button>
                {presetsOpen && (
                  <div className="pp-presets-menu" role="menu">
                    {PAPER_PRESETS.map((p) => (
                      <button type="button" key={p.label} className="pp-preset-option" role="menuitem" onClick={() => { applyPreset(p); setPresetsOpen(false); }}>
                        <span aria-hidden="true">▸</span>{p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <IconButton icon={allExpanded ? '▾' : '▸'} label={allExpanded ? t('page.paperProfiles.collapseAll') : t('page.paperProfiles.expandAll')} onClick={allExpanded ? collapseAll : expandAll} />
              <button type="button" className="pp-save-button" style={s.btn} onClick={() => void save()}
                title={editingId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}
                aria-label={editingId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}>
                <span aria-hidden="true">💾</span>
              </button>
              {editingId && (
                <button type="button" className="pp-icon-btn" onClick={() => { setEditingId(null); setForm(DEFAULT_FORM); }}
                  title={t('common.cancel')} aria-label={t('common.cancel')}>
                  <span aria-hidden="true">✕</span>
                </button>
              )}
            </div>
          </div>

          <div className="pp-form-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          <div ref={basicInfoRef} className="pp-section-anchor">
          <Section title={t('page.paperProfiles.basicInfo')} icon="📄" open={sectionsOpen.basicInfo} onToggle={() => toggleSection('basicInfo')}>
            <div className="pp-form-grid pp-form-grid--two">
              <div>
                <label style={s.label}>{t('page.paperProfiles.codeLabel')}</label>
                <input value={form.code} onChange={(e) => patch('code', e.target.value)} placeholder={t('page.paperProfiles.codePlaceholder')} style={s.input} />
              </div>
              <div>
                <label style={s.label}>{t('page.paperProfiles.nameLabel')} *</label>
                <input value={form.name} onChange={(e) => patch('name', e.target.value)} placeholder={t('page.paperProfiles.namePlaceholder')} style={s.input} />
              </div>
            </div>
          </Section>
          </div>

          <div ref={dimensionsRef} className="pp-section-anchor">
          <Section title={t('page.paperProfiles.dimensions')} icon="📐" open={sectionsOpen.dimensions} onToggle={() => toggleSection('dimensions')}>
            <div className="pp-form-grid pp-form-grid--three">
              <div>
                <label style={s.label}>{t('page.paperProfiles.displayUnitLabel')}</label>
                <select value={du} onChange={(e) => uxPatch('displayUnit', e.target.value as 'mm' | 'cm' | 'px')} style={s.sel}>
                  {DISPLAY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              {dimInput('widthMm', 'page.paperProfiles.width')}
              {dimInput('heightMm', 'page.paperProfiles.height')}
              <div>
                <label style={s.label}>{t('page.paperProfiles.orientation')}</label>
                <select value={form.orientation} onChange={(e) => {
                  const next = e.target.value as 'portrait' | 'landscape';
                  if (next === form.orientation) return;
                  const natural = form.widthMm > form.heightMm ? 'landscape' : 'portrait';
                  if (next !== natural) {
                    const w = form.widthMm;
                    setForm((f) => ({ ...f, widthMm: f.heightMm, heightMm: w, orientation: next }));
                  } else {
                    patch('orientation', next);
                  }
                }} style={s.sel}>
                  <option value="portrait">{t('page.paperProfiles.portrait')}</option>
                  <option value="landscape">{t('page.paperProfiles.landscape')}</option>
                </select>
              </div>
              <div>
                <label style={s.label}>{t('page.paperProfiles.dpi')}</label>
                <select value={form.dpi} onChange={(e) => numeric('dpi', e.target.value)} style={s.sel}>
                  {DPI_OPTIONS.map((d) => <option key={d} value={d}>{d} dpi</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>{t('page.paperProfiles.unitStorageLabel')}</label>
                <select value={form.unit} onChange={(e) => patch('unit', e.target.value as 'mm' | 'inch')} style={s.sel}>
                  <option value="mm">mm</option>
                  <option value="inch">inch</option>
                </select>
              </div>
            </div>
          </Section>
          </div>

          <div ref={marginsRef} className="pp-section-anchor">
          <Section title={t('page.paperProfiles.margins')} icon="⬜" defaultOpen={false} open={sectionsOpen.margins} onToggle={() => toggleSection('margins')}>
            <div className="pp-form-grid pp-form-grid--four">
              {dimInput('marginTopMm', 'page.paperProfiles.top')}
              {dimInput('marginRightMm', 'page.paperProfiles.right')}
              {dimInput('marginBottomMm', 'page.paperProfiles.bottom')}
              {dimInput('marginLeftMm', 'page.paperProfiles.left')}
            </div>
          </Section>
          </div>

          {/* ── Dynamic fields (inline in form) ── */}
          <div ref={fieldsRef} className="pp-section-anchor">
          <Section title={t('page.paperProfiles.fieldsCount').replace('{n}', String(ux.dynamicFields.length))} icon='⚡' open={sectionsOpen.fields} onToggle={() => toggleSection('fields')}>
            {ux.dynamicFields.length === 0 && (
              <div className="pp-fields-empty">
                <div className="pp-fields-empty__copy">
                  <span className="pp-fields-empty__icon" aria-hidden="true">⚡</span>
                  <div>
                    <strong>{t('page.paperProfiles.noCustomFields')}</strong>
                    <p>{t('page.paperProfiles.clickAddField')}</p>
                  </div>
                </div>
                <button type="button" className="pp-tool-btn" onClick={addField}
                  title={t('page.paperProfiles.addField')} aria-label={t('page.paperProfiles.addField')}>+</button>
              </div>
            )}
            <div className="pp-field-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {ux.dynamicFields.map((f) => (
                <div key={f.id} className="pp-field-row" style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa', position: 'relative' }}>
                  <div className="pp-field-row__primary" style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
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
                    <button type="button" style={s.btnDanger} onClick={() => delField(f.id)} title={t('page.paperProfiles.remove')} aria-label={t('page.paperProfiles.remove')}>✕</button>
                  </div>
                  <div className="pp-field-row__secondary" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input placeholder={t('page.paperProfiles.fieldDefault')} value={f.defaultValue} onChange={(e) => updField(f.id, { defaultValue: e.target.value })}
                      style={{ ...s.smallInput, width: 80 }} />
                    <label style={{ fontSize: '0.7rem', color: '#6b7280' }}>X:</label>
                    <input type="number" value={f.xMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }}
                      style={{ ...s.smallInput, width: 50 }} />
                    <label style={{ fontSize: '0.7rem', color: '#6b7280' }}>Y:</label>
                    <input type="number" value={f.yMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }}
                      style={{ ...s.smallInput, width: 50 }} />
                    <input type="number" value={f.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: v }); }}
                      style={{ ...s.smallInput, width: 50 }} title={t('page.paperProfiles.fieldFontSizePt')} />
                    <input type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })}
                      style={{ width: 28, height: 24, padding: 0, border: '1px solid #d1d5db', borderRadius: 3, cursor: 'pointer' }} />
                    <select value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })}
                      style={{ ...s.sel, width: 60, padding: '0.25rem 0.3rem', fontSize: '0.7rem' }}>
                      <option value="left">⬅</option><option value="center">⬡</option><option value="right">➡</option>
                    </select>
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                      <input type="checkbox" checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} /> {t('page.paperProfiles.fieldBoldLabel')}
                    </label>
                  </div>
                </div>
              ))}
            </div>
            {ux.dynamicFields.length > 0 && (
              <button type="button" className="pp-add-field" style={{ ...s.btnSmall, marginTop: '0.5rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#93c5fd' }}
                onClick={addField} title={t('page.paperProfiles.addField')} aria-label={t('page.paperProfiles.addField')}><span aria-hidden="true">+</span></button>
            )}
          </Section>
          </div>

          </div> {/* end scrollable area */}
        </div> {/* end form panel */}

        {/* ===== RIGHT: Preview ===== */}
        <aside className={'pp-preview-panel' + (!showPreview ? ' pp-preview-panel--collapsed' : '')}>
            {/* Collapsed strip */}
            <div className="pp-preview-panel__strip">
              <button
                className="pp-preview-strip-btn"
                onClick={() => setShowPreview(true)}
                title={t('page.paperProfiles.togglePreview')}
                aria-label={t('page.paperProfiles.togglePreview')}
              >▶</button>
              <span className="pp-preview-strip-label">{t('page.paperProfiles.previewStrip')}</span>
            </div>

            {/* Full preview body */}
            {showPreview && <div className="pp-preview-panel__body" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="pp-preview-header">
              <span className="pp-preview-header__title">{t('page.paperProfiles.preview')}</span>
              <div className="pp-preview-header__actions">
                <span className="pp-preview-header__size">
                  {displayVal(form.widthMm, du, dpi)} × {displayVal(form.heightMm, du, dpi)} {du}
                </span>
                <IconButton icon="◀" label={t('page.paperProfiles.togglePreview')} onClick={() => setShowPreview(false)} />
              </div>
            </div>
            <div className="pp-preview-stage">
              <div className="pp-preview-stage__meta">
                <span>{t('page.paperProfiles.previewCanvas')}</span>
                <span>{form.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</span>
              </div>
              <PreviewSheet form={form} ux={ux} scale={scale} />
            </div>

            {/* Quick info */}
            <div className="pp-preview-quick-info">
              <span>{t('page.paperProfiles.quickSize')}: {form.widthMm} × {form.heightMm} mm</span>
              <span>{t('page.paperProfiles.quickDpi')}: {form.dpi}</span>
              <span>{t('page.paperProfiles.quickPrintable')}: {(form.widthMm - form.marginLeftMm - form.marginRightMm).toFixed(1)} × {(form.heightMm - form.marginTopMm - form.marginBottomMm).toFixed(1)} mm</span>
              <span>{t('page.paperProfiles.quickPixels')}: {Math.round(toPx(form.widthMm, form.dpi))} × {Math.round(toPx(form.heightMm, form.dpi))} px</span>
              <span>{t('page.paperProfiles.quickScale')}: {scale.toFixed(2)}x</span>
              <span>{t('page.paperProfiles.quickFields')}: {ux.dynamicFields.length}</span>
            </div>
            </div>}
        </aside>
      </div>

      {previewOpen && (
        <div
          className="paper-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="paper-preview-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewOpen(false);
          }}
        >
          <div className="paper-preview-modal__panel">
            <header className="paper-preview-modal__header">
              <div>
                <h2 id="paper-preview-title">{t('page.paperProfiles.fullPreviewTitle')}</h2>
                <p>{t('page.paperProfiles.dragHint')}</p>
              </div>
              <button type="button" style={s.btnSmall} onClick={() => setPreviewOpen(false)}>
                {t('page.paperProfiles.closePreview')}
              </button>
            </header>

            <div className="paper-preview-modal__body">
              <section ref={previewCanvasRef} className="paper-preview-modal__canvas" aria-label={t('page.paperProfiles.previewCanvas')}>
                <div className="paper-preview-modal__canvas-label">
                  <span>{t('page.paperProfiles.previewCanvas')}</span>
                  <span>{form.widthMm} × {form.heightMm} mm · {form.dpi} DPI</span>
                </div>
                <div ref={modalStageRef} className="paper-preview-modal__sheet-stage">
                  <PreviewSheet
                    form={form}
                    ux={ux}
                    scale={modalScale}
                    rotateSheet
                    sheetRef={previewSheetRef}
                    selectedFieldId={selectedFieldId}
                    onFieldPointerDown={startDraggingField}
                    onFieldSelect={setSelectedFieldId}
                  />
                </div>
                <div className="paper-preview-modal__canvas-meta">
                  <span>{t('page.paperProfiles.quickPrintable')}: {(form.widthMm - form.marginLeftMm - form.marginRightMm).toFixed(1)} × {(form.heightMm - form.marginTopMm - form.marginBottomMm).toFixed(1)} mm</span>
                  <span>{t('page.paperProfiles.quickFields')}: {ux.dynamicFields.length}</span>
                  <span>{t('page.paperProfiles.quickScale')}: {modalScale.toFixed(2)}x</span>
                </div>
              </section>

              <aside className="paper-preview-modal__controls">
                <div className="paper-preview-modal__controls-heading">
                  <div>
                    <h3>{t('page.paperProfiles.positionFields')}</h3>
                    <p>{t('page.paperProfiles.positionFieldsHint')}</p>
                  </div>
                  <button
                    type="button"
                    className="pp-tool-btn"
                    onClick={addField}
                    title={t('page.paperProfiles.addField')}
                    aria-label={t('page.paperProfiles.addField')}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
                {ux.dynamicFields.length === 0 && (
                  <p className="paper-preview-modal__empty">{t('page.paperProfiles.noCustomFields')}</p>
                )}
                <div className="paper-preview-modal__field-list">
                  {ux.dynamicFields.map((f) => (
                    <div
                      key={f.id}
                      className={'paper-preview-modal__field' + (selectedFieldId === f.id ? ' is-selected' : '')}
                      onClick={() => setSelectedFieldId(f.id)}
                    >
                      <div className="paper-preview-modal__field-heading">
                        <code>{f.key || t('page.paperProfiles.noKey')}</code>
                        <button type="button" style={s.btnDanger} onClick={() => delField(f.id)}>
                          {t('page.paperProfiles.remove')}
                        </button>
                      </div>
                      <div className="paper-preview-modal__field-grid">
                        <label>{t('page.paperProfiles.fieldKey')}<input value={f.key} onChange={(e) => updField(f.id, { key: e.target.value })} /></label>
                        <label>{t('page.paperProfiles.fieldLabel')}<input value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })} /></label>
                        <label>{t('page.paperProfiles.positionX')}<input type="number" step="0.1" value={f.xMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }} /></label>
                        <label>{t('page.paperProfiles.positionY')}<input type="number" step="0.1" value={f.yMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }} /></label>
                        <label>{t('page.paperProfiles.fontSize')}<input type="number" min={6} max={72} value={f.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: v }); }} /></label>
                        <label>{t('page.paperProfiles.align')}<select value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })}><option value="left">{t('page.paperProfiles.alignLeft')}</option><option value="center">{t('page.paperProfiles.alignCenter')}</option><option value="right">{t('page.paperProfiles.alignRight')}</option></select></label>
                      </div>
                      <div className="paper-preview-modal__field-footer">
                        <label><input type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })} /> {t('page.paperProfiles.fieldColor')}</label>
                        <label><input type="checkbox" checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} /> {t('page.paperProfiles.bold')}</label>
                        <span>{f.xMm.toFixed(1)} × {f.yMm.toFixed(1)} mm</span>
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}

      {/* ─── Drawer: Fields ─── */}
      {showDrawer === 'fields' && (
        <>
          <div className="pp-drawer-backdrop" onClick={() => setShowDrawer(null)} />
          <div className="pp-drawer" role="dialog" aria-modal="true" aria-label={t('page.paperProfiles.dynamicFieldsEditor')}>
          <div className="pp-drawer__header">
            <span className="pp-drawer__title">{t('page.paperProfiles.dynamicFieldsEditor')}</span>
            <button className="pp-tool-btn" style={{ width: 28, height: 26, fontSize: '0.8rem' }}
              title={t('common.cancel')} aria-label={t('common.cancel')}
              onClick={() => setShowDrawer(null)}>✕</button>
          </div>
          <div className="pp-drawer__body">
            {ux.dynamicFields.length === 0 && (
              <p style={{ fontSize: '0.85rem', color: '#9ca3af', textAlign: 'center', marginTop: '2rem' }}>
                {t('page.paperProfiles.fieldsDrawerEmpty')}<br />{t('page.paperProfiles.clickAddField')}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {ux.dynamicFields.map((f) => (
                <div key={f.id} style={{ padding: '0.65rem', border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <code style={{ fontSize: '0.8rem', fontWeight: 600 }}>{f.key || t('page.paperProfiles.noKey')}</code>
                    <button style={s.btnDanger} onClick={() => delField(f.id)}>{t('page.paperProfiles.remove')}</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', fontSize: '0.75rem' }}>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fieldLabel')}</label><input value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fieldType')}</label><select value={f.type} onChange={(e) => updField(f.id, { type: e.target.value as DynamicField['type'] })} style={{ ...s.sel, padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}><option value="text">Text</option><option value="barcode">Barcode</option><option value="date">Date</option><option value="number">Number</option></select></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fieldDefault')}</label><input value={f.defaultValue} onChange={(e) => updField(f.id, { defaultValue: e.target.value })} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fontSize')}</label><input type="number" value={f.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: v }); }} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.positionX')}</label><input type="number" value={f.xMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.positionY')}</label><input type="number" value={f.yMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }} style={s.smallInput} /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fieldColor')}</label><input type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })} style={{ width: '100%', height: 28, padding: 0, border: '1px solid #d1d5db', borderRadius: 4 }} /></div>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.align')}</label><select value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })} style={{ ...s.sel, padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}><option value="left">{t('page.paperProfiles.alignLeft')}</option><option value="center">{t('page.paperProfiles.alignCenter')}</option><option value="right">{t('page.paperProfiles.alignRight')}</option></select></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', gridColumn: '1 / -1' }}>
                      <input type="checkbox" id={'bold-'+f.id} checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} />
                      <label htmlFor={'bold-'+f.id} style={{ fontSize: '0.75rem' }}>{t('page.paperProfiles.bold')}</label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button style={{ ...s.btnSmall, marginTop: '0.75rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#93c5fd' }}
              onClick={addField}>{t('page.paperProfiles.addField')}</button>
          </div>
          </div>
        </>
      )}

      {/* ─── Drawer: Appearance ─── */}
      {showDrawer === 'appearance' && (
        <>
          <div className="pp-drawer-backdrop" onClick={() => setShowDrawer(null)} />
          <div className="pp-drawer" role="dialog" aria-modal="true" aria-label={t('page.paperProfiles.appearanceStyle')}>
          <div className="pp-drawer__header">
            <span className="pp-drawer__title">{t('page.paperProfiles.appearanceStyle')}</span>
            <button className="pp-tool-btn" style={{ width: 28, height: 26, fontSize: '0.8rem' }}
              title={t('common.cancel')} aria-label={t('common.cancel')}
              onClick={() => setShowDrawer(null)}>✕</button>
          </div>
          <div className="pp-drawer__body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={s.label}>{t('page.paperProfiles.fontFamily')}</label>
                <select value={ux.fontFamily} onChange={(e) => uxPatch('fontFamily', e.target.value)} style={s.sel}>
                  {FONT_LIST.map((f) => <option key={f} value={f}>{f.replace(/['"]/g, '')}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={s.label}>{t('page.paperProfiles.fontSize')}</label>
                  <input type="number" value={ux.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) uxPatch('fontSize', v); }}
                    style={s.input} min={6} max={72} />
                </div>
                <div>
                  <label style={s.label}>{t('page.paperProfiles.fontWeight')}</label>
                  <select value={ux.fontWeight} onChange={(e) => uxPatch('fontWeight', e.target.value as 'normal' | 'bold')} style={s.sel}>
                    <option value="normal">{t('page.paperProfiles.normal')}</option>
                    <option value="bold">{t('page.paperProfiles.bold')}</option>
                  </select>
                </div>
              </div>
              <ColorInput label={t('page.paperProfiles.fontColor')} value={ux.fontColor} onChange={(v) => uxPatch('fontColor', v)} />
              <ColorInput label={t('page.paperProfiles.background')} value={ux.bgColor} onChange={(v) => uxPatch('bgColor', v)} />
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.5rem' }}>
                <label style={s.label}>{t('page.paperProfiles.watermarkText')}</label>
                <input value={ux.watermarkText} onChange={(e) => uxPatch('watermarkText', e.target.value)}
                  placeholder={t('page.paperProfiles.watermarkPlaceholder')} style={s.input} />
              </div>
              <div>
                <label style={s.label}>{t('page.paperProfiles.watermarkOpacity')}: {ux.watermarkOpacity}%</label>
                <input type="range" min={0} max={50} value={ux.watermarkOpacity}
                  onChange={(e) => uxPatch('watermarkOpacity', parseInt(e.target.value))}
                  style={{ width: '100%' }} />
              </div>
            </div>
          </div>
          </div>
        </>
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
                {[t('page.paperProfiles.codeLabel'), t('page.paperProfiles.nameLabel'), t('page.paperProfiles.size'), t('page.paperProfiles.marginsHeader'), t('page.paperProfiles.orient'), t('page.paperProfiles.dpi'), t('page.paperProfiles.actions')].map((h) => (
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
                    {t('page.paperProfiles.noProfiles')}
                  </td>
                </tr>
              )}
              {profiles.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem 0.6rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.code}</td>
                  <td style={{ padding: '0.5rem 0.6rem' }}>{p.name}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.widthMm}×{p.heightMm}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.7rem', color: '#6b7280' }}>{p.marginTopMm}/{p.marginRightMm}/{p.marginBottomMm}/{p.marginLeftMm}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</td>
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
    </div>
  );
}
