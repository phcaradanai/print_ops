import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

// ── Types ──────────────────────────────────────────────────────────
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function nextSaveStatus(current: SaveStatus, action: 'dirty' | 'save' | 'success' | 'fail' | 'reset'): SaveStatus {
  switch (action) {
    case 'dirty': return current === 'idle' || current === 'saved' || current === 'error' ? 'dirty' : current;
    case 'save': return current !== 'saving' ? 'saving' : current;
    case 'success': return 'saved';
    case 'fail': return 'error';
    case 'reset': return 'idle';
    default: return current;
  }
}

interface PaperFormForValidation {
  name: string; widthMm: number; heightMm: number; dpi: number;
  marginTopMm: number; marginRightMm: number; marginBottomMm: number; marginLeftMm: number;
}
interface ValidationError {
  field: string;
  messageKey: string;
}
export function validatePaperForm(form: PaperFormForValidation): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!form.name.trim()) errors.push({ field: 'name', messageKey: 'validation.nameRequired' });
  if (form.widthMm <= 0) errors.push({ field: 'widthMm', messageKey: 'validation.dimensionsPositive' });
  if (form.heightMm <= 0) errors.push({ field: 'heightMm', messageKey: 'validation.dimensionsPositive' });
  if (form.dpi <= 0) errors.push({ field: 'dpi', messageKey: 'validation.dpiPositive' });
  if (form.marginTopMm < 0) errors.push({ field: 'marginTopMm', messageKey: 'validation.marginsNonNegative' });
  if (form.marginRightMm < 0) errors.push({ field: 'marginRightMm', messageKey: 'validation.marginsNonNegative' });
  if (form.marginBottomMm < 0) errors.push({ field: 'marginBottomMm', messageKey: 'validation.marginsNonNegative' });
  if (form.marginLeftMm < 0) errors.push({ field: 'marginLeftMm', messageKey: 'validation.marginsNonNegative' });
  if (form.marginLeftMm + form.marginRightMm >= form.widthMm) errors.push({ field: 'margins', messageKey: 'validation.marginsExceedWidth' });
  if (form.marginTopMm + form.marginBottomMm >= form.heightMm) errors.push({ field: 'margins', messageKey: 'validation.marginsExceedHeight' });
  return errors;
}

export function resolveSelectionAfterDelete(
  fields: { id: string }[],
  deletedId: string,
  currentSelectedId: string | null,
): string | null {
  if (currentSelectedId !== deletedId) return currentSelectedId;
  const remaining = fields.filter((f) => f.id !== deletedId);
  return remaining.length > 0 ? remaining[0].id : null;
}

/** Center a field's xMm anchor at printableWidth/2. Handles rotated geometry via full round-trip. */
export function centerFieldAnchorHorizontal(
  field: { xMm: number; yMm: number },
  geometry: VisualPaperGeometry,
): { xMm: number; yMm: number } {
  const visualPoint = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
  const visualCenterX = Number((geometry.printableWidthMm / 2).toFixed(1));
  return mapVisualPointToPrintable(visualCenterX, visualPoint.yMm, geometry);
}

/** Center a field's yMm anchor at printableHeight/2. Handles rotated geometry via full round-trip. */
export function centerFieldAnchorVertical(
  field: { xMm: number; yMm: number },
  geometry: VisualPaperGeometry,
): { xMm: number; yMm: number } {
  const visualPoint = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
  const visualCenterY = Number((geometry.printableHeightMm / 2).toFixed(1));
  return mapVisualPointToPrintable(visualPoint.xMm, visualCenterY, geometry);
}

/** Compute CSS transform for a text anchor position. Always uses translateX — rotation-safe behavior comes from point mapping, not changing the text anchor axis. */
export function anchorTransform(
  align: 'left' | 'center' | 'right',
  _rotated: boolean,
): string | undefined {
  if (align === 'center') return 'translateX(-50%)';
  if (align === 'right') return 'translateX(-100%)';
  return undefined; // left => no translate needed
}

/** Get the CSS transform-origin for a text anchor, safe when composed with rotation. */
export function anchorTransformOrigin(align: 'left' | 'center' | 'right'): string {
  if (align === 'center') return 'center center';
  if (align === 'right') return 'right center';
  return 'left center';
}

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

export type PaperOrientation = 'portrait' | 'landscape';

export interface VisualPaperGeometry {
  rotated: boolean;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  sourcePrintableWidthMm: number;
  sourcePrintableHeightMm: number;
  printableWidthMm: number;
  printableHeightMm: number;
}

export function getVisualPaperGeometry(form: Pick<PaperForm, 'widthMm' | 'heightMm' | 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm' | 'orientation'>): VisualPaperGeometry {
  const natural = form.widthMm > form.heightMm ? 'landscape' : 'portrait';
  const rotated = natural !== form.orientation;
  const marginTopMm = rotated ? form.marginLeftMm : form.marginTopMm;
  const marginRightMm = rotated ? form.marginTopMm : form.marginRightMm;
  const marginBottomMm = rotated ? form.marginRightMm : form.marginBottomMm;
  const marginLeftMm = rotated ? form.marginBottomMm : form.marginLeftMm;
  const widthMm = rotated ? form.heightMm : form.widthMm;
  const heightMm = rotated ? form.widthMm : form.heightMm;
  const sourcePrintableWidthMm = Math.max(0, form.widthMm - form.marginLeftMm - form.marginRightMm);
  const sourcePrintableHeightMm = Math.max(0, form.heightMm - form.marginTopMm - form.marginBottomMm);
  return {
    rotated,
    widthMm,
    heightMm,
    marginTopMm,
    marginRightMm,
    marginBottomMm,
    marginLeftMm,
    sourcePrintableWidthMm,
    sourcePrintableHeightMm,
    printableWidthMm: Math.max(0, widthMm - marginLeftMm - marginRightMm),
    printableHeightMm: Math.max(0, heightMm - marginTopMm - marginBottomMm),
  };
}

