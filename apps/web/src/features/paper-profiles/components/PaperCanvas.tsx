import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { qrQuietZoneMm, renderBarcodeSvg } from '../../../lib/barcode.js';
import { useLocale } from '../../../i18n/index.js';
import { anchorTransform, anchorTransformOrigin } from '../model/fieldGeometry.js';
import { fontPointSizeToPreviewPixels, getVisualPaperGeometry, mapPrintablePointToVisual } from '../model/geometry.js';
import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_QR_SIZE_MM } from '../model/defaults.js';
import type {
  DynamicField,
  DynamicFieldBarcodeSymbology,
  DynamicFieldType,
  ImportFitMode,
  PaperForm,
  PaperProfileUx as UxOptions,
} from '../model/types.js';
import { IconButton } from './editorPrimitives.js';

export function RulerSheet({
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
  children: ReactNode;
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

  function renderTicks(totalMm: number, vertical: boolean): ReactNode[] {
    const ticks: ReactNode[] = [];
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

/**
 * Type (+ symbology, when type === 'barcode') selector shared by all three
 * field-editing panels (desktop compact row, mobile modal, drawer).
 */
export function FieldTypeControls({
  field,
  onUpdate,
  selectClassName = 'ui-select ui-select--sm',
  numberClassName = 'ui-input ui-input--sm',
}: {
  field: DynamicField;
  onUpdate: (patch: Partial<DynamicField>) => void;
  /** Control classes, so every panel gets the same states without duplicating them. */
  selectClassName?: string;
  numberClassName?: string;
}) {
  // Defaulted, not optional-and-forgotten: the full-preview inspector rendered
  // these with no class at all, so the same control looked unstyled there and
  // styled in the field drawer.
  const { t } = useLocale();
  return (
    <>
      <select
        aria-label={t('page.paperProfiles.fieldType')}
        value={field.type}
        onChange={(e) => {
          const nextType = e.target.value as DynamicFieldType;
          const patch: Partial<DynamicField> = { type: nextType };
          // Pre-fill a sensible real-world size the first time a field becomes
          // a barcode/QR, so the size input never starts out blank/undefined.
          if (nextType === 'barcode' && field.barcodeHeightMm == null) patch.barcodeHeightMm = DEFAULT_BARCODE_HEIGHT_MM;
          if (nextType === 'qrcode' && field.qrSizeMm == null) patch.qrSizeMm = DEFAULT_QR_SIZE_MM;
          onUpdate(patch);
        }}
        className={selectClassName}
      >
        <option value="text">{t('page.paperProfiles.fieldTypeText')}</option>
        <option value="barcode">{t('page.paperProfiles.fieldTypeBarcode')}</option>
        <option value="qrcode">{t('page.paperProfiles.fieldTypeQrcode')}</option>
        <option value="date">{t('page.paperProfiles.fieldTypeDate')}</option>
        <option value="number">{t('page.paperProfiles.fieldTypeNumber')}</option>
      </select>
      {field.type === 'barcode' && (
        <>
          <select
            aria-label={t('page.paperProfiles.barcodeSymbology')}
            value={field.barcodeSymbology ?? 'code128'}
            onChange={(e) => onUpdate({ barcodeSymbology: e.target.value as DynamicFieldBarcodeSymbology })}
            className={selectClassName}
          >
            <option value="code128">{t('page.paperProfiles.symbologyCode128')}</option>
            <option value="code39">{t('page.paperProfiles.symbologyCode39')}</option>
            <option value="ean13">{t('page.paperProfiles.symbologyEan13')}</option>
            <option value="datamatrix">{t('page.paperProfiles.symbologyDatamatrix')}</option>
          </select>
          <input
            aria-label={t('page.paperProfiles.barcodeHeightMm')}
            title={t('page.paperProfiles.barcodeHeightMm')}
            type="number"
            min={4}
            max={60}
            step={0.5}
            value={field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onUpdate({ barcodeHeightMm: Math.max(4, Math.min(60, v)) });
            }}
            className={numberClassName}
          />
        </>
      )}
      {field.type === 'qrcode' && (
        <input
          aria-label={t('page.paperProfiles.qrSizeMm')}
          title={t('page.paperProfiles.qrSizeMm')}
          type="number"
          min={4}
          max={100}
          step={0.5}
          value={field.qrSizeMm ?? DEFAULT_QR_SIZE_MM}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onUpdate({ qrSizeMm: Math.max(4, Math.min(100, v)) });
          }}
          className={numberClassName}
        />
      )}
    </>
  );
}

/**
 * Real-size live preview shown directly beside the settings controls (not
 * just on the far-away design canvas), so adjusting symbology/size/default
 * value gives immediate visual feedback about what will actually print.
 * Rendered at true physical scale using CSS mm units — SVG has no fixed
 * width/height (only a viewBox), so it scales cleanly to any box size.
 */
export function FieldBarcodePreview({ field }: { field: DynamicField }) {
  const { t } = useLocale();
  if (field.type !== 'barcode' && field.type !== 'qrcode') return null;
  const sample = field.defaultValue || field.label || field.key || (field.type === 'qrcode' ? 'QR-SAMPLE' : '123456');
  const svg = renderBarcodeSvg(sample, field.type, field.barcodeSymbology);
  const heightMm = field.type === 'qrcode' ? (field.qrSizeMm ?? DEFAULT_QR_SIZE_MM) : (field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM);
  const widthMm = field.type === 'qrcode' ? (field.qrSizeMm ?? DEFAULT_QR_SIZE_MM) : undefined;
  const quietMm = field.type === 'qrcode' ? (qrQuietZoneMm(sample, heightMm) ?? 0) : 0;
  return (
    <div className="pp-barcode-preview">
      {svg ? (
        <span
          aria-label={`${field.type} preview for ${sample}`}
          style={{
            display: 'inline-block',
            maxWidth: '100%',
            height: `${heightMm}mm`,
            width: widthMm ? `${widthMm}mm` : 'auto',
            padding: quietMm ? `${quietMm}mm` : undefined,
            background: quietMm ? 'var(--neutral-surface)' : undefined,
            lineHeight: 0,
          }}
          dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', `<svg style="height:100%;width:${widthMm ? '100%' : 'auto'}" `) }}
        />
      ) : (
        <span style={{ fontSize: 'var(--font-label-size)', color: 'var(--neutral-text-muted)' }}>[{field.type}: {sample || '?'}]</span>
      )}
      <span style={{ fontSize: 'var(--font-label-size)', color: 'var(--neutral-text-muted)' }}>
        {t('page.paperProfiles.barcodeApproxSize')
          .replace('{w}', widthMm ? widthMm.toFixed(1) : '—')
          .replace('{h}', heightMm.toFixed(1))}
      </span>
    </div>
  );
}

/**
 * Renders a field's content on the design canvas: a real barcode/QR graphic
 * for 'barcode'/'qrcode' fields (using the sample defaultValue, since that's
 * the only data available at design time), plain text otherwise.
 */
function FieldPreviewContent({ field, scale }: { field: DynamicField; scale: number }) {
  if (field.type === 'barcode' || field.type === 'qrcode') {
    const sample = field.defaultValue || field.label || field.key || (field.type === 'qrcode' ? 'QR-SAMPLE' : '123456');
    const svg = renderBarcodeSvg(sample, field.type, field.barcodeSymbology);
    if (svg) {
      const realHeightMm = field.type === 'qrcode' ? (field.qrSizeMm ?? DEFAULT_QR_SIZE_MM) : (field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM);
      const heightPx = Math.max(10, realHeightMm * scale);
      const square = field.type === 'qrcode';
      const quietPx = square ? (qrQuietZoneMm(sample, realHeightMm) ?? 0) * scale : 0;
      return (
        <span
          aria-label={`${field.type} preview for ${sample}`}
          style={{
            display: 'inline-block',
            height: heightPx,
            width: square ? heightPx : 'auto',
            padding: quietPx || undefined,
            background: quietPx ? '#fff' : undefined,
            lineHeight: 0,
          }}
          dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', `<svg style="display:block;height:100%;width:${square ? '100%' : 'auto'}" `) }}
        />
      );
    }
    return <span>[{field.type}: {sample || '?'}]</span>;
  }
  return <>{field.defaultValue || field.label || field.key || 'field'}</>;
}