/** Map a field/grid point between the stored and visual printable spaces. */
export function mapPrintablePointToVisual(
  xMm: number,
  yMm: number,
  geometry: Pick<VisualPaperGeometry, 'rotated' | 'sourcePrintableHeightMm'>,
) {
  if (!geometry.rotated) return { xMm, yMm };
  return { xMm: geometry.sourcePrintableHeightMm - yMm, yMm: xMm };
}

/** Inverse of mapPrintablePointToVisual. */
export function mapVisualPointToPrintable(
  xMm: number,
  yMm: number,
  geometry: Pick<VisualPaperGeometry, 'rotated' | 'sourcePrintableHeightMm'>,
) {
  if (!geometry.rotated) return { xMm, yMm };
  return { xMm: yMm, yMm: geometry.sourcePrintableHeightMm - xMm };
}

export function nudgePrintablePoint(
  xMm: number,
  yMm: number,
  deltaVisualXmm: number,
  deltaVisualYmm: number,
  geometry: VisualPaperGeometry,
) {
  const visualPoint = mapPrintablePointToVisual(xMm, yMm, geometry);
  const visualX = Math.max(0, Math.min(geometry.printableWidthMm, visualPoint.xMm + deltaVisualXmm));
  const visualY = Math.max(0, Math.min(geometry.printableHeightMm, visualPoint.yMm + deltaVisualYmm));
  const printablePoint = mapVisualPointToPrintable(visualX, visualY, geometry);
  return {
    xMm: Number(printablePoint.xMm.toFixed(1)),
    yMm: Number(printablePoint.yMm.toFixed(1)),
  };
}

export function clampGridSpacing(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function clampPreviewZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.5, Math.min(4, Math.round(value * 100) / 100));
}

export function stepPreviewZoom(value: number, direction: -1 | 1): number {
  return clampPreviewZoom(value + direction * 0.25);
}

export function fontPointSizeToPreviewPixels(fontSizePt: number, pixelsPerMm: number): number {
  if (!Number.isFinite(fontSizePt) || !Number.isFinite(pixelsPerMm) || fontSizePt <= 0 || pixelsPerMm <= 0) return 0;
  return (fontSizePt * 25.4 * pixelsPerMm) / 72;
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
  // NOTE: Only 'text' type is currently rendered. Other types are reserved for future rendering support.
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
  btnDanger: { padding: '0.3rem 0.6rem', border: '1px solid #f38ba8', borderRadius: 4, background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '0.75rem' } as React.CSSProperties,
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
        <span style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '0.75rem', color: '#6b7280' }}>▶</span>
        {icon && <span style={{ fontSize: '0.85rem' }}>{icon}</span>}
        {title}
        <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: '0.75rem' }}>{isOpen ? '−' : '+'}</span>
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
  disabled = false,
  disabledReason,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      className={'pp-icon-btn' + (active ? ' pp-icon-btn--active' : '')}
      title={disabled ? (disabledReason || label) : label}
      aria-label={disabled ? (disabledReason ? `${label}: ${disabledReason}` : label) : label}
      onClick={onClick}
      disabled={disabled}
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