export function PaperCanvas({
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
  artworkUrl,
  artworkFitMode,
  showDimensions = false,
}: {
  form: PaperForm;
  ux: UxOptions;
  scale: number;
  sheetRef?: React.RefObject<HTMLDivElement>;
  selectedFieldId?: string | null;
  onFieldPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  onFieldSelect?: (id: string) => void;
  onFieldNudge?: (id: string, deltaVisualXmm: number, deltaVisualYmm: number) => void;
  showVerticalGrid?: boolean;
  showHorizontalGrid?: boolean;
  showAlignmentGuides?: boolean;
  gridIntervalMm?: number;
  artworkUrl?: string;
  artworkFitMode?: ImportFitMode;
  showDimensions?: boolean;
}) {
  const { t } = useLocale();
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
        border: '1px dashed var(--pp-canvas-outline)', zIndex: 1,
      }}>
        {/* Grid lines */}
        {gridLinesVertical.map((x) => (
          <div key={`vg-${x}`} style={{
            position: 'absolute', left: x * scale, top: 0,
            width: 0, height: '100%',
            borderLeft: '1px solid var(--pp-canvas-grid)',
            pointerEvents: 'none', zIndex: 0,
          }} />
        ))}
        {gridLinesHorizontal.map((y) => (
          <div key={`hg-${y}`} style={{
            position: 'absolute', left: 0, top: y * scale,
            height: 0, width: '100%',
            borderTop: '1px solid var(--pp-canvas-grid)',
            pointerEvents: 'none', zIndex: 0,
          }} />
        ))}

        {/* Alignment guides */}
        {showAlignmentGuides && guideX !== null && (
          <div style={{
            position: 'absolute', left: guideX, top: 0,
            width: 0, height: '100%',
            borderLeft: '1px dashed var(--pp-canvas-guide)',
            pointerEvents: 'none', zIndex: 3,
          }} />
        )}
        {showAlignmentGuides && guideY !== null && (
          <div style={{
            position: 'absolute', left: 0, top: guideY,
            height: 0, width: '100%',
            borderTop: '1px dashed var(--pp-canvas-guide)',
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
            aria-pressed={selectedFieldId === f.id}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            disabled={!interactive}
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
              border: selectedFieldId === f.id ? '1px solid var(--primary)' : '1px solid transparent',
              borderRadius: 3,
              background: selectedFieldId === f.id ? 'var(--state-info-surface)' : 'transparent',
              transform: anchorTransform(f.align, geometry.rotated),
              transformOrigin: anchorTransformOrigin(f.align),
              zIndex: 4,
            }}
          >
            <FieldPreviewContent field={f} scale={scale} />
            {showDimensions && selectedFieldId === f.id && (
              <span className="pp-field-measurement" aria-hidden="true">
                X {f.xMm.toFixed(1)} · Y {f.yMm.toFixed(1)} mm
                {(f.type === 'qrcode' || f.type === 'barcode')
                  ? ` · ${f.type === 'qrcode' ? `${(f.qrSizeMm ?? DEFAULT_QR_SIZE_MM).toFixed(1)} × ` : ''}${(f.type === 'qrcode' ? f.qrSizeMm : f.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM)?.toFixed(1)} mm`
                  : ` · ${f.fontSize} pt`}
              </span>
            )}
          </button>
            );
          })()
        ))}
      </div>

      {/* Imported artwork layer — below grid/guides/fields, no interaction */}
      {artworkUrl && (
        <>
          <img
            src={artworkUrl}
            alt={t('page.paperProfiles.referenceArtwork')}
            style={{
              position: 'absolute',
              left: pvML,
              top: pvMT,
              width: pvPrintW,
              height: pvPrintH,
              objectFit: artworkFitMode === 'stretch' ? 'fill' : artworkFitMode === 'cover' ? 'cover' : 'contain',
              pointerEvents: 'none' as const,
              zIndex: 0,
              opacity: 0.35,
            }}
          />
          <div style={{
            position: 'absolute',
            left: pvML,
            top: pvMT + pvPrintH - 14,
            padding: '1px 4px',
            background: 'var(--pp-canvas-scrim)',
            color: 'var(--neutral-surface)',
            fontSize: '0.75rem',
            pointerEvents: 'none',
            zIndex: 1,
            borderBottomRightRadius: 2,
          }}>
            {t('page.paperProfiles.referenceArtworkOnly')}
          </div>
        </>
      )}

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