// ── Ruler wrapper around the paper preview ─────────────────────────
function RulerSheet({
  form,
  scale,
  showRulers,
  unit,
  children,
}: {
  form: PaperForm;
  scale: number;
  showRulers: boolean;
  unit: 'mm' | 'cm' | 'px';
  children: React.ReactNode;
}) {
  if (!showRulers) return <>{children}</>;

  const geometry = getVisualPaperGeometry(form);
  const pvW = geometry.widthMm * scale;
  const pvH = geometry.heightMm * scale;
  const rulerThickness = 24;
  const fontSize = Math.min(10, Math.max(7, scale * 2));

  // Tick intervals in mm
  const majorTickMm = 10;
  const minorTickMm = 5;

  function tickLabel(vMm: number): string {
    if (unit === 'cm') return `${(vMm / 10).toFixed(1)} cm`;
    if (unit === 'px') return `${Math.round((vMm * form.dpi) / 25.4)} px`;
    return `${Math.round(vMm)} mm`;
  }

  function renderTicks(totalMm: number, vertical: boolean): React.ReactNode[] {
    const ticks: React.ReactNode[] = [];
    const totalPx = totalMm * scale;
    for (let mmJ = 0; mmJ <= totalMm; mmJ += majorTickMm) {
      const pos = mmJ * scale;
      if (pos > totalPx) break;
      ticks.push(
        <div key={`major-${mmJ}`} style={{
          position: 'absolute',
          ...(vertical
            ? { top: pos, left: 0, height: 0, width: '100%', borderBottom: '1px solid #6b7280' }
            : { left: pos, top: 0, width: 0, height: '100%', borderLeft: '1px solid #6b7280' }
          ),
        }}>
          <span style={{
            position: 'absolute',
            fontSize: `${fontSize}px`,
            color: '#374151',
            ...(vertical
              ? {
                top: mmJ === 0 ? 2 : mmJ >= totalMm ? -2 : 0,
                right: 4,
                transform: mmJ === 0 ? undefined : mmJ >= totalMm ? 'translateY(-100%)' : 'translateY(-50%)',
                textAlign: 'right' as const,
                whiteSpace: 'nowrap',
              }
              : {
                left: mmJ === 0 ? 2 : mmJ >= totalMm ? -2 : 0,
                top: 2,
                transform: mmJ === 0 ? undefined : mmJ >= totalMm ? 'translateX(-100%)' : 'translateX(-50%)',
                whiteSpace: 'nowrap',
              }
            ),
          }}>{tickLabel(mmJ)}</span>
        </div>
      );
    }
    if (minorTickMm < majorTickMm) {
      for (let mmJ = minorTickMm; mmJ <= totalMm; mmJ += minorTickMm) {
        if (mmJ % majorTickMm === 0) continue;
        const pos = mmJ * scale;
        if (pos > totalPx) break;
        ticks.push(
          <div key={`minor-${mmJ}`} style={{
            position: 'absolute',
            ...(vertical
              ? { top: pos, left: 0, height: 0, width: '40%', borderBottom: '1px solid #d1d5db' }
              : { left: pos, top: 0, width: 0, height: '40%', borderLeft: '1px solid #d1d5db' }
            ),
          }} />
        );
      }
    }
    return ticks;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 0, width: rulerThickness + pvW, flexShrink: 0 }}>
      {/* Top row: corner cell + horizontal ruler */}
      <div style={{ display: 'flex', flexDirection: 'row' as const, gap: 0 }}>
        {/* Corner cell: zero origin intersection */}
        <div style={{
          width: rulerThickness,
          height: rulerThickness,
          borderRight: '1px solid #d1d5db',
          borderBottom: '1px solid #d1d5db',
          background: '#f9fafb',
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          color: '#374151',
          fontSize: `${fontSize}px`,
          fontWeight: 600,
        }}>
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
            <span>0</span>
            <span style={{ fontSize: `${Math.max(7, fontSize - 1)}px`, fontWeight: 500 }}>{unit}</span>
          </span>
        </div>
        {/* Horizontal ruler */}
        <div style={{
          height: rulerThickness,
          flex: 1,
          width: pvW,
          flexShrink: 0,
          borderBottom: '1px solid #d1d5db',
          position: 'relative' as const,
          overflow: 'hidden',
          background: '#f9fafb',
        }}>
          <div style={{ width: pvW, height: rulerThickness, position: 'relative' as const }}>
            {renderTicks(geometry.widthMm, false)}
          </div>
        </div>
      </div>
      {/* Bottom row: vertical ruler + paper */}
      <div style={{ display: 'flex', flexDirection: 'row' as const, gap: 0 }}>
        <div style={{
          width: rulerThickness,
          borderRight: '1px solid #d1d5db',
          position: 'relative' as const,
          background: '#f9fafb',
          overflow: 'hidden',
          height: pvH,
          flexShrink: 0,
        }}>
          <div style={{ width: rulerThickness, height: pvH, position: 'relative' as const }}>
            {renderTicks(geometry.heightMm, true)}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function PreviewSheet({
  form,
  ux,
  scale,
  sheetRef,
  selectedFieldId,
  onFieldPointerDown,
  onFieldSelect,
  onFieldNudge,
  showVerticalGrid = false,
  showHorizontalGrid = false,
  showAlignmentGuides = false,
  gridIntervalMm = 10,
}: {
  form: PaperForm;
  ux: UxOptions;
  scale: number;
  sheetRef?: React.RefObject<HTMLDivElement>;
  selectedFieldId?: string | null;
  onFieldPointerDown?: (event: React.PointerEvent<HTMLButtonElement>, id: string) => void;
  onFieldSelect?: (id: string) => void;
  onFieldNudge?: (id: string, deltaVisualXmm: number, deltaVisualYmm: number) => void;
  showVerticalGrid?: boolean;
  showHorizontalGrid?: boolean;
  showAlignmentGuides?: boolean;
  gridIntervalMm?: number;
}) {
  const geometry = getVisualPaperGeometry(form);
  const pvW = geometry.widthMm * scale;
  const pvH = geometry.heightMm * scale;
  const pvMT = geometry.marginTopMm * scale;
  const pvMR = geometry.marginRightMm * scale;
  const pvMB = geometry.marginBottomMm * scale;
  const pvML = geometry.marginLeftMm * scale;
  const pvPrintW = geometry.printableWidthMm * scale;
  const pvPrintH = geometry.printableHeightMm * scale;
  const interactive = Boolean(onFieldPointerDown || onFieldSelect || onFieldNudge);

  // Compute grid lines
  const gridLinesVertical: number[] = [];
  const gridLinesHorizontal: number[] = [];
  if (showVerticalGrid || showHorizontalGrid) {
    for (let x = gridIntervalMm; x < geometry.printableWidthMm; x += gridIntervalMm) {
      if (showVerticalGrid) gridLinesVertical.push(x);
    }
    for (let y = gridIntervalMm; y < geometry.printableHeightMm; y += gridIntervalMm) {
      if (showHorizontalGrid) gridLinesHorizontal.push(y);
    }
  }

  // Alignment guide positions
  const selectedField = selectedFieldId
    ? ux.dynamicFields.find((f) => f.id === selectedFieldId)
    : null;
  const selectedPoint = selectedField
    ? mapPrintablePointToVisual(selectedField.xMm, selectedField.yMm, geometry)
    : null;
  const guideX = selectedPoint ? selectedPoint.xMm * scale : null;
  const guideY = selectedPoint ? selectedPoint.yMm * scale : null;

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
      }}
    >
      {ux.watermarkText && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: geometry.widthMm * scale * 0.08, color: ux.fontColor,
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
        {/* Grid lines */}
        {gridLinesVertical.map((x) => (
          <div key={`vg-${x}`} style={{
            position: 'absolute', left: x * scale, top: 0,
            width: 0, height: '100%',
            borderLeft: '1px solid rgba(0,0,0,0.08)',
            pointerEvents: 'none', zIndex: 0,
          }} />
        ))}
        {gridLinesHorizontal.map((y) => (
          <div key={`hg-${y}`} style={{
            position: 'absolute', left: 0, top: y * scale,
            height: 0, width: '100%',
            borderTop: '1px solid rgba(0,0,0,0.08)',
            pointerEvents: 'none', zIndex: 0,
          }} />
        ))}

        {/* Alignment guides */}
        {showAlignmentGuides && guideX !== null && (
          <div style={{
            position: 'absolute', left: guideX, top: 0,
            width: 0, height: '100%',
            borderLeft: '1px dashed rgba(30,102,245,0.5)',
            pointerEvents: 'none', zIndex: 3,
          }} />
        )}
        {showAlignmentGuides && guideY !== null && (
          <div style={{
            position: 'absolute', left: 0, top: guideY,
            height: 0, width: '100%',
            borderTop: '1px dashed rgba(30,102,245,0.5)',
            pointerEvents: 'none', zIndex: 3,
          }} />
        )}

        {ux.dynamicFields.map((f) => (
          (() => {
            const point = mapPrintablePointToVisual(f.xMm, f.yMm, geometry);
            return (
          <button
            key={f.id}
            type="button"
            aria-label={`${f.key || f.label || 'field'} at ${f.xMm}, ${f.yMm} mm`}
            onPointerDown={interactive ? (event) => onFieldPointerDown?.(event, f.id) : undefined}
            onClick={interactive ? () => onFieldSelect?.(f.id) : undefined}
            onKeyDown={onFieldNudge ? (event) => {
              const stepMm = event.shiftKey ? 1 : 0.1;
              const delta = event.key === 'ArrowLeft' ? [-stepMm, 0]
                : event.key === 'ArrowRight' ? [stepMm, 0]
                  : event.key === 'ArrowUp' ? [0, -stepMm]
                    : event.key === 'ArrowDown' ? [0, stepMm]
                      : null;
              if (!delta) return;
              event.preventDefault();
              onFieldNudge(f.id, delta[0], delta[1]);
            } : undefined}
            style={{
              position: 'absolute', left: point.xMm * scale, top: point.yMm * scale,
              fontSize: fontPointSizeToPreviewPixels(f.fontSize, scale), fontWeight: f.bold ? 700 : 400,
              lineHeight: 1.2,
              color: f.color, whiteSpace: 'nowrap',
              fontFamily: ux.fontFamily, pointerEvents: interactive ? 'auto' : 'none',
              cursor: interactive ? 'grab' : 'default',
              padding: interactive ? '0.15rem 0.25rem' : 0,
              border: selectedFieldId === f.id ? '1px solid #1e66f5' : '1px solid transparent',
              borderRadius: 3,
              background: selectedFieldId === f.id ? 'rgba(30,102,245,0.1)' : 'transparent',
              transform: anchorTransform(f.align, geometry.rotated),
              transformOrigin: anchorTransformOrigin(f.align),
              zIndex: 2,
            }}
          >
            {f.defaultValue || f.label || f.key || 'field'}
          </button>
            );
          })()
        ))}
      </div>

      {[{ d: pvMT, side: 'top' as const }, { d: pvMR, side: 'right' as const }, { d: pvMB, side: 'bottom' as const }, { d: pvML, side: 'left' as const }].map((m) => (
        <div key={m.side} style={{
          position: 'absolute',
          ...(m.side === 'top' ? { top: 0, left: 0, right: 0, height: m.d } : {}),
          ...(m.side === 'bottom' ? { bottom: 0, left: 0, right: 0, height: m.d } : {}),
          ...(m.side === 'left' ? { left: 0, top: 0, bottom: 0, width: m.d } : {}),
          ...(m.side === 'right' ? { right: 0, top: 0, bottom: 0, width: m.d } : {}),
          background: '#f38ba8', border: '1px solid #f38ba8', opacity: 0.12,
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [showVerticalGrid, setShowVerticalGrid] = useState(false);
  const [showHorizontalGrid, setShowHorizontalGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(false);
  const [showAlignmentGuides, setShowAlignmentGuides] = useState(false);
  const [gridSpacingMm, setGridSpacingMm] = useState(10); // 1–100 mm, default 10
  const [previewZoom, setPreviewZoom] = useState(1);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [showDrawer, setShowDrawer] = useState<'fields' | 'appearance' | null>(null);
  const [stickyNote, setStickyNote] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const previewSheetRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef({ xMm: 0, yMm: 0 });
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const modalStageRef = useRef<HTMLDivElement>(null);
  const modalPanelRef = useRef<HTMLDivElement>(null);
  const modalCloseButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [modalStageSize, setModalStageSize] = useState({ width: 0, height: 0 });
  const saveInFlightRef = useRef(false);

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
    setSaveStatus((s) => nextSaveStatus(s, 'dirty'));
    setSaveError(null);
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
      fontSize: ux.fontSize, bold: ux.fontWeight === 'bold', color: ux.fontColor, align: 'left',
    };
    setUx((current) => ({
      ...current,
      dynamicFields: [...current.dynamicFields, f],
    }));
    setSelectedFieldId(f.id);
    setStickyNote(t('page.paperProfiles.addedFieldNote'));
    setTimeout(() => setStickyNote(null), 2500);
  }
  function updField(id: string, patchFields: Partial<DynamicField>) {
    setUx((current) => ({
      ...current,
      dynamicFields: current.dynamicFields.map((f) => (f.id === id ? { ...f, ...patchFields } : f)),
    }));
  }
  function delField(id: string) {
    setUx((current) => {
      const nextDynamicFields = current.dynamicFields.filter((f) => f.id !== id);
      return { ...current, dynamicFields: nextDynamicFields };
    });
    // Resolve selection outside setUx updater to avoid StrictMode double-fire
    setSelectedFieldId((prev) => resolveSelectionAfterDelete(ux.dynamicFields, id, prev));
  }

  // ── Center helpers ────────────────────────────────────────────────
  function centerFieldHorizontal(id: string) {
    const geometry = getVisualPaperGeometry(form);
    setUx((current) => ({
      ...current,
      dynamicFields: current.dynamicFields.map((f) => {
        if (f.id !== id) return f;
        return { ...f, ...centerFieldAnchorHorizontal(f, geometry) };
      }),
    }));
    setStickyNote(t('page.paperProfiles.centerHorizontally'));
    setTimeout(() => setStickyNote(null), 2500);
  }

  function centerFieldVertical(id: string) {
    const geometry = getVisualPaperGeometry(form);
    setUx((current) => ({
      ...current,
      dynamicFields: current.dynamicFields.map((f) => {
        if (f.id !== id) return f;
        return { ...f, ...centerFieldAnchorVertical(f, geometry) };
      }),
    }));
    setStickyNote(t('page.paperProfiles.centerVertically'));
    setTimeout(() => setStickyNote(null), 2500);
  }

  function nudgeField(id: string, deltaVisualXmm: number, deltaVisualYmm: number) {
    const geometry = getVisualPaperGeometry(form);
    setUx((current) => ({
      ...current,
      dynamicFields: current.dynamicFields.map((field) => {
        if (field.id !== id) return field;
        const printablePoint = nudgePrintablePoint(
          field.xMm,
          field.yMm,
          deltaVisualXmm,
          deltaVisualYmm,
          geometry,
        );
        return {
          ...field,
          ...printablePoint,
        };
      }),
    }));
  }

  // ── API ────────────────────────────────────────────────────────────
  const load = () => apiFetch<PaperProfile[]>('/v1/paper-profiles').then(setProfiles).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function save() {
    // Prevent duplicate submission
    if (saveStatus === 'saving' || saveInFlightRef.current) return;

    const errors = validatePaperForm(form);
    if (errors.length > 0) {
      setSaveError(errors.map((e) => t(e.messageKey)).join('; '));
      setSaveStatus('error');
      return;
    }

    saveInFlightRef.current = true;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const body = { ...form, code: form.code || form.name.toLowerCase().replace(/\s+/g, '_') };
      if (editingId) {
        await apiFetch('/v1/paper-profiles/' + editingId, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/v1/paper-profiles', { method: 'POST', body: JSON.stringify(body) });
      }
      setSaveStatus('saved');
      setEditingId(null);
      setForm(DEFAULT_FORM);
      load();
    } catch (_err) {
      setSaveStatus('error');
      setSaveError(t('page.paperProfiles.saveFailed'));
    } finally {
      saveInFlightRef.current = false;
    }
  }

  function dismissSaveError() {
    setSaveError(null);
    setSaveStatus('idle');
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
    setSaveStatus('idle');
    setSaveError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function applyPreset(p: typeof PAPER_PRESETS[number]) {
    setForm((f) => ({ ...f, widthMm: p.widthMm, heightMm: p.heightMm, dpi: p.dpi }));
    setSaveStatus((s) => nextSaveStatus(s, 'dirty'));
    setPresetsOpen(false);
  }

  // ── Preview calc ───────────────────────────────────────────────────
  const maxPvSize = 320;
  const visualGeometry = getVisualPaperGeometry(form);
  const previewWidthMm = visualGeometry.widthMm;
  const previewHeightMm = visualGeometry.heightMm;
  const scale = Math.min(maxPvSize / previewWidthMm, maxPvSize / previewHeightMm, 2);

  useEffect(() => {
    if (!previewOpen) return;
    const previousOverflow = document.body.style.overflow;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOpen(false);
      if (event.key === 'Tab' && modalPanelRef.current) {
        const focusable = Array.from(modalPanelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        )).filter((element) => element.offsetParent !== null);
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setPreviewZoom((value) => stepPreviewZoom(value, 1));
      } else if (event.key === '-') {
        event.preventDefault();
        setPreviewZoom((value) => stepPreviewZoom(value, -1));
      } else if (event.key === '0') {
        event.preventDefault();
        setPreviewZoom(1);
      }
    };
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    const focusFrame = window.requestAnimationFrame(() => modalCloseButtonRef.current?.focus());
    onResize();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      window.cancelAnimationFrame(focusFrame);
      previousFocusRef.current?.focus();
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

  const fitModalScale = useMemo(() => {
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

  const modalScale = Math.max(0.25, Math.min(20, fitModalScale * previewZoom));

  useEffect(() => {
    if (!draggingFieldId) return;
    const onPointerMove = (event: PointerEvent) => {
      const sheet = previewSheetRef.current;
      if (!sheet) return;
      const rect = sheet.getBoundingClientRect();
      const geometry = getVisualPaperGeometry(form);
      const printableWidth = Math.max(0, form.widthMm - form.marginLeftMm - form.marginRightMm);
      const printableHeight = Math.max(0, form.heightMm - form.marginTopMm - form.marginBottomMm);
      const pointerX = (event.clientX - rect.left) / modalScale - geometry.marginLeftMm;
      const pointerY = (event.clientY - rect.top) / modalScale - geometry.marginTopMm;
      const visualX = Math.max(0, Math.min(geometry.printableWidthMm, pointerX - dragOffsetRef.current.xMm));
      const visualY = Math.max(0, Math.min(geometry.printableHeightMm, pointerY - dragOffsetRef.current.yMm));
      const originalPoint = mapVisualPointToPrintable(visualX, visualY, geometry);
      let xMm = Math.min(printableWidth, Math.max(0, originalPoint.xMm));
      let yMm = Math.min(printableHeight, Math.max(0, originalPoint.yMm));

      // Snap to nearby field Y (baseline) and X (column) within 2mm tolerance
      const snapThreshold = 2;
      const otherFields = ux.dynamicFields.filter((f) => f.id !== draggingFieldId);
      for (const o of otherFields) {
        if (Math.abs(o.yMm - yMm) < snapThreshold) yMm = o.yMm;
        if (Math.abs(o.xMm - xMm) < snapThreshold) xMm = o.xMm;
      }

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
  }, [draggingFieldId, form.heightMm, form.marginBottomMm, form.marginLeftMm, form.marginRightMm, form.marginTopMm, form.widthMm, modalScale, ux.dynamicFields]);

  function startDraggingField(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    event.currentTarget.focus();
    event.preventDefault();
    const sheet = previewSheetRef.current;
    const field = ux.dynamicFields.find((candidate) => candidate.id === id);
    if (sheet && field) {
      const geometry = getVisualPaperGeometry(form);
      const rect = sheet.getBoundingClientRect();
      const point = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
      const pointerX = (event.clientX - rect.left) / modalScale - geometry.marginLeftMm;
      const pointerY = (event.clientY - rect.top) / modalScale - geometry.marginTopMm;
      dragOffsetRef.current = { xMm: pointerX - point.xMm, yMm: pointerY - point.yMm };
    }
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
          background: '#f9e2af', color: '#374151',
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
                <span
                  className="pp-command-status__dot"
                  aria-hidden="true"
                  style={{
                    color: saveStatus === 'error' ? 'var(--semantic-error, #f38ba8)'
                      : saveStatus === 'saving' ? 'var(--semantic-progress, #fab387)'
                        : saveStatus === 'saved' ? 'var(--semantic-success, #a6e3a1)'
                          : 'var(--semantic-success, #65a765)',
                  }}
                >●</span>
                <span>
                  {saveStatus === 'saving' ? t('page.paperProfiles.saving')
                    : saveStatus === 'saved' ? t('page.paperProfiles.saved')
                      : saveStatus === 'error' ? (saveError || t('common.error'))
                        : editingId ? t('page.paperProfiles.editingProfile') : t('page.paperProfiles.readyToSave')}
                </span>
                {saveStatus === 'error' && (
                  <button
                    type="button"
                    onClick={dismissSaveError}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', padding: 0, color: '#6b7280' }}
                    aria-label={t('common.cancel')}
                  >✕</button>
                )}
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
              <button type="button" className="pp-save-button" style={{ ...s.btn, opacity: saveStatus === 'saving' ? 0.6 : 1 }} onClick={() => void save()}
                disabled={saveStatus === 'saving'}
                title={editingId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}
                aria-label={editingId ? t('page.paperProfiles.updateProfile') : t('page.paperProfiles.saveProfile')}>
                <span aria-hidden="true">{saveStatus === 'saving' ? '⏳' : '💾'}</span>
              </button>
              {editingId && (
                <button type="button" className="pp-icon-btn" onClick={() => { setEditingId(null); setForm(DEFAULT_FORM); setUx(DEFAULT_UX); setSelectedFieldId(null); setSaveStatus('idle'); setSaveError(null); }}
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
            <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0.25rem 0 0.5rem', fontStyle: 'italic' }}>{t('page.paperProfiles.previewOnlyHint')}</p>
            <div className="pp-field-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {ux.dynamicFields.map((f) => (
                <div key={f.id} className="pp-field-row" style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa', position: 'relative' }}>
                  <div className="pp-field-row__primary" style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                    <input aria-label={t('page.paperProfiles.fieldKey')} placeholder="key" value={f.key} onChange={(e) => updField(f.id, { key: e.target.value })}
                      style={{ ...s.smallInput, width: 90, fontFamily: 'monospace' }} />
                    <input aria-label={t('page.paperProfiles.fieldLabel')} placeholder="Label" value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })}
                      style={{ ...s.smallInput, flex: 1 }} />
                    <button type="button" style={s.btnDanger} onClick={(e) => { e.stopPropagation(); delField(f.id); }} title={t('page.paperProfiles.remove')} aria-label={t('page.paperProfiles.remove')}>✕</button>
                  </div>
                  <div className="pp-field-row__secondary" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input aria-label={t('page.paperProfiles.fieldDefault')} placeholder={t('page.paperProfiles.fieldDefault')} value={f.defaultValue} onChange={(e) => updField(f.id, { defaultValue: e.target.value })}
                      style={{ ...s.smallInput, width: 80 }} />
                    <label style={{ fontSize: '0.75rem', color: '#6b7280' }}>X:</label>
                    <input aria-label="X (mm)" type="number" value={f.xMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { xMm: v }); }}
                      style={{ ...s.smallInput, width: 50 }} />
                    <label style={{ fontSize: '0.75rem', color: '#6b7280' }}>Y:</label>
                    <input aria-label="Y (mm)" type="number" value={f.yMm} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) updField(f.id, { yMm: v }); }}
                      style={{ ...s.smallInput, width: 50 }} />
                    <input aria-label={t('page.paperProfiles.fieldFontSizePt')} type="number" value={f.fontSize} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updField(f.id, { fontSize: v }); }}
                      style={{ ...s.smallInput, width: 50 }} title={t('page.paperProfiles.fieldFontSizePt')} />
                    <input aria-label={t('page.paperProfiles.fieldColor')} type="color" value={f.color} onChange={(e) => updField(f.id, { color: e.target.value })}
                      style={{ width: 28, height: 24, padding: 0, border: '1px solid #d1d5db', borderRadius: 3, cursor: 'pointer' }} />
                    <select aria-label={t('page.paperProfiles.align')} value={f.align} onChange={(e) => updField(f.id, { align: e.target.value as DynamicField['align'] })}
                      style={{ ...s.sel, width: 60, padding: '0.25rem 0.3rem', fontSize: '0.75rem' }}>
                      <option value="left">⬅</option><option value="center">⬡</option><option value="right">➡</option>
                    </select>
                    <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                      <input aria-label={t('page.paperProfiles.bold')} type="checkbox" checked={f.bold} onChange={(e) => updField(f.id, { bold: e.target.checked })} /> {t('page.paperProfiles.fieldBoldLabel')}
                    </label>
                  </div>
                </div>
              ))}
            </div>
            {ux.dynamicFields.length > 0 && (
              <button type="button" className="pp-add-field" style={{ ...s.btnSmall, marginTop: '0.5rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#89b4fa' }}
                onClick={addField} title={t('page.paperProfiles.addField')} aria-label={t('page.paperProfiles.addField')}><span aria-hidden="true">+</span></button>
            )}
          </Section>
          </div>

          </div> {/* end scrollable area */}
        </div> {/* end form panel */}

        {/* ===== RIGHT: Preview ===== */}
        <aside className="pp-preview-panel">
            <div className="pp-preview-panel__body" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="pp-preview-header">
              <span className="pp-preview-header__title">{t('page.paperProfiles.preview')}</span>
              <div className="pp-preview-header__actions">
                <span className="pp-preview-header__size">
                  {displayVal(form.widthMm, du, dpi)} × {displayVal(form.heightMm, du, dpi)} {du}
                </span>
              </div>
            </div>
            <div className="pp-preview-stage">
              <div className="pp-preview-stage__meta">
                <span>{t('page.paperProfiles.previewCanvas')}</span>
                <span>{form.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: 0, textAlign: 'center' }}>{t('page.paperProfiles.previewViewOnly')}</p>
              <RulerSheet form={form} scale={scale} showRulers={showRulers} unit={du}>
                <PreviewSheet
                  form={form} ux={ux} scale={scale}
                  showVerticalGrid={showVerticalGrid}
                  showHorizontalGrid={showHorizontalGrid}
                  showAlignmentGuides={!!selectedFieldId}
                  gridIntervalMm={gridSpacingMm}
                />
              </RulerSheet>
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
            </div>
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
          <div ref={modalPanelRef} className="paper-preview-modal__panel">
            <header className="paper-preview-modal__header">
              <div>
                <h2 id="paper-preview-title">{t('page.paperProfiles.fullPreviewTitle')}</h2>
                <p>{t('page.paperProfiles.dragHint')}</p>
              </div>
              <div className="paper-preview-modal__toolstrip" role="toolbar" aria-label="Preview tools">
                <div className="paper-preview-modal__zoom-control" role="group" aria-label={t('page.paperProfiles.zoomControls')}>
                  <IconButton icon="−" label={t('page.paperProfiles.zoomOut')} onClick={() => setPreviewZoom((value) => stepPreviewZoom(value, -1))} />
                  <button
                    type="button"
                    className="paper-preview-modal__zoom-readout"
                    onClick={() => setPreviewZoom(1)}
                    title={t('page.paperProfiles.resetZoom')}
                    aria-label={t('page.paperProfiles.resetZoom')}
                  >
                    {Math.round(previewZoom * 100)}%
                  </button>
                  <IconButton icon="+" label={t('page.paperProfiles.zoomIn')} onClick={() => setPreviewZoom((value) => stepPreviewZoom(value, 1))} />
                </div>
                <IconButton icon="⫶" label={t('page.paperProfiles.toggleVerticalGrid')} onClick={() => setShowVerticalGrid(!showVerticalGrid)} active={showVerticalGrid} />
                <IconButton icon="≡" label={t('page.paperProfiles.toggleHorizontalGrid')} onClick={() => setShowHorizontalGrid(!showHorizontalGrid)} active={showHorizontalGrid} />
                <IconButton icon="📏" label={t('page.paperProfiles.toggleRulers')} onClick={() => setShowRulers(!showRulers)} active={showRulers} />
                <IconButton icon="⊕" label={t('page.paperProfiles.toggleAlignmentGuides')} onClick={() => setShowAlignmentGuides(!showAlignmentGuides)} active={showAlignmentGuides} />
                <label className="paper-preview-modal__spacing-label" title={t('page.paperProfiles.gridSpacing')}>
                  <span className="paper-preview-modal__spacing-icon" aria-hidden="true">⊞</span>
                  <input
                    type="number"
                    className="paper-preview-modal__spacing-input"
                    value={gridSpacingMm}
                    min={1}
                    max={100}
                    step={1}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v)) setGridSpacingMm(clampGridSpacing(v));
                    }}
                    aria-label={t('page.paperProfiles.gridSpacing')}
                  />
                  <span className="paper-preview-modal__spacing-unit">mm</span>
                </label>
              </div>
              <button ref={modalCloseButtonRef} type="button" style={s.btnSmall} onClick={() => setPreviewOpen(false)}>
                {t('page.paperProfiles.closePreview')}
              </button>
            </header>

            <div className="paper-preview-modal__body">
              <section ref={previewCanvasRef} className="paper-preview-modal__canvas" aria-label={t('page.paperProfiles.previewCanvas')}>
                <div className="paper-preview-modal__canvas-label">
                  <span>{t('page.paperProfiles.previewCanvas')}</span>
                  <span>{form.widthMm} × {form.heightMm} mm · {form.dpi} DPI</span>
                </div>
                <div
                  ref={modalStageRef}
                  className="paper-preview-modal__sheet-stage"
                  onWheel={(event) => {
                    if (!(event.ctrlKey || event.metaKey)) return;
                    event.preventDefault();
                    setPreviewZoom((value) => stepPreviewZoom(value, event.deltaY > 0 ? -1 : 1));
                  }}
                >
                  <div className="paper-preview-modal__sheet-stage-inner">
              <RulerSheet form={form} scale={modalScale} showRulers={showRulers} unit={du}>
                    <PreviewSheet
                      form={form}
                      ux={ux}
                      scale={modalScale}
                      sheetRef={previewSheetRef}
                      selectedFieldId={selectedFieldId}
                      onFieldPointerDown={startDraggingField}
                      onFieldSelect={setSelectedFieldId}
                      onFieldNudge={nudgeField}
                      showVerticalGrid={showVerticalGrid}
                      showHorizontalGrid={showHorizontalGrid}
                      showAlignmentGuides={showAlignmentGuides}
                      gridIntervalMm={gridSpacingMm}
                    />
                  </RulerSheet>
                  </div>
                </div>
                <div className="paper-preview-modal__canvas-meta">
                  <span>{t('page.paperProfiles.quickPrintable')}: {(form.widthMm - form.marginLeftMm - form.marginRightMm).toFixed(1)} × {(form.heightMm - form.marginTopMm - form.marginBottomMm).toFixed(1)} mm</span>
                  <span>{t('page.paperProfiles.quickFields')}: {ux.dynamicFields.length}</span>
                  <span>{t('page.paperProfiles.zoomLevel')}: {Math.round(previewZoom * 100)}% ({t('page.paperProfiles.fitIsHundred')})</span>
                  <span>{t('page.paperProfiles.pixelScale')}: {modalScale.toFixed(2)} px/mm</span>
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
                {selectedFieldId ? (
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <IconButton
                      icon="↔"
                      label={t('page.paperProfiles.centerHorizontally')}
                      onClick={() => centerFieldHorizontal(selectedFieldId)}
                    />
                    <IconButton
                      icon="↕"
                      label={t('page.paperProfiles.centerVertically')}
                      onClick={() => centerFieldVertical(selectedFieldId)}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <IconButton
                      icon="↔"
                      label={t('page.paperProfiles.centerHorizontally')}
                      onClick={() => {}}
                      disabled={true}
                      disabledReason={t('page.paperProfiles.centerDisabledNoField')}
                    />
                    <IconButton
                      icon="↕"
                      label={t('page.paperProfiles.centerVertically')}
                      onClick={() => {}}
                      disabled={true}
                      disabledReason={t('page.paperProfiles.centerDisabledNoField')}
                    />
                  </div>
                )}
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
                        <button type="button" style={s.btnDanger} onClick={(e) => { e.stopPropagation(); delField(f.id); }}>
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
              <p style={{ fontSize: '0.85rem', color: '#6b7280', textAlign: 'center', marginTop: '2rem' }}>
                {t('page.paperProfiles.fieldsDrawerEmpty')}<br />{t('page.paperProfiles.clickAddField')}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {ux.dynamicFields.map((f) => (
                <div key={f.id} style={{ padding: '0.65rem', border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <code style={{ fontSize: '0.8rem', fontWeight: 600 }}>{f.key || t('page.paperProfiles.noKey')}</code>
                    <button style={s.btnDanger} onClick={(e) => { e.stopPropagation(); delField(f.id); }}>{t('page.paperProfiles.remove')}</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', fontSize: '0.75rem' }}>
                    <div><label style={{ color: '#6b7280' }}>{t('page.paperProfiles.fieldLabel')}</label><input value={f.label} onChange={(e) => updField(f.id, { label: e.target.value })} style={s.smallInput} /></div>
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
            <button style={{ ...s.btnSmall, marginTop: '0.75rem', width: '100%', borderStyle: 'dashed', color: '#1e66f5', borderColor: '#89b4fa' }}
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
            <span className="pp-drawer__title">{t('page.paperProfiles.appearanceStyle')} · {t('page.paperProfiles.newFieldDefaults')}</span>
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
          <h2 style={{ fontSize: '0.875rem', margin: 0 }}>{t('page.paperProfiles.savedProfiles').replace('{n}', String(profiles.length))}</h2>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {[t('page.paperProfiles.codeLabel'), t('page.paperProfiles.nameLabel'), t('page.paperProfiles.size'), t('page.paperProfiles.marginsHeader'), t('page.paperProfiles.orient'), t('page.paperProfiles.dpi'), t('page.paperProfiles.actions')].map((h) => (
                  <th key={h} style={{ padding: '0.5rem 0.6rem', textAlign: 'left', fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', color: '#6b7280', fontSize: '0.8rem' }}>
                    {t('page.paperProfiles.noProfiles')}
                  </td>
                </tr>
              )}
              {profiles.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem 0.6rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.code}</td>
                  <td style={{ padding: '0.5rem 0.6rem' }}>{p.name}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.widthMm}×{p.heightMm}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem', color: '#6b7280' }}>{p.marginTopMm}/{p.marginRightMm}/{p.marginBottomMm}/{p.marginLeftMm}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</td>
                  <td style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem' }}>{p.dpi}</td>
                  <td style={{ padding: '0.5rem 0.6rem' }}>
                    <button style={{ ...s.btnSmall, padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => startEdit(p)} aria-label={t('page.paperProfiles.editingProfile')}>✏️</button>
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
