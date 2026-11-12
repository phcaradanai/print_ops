import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { qrQuietZoneMm, renderBarcodeSvg } from '../../../lib/barcode.js';
import { fitFontSizePt, PRINT_FONT_FAMILY, PRINT_LINE_HEIGHT } from '@printerops/shared';
import { useLocale } from '../../../i18n/index.js';
import { anchorTransform, anchorTransformOrigin } from '../model/fieldGeometry.js';
import { fontPointSizeToPreviewPixels, getDesignPaperGeometry, mapPrintablePointToVisual } from '../model/geometry.js';
import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_BARCODE_WIDTH_MM, DEFAULT_QR_SIZE_MM } from '../model/defaults.js';
import type {
  DynamicField,
  DynamicFieldBarcodeSymbology,
  DynamicFieldType,
  ImportFitMode,
  PaperForm,
  PaperProfileUx as UxOptions,
} from '../model/types.js';
import type { FieldBox } from '../model/align.js';
import { IconButton } from './editorPrimitives.js';
import { DraftNumberInput } from './DraftNumberInput.js';

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

  // The design view is always upright; rotation/flip apply only at print time.
  const { widthMm, heightMm } = getDesignPaperGeometry(form);
  const frame = { width: widthMm, height: heightMm };
  const pvW = frame.width * scale;
  const pvH = frame.height * scale;
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
            {renderTicks(frame.width, false)}
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
            {renderTicks(frame.height, true)}
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
          if (nextType === 'barcode' && field.barcodeWidthMm == null) patch.barcodeWidthMm = DEFAULT_BARCODE_WIDTH_MM;
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
          <DraftNumberInput
            aria-label={t('page.paperProfiles.barcodeHeightMm')}
            title={t('page.paperProfiles.barcodeHeightMm')}
            min={4}
            max={60}
            step={0.5}
            value={field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM}
            normalize={(value) => Math.max(4, Math.min(60, value))}
            onValueChange={(value) => onUpdate({ barcodeHeightMm: value })}
            className={numberClassName}
          />
          <DraftNumberInput
            aria-label={t('page.paperProfiles.barcodeWidthMm')}
            title={t('page.paperProfiles.barcodeWidthMm')}
            min={4}
            max={100}
            step={0.5}
            value={field.barcodeWidthMm ?? DEFAULT_BARCODE_WIDTH_MM}
            normalize={(value) => Math.max(4, Math.min(100, value))}
            onValueChange={(value) => onUpdate({ barcodeWidthMm: value })}
            className={numberClassName}
          />
        </>
      )}
      {field.type === 'qrcode' && (
        <DraftNumberInput
          aria-label={t('page.paperProfiles.qrSizeMm')}
          title={t('page.paperProfiles.qrSizeMm')}
          min={4}
          max={100}
          step={0.5}
          value={field.qrSizeMm ?? DEFAULT_QR_SIZE_MM}
          normalize={(value) => Math.max(4, Math.min(100, value))}
          onValueChange={(value) => onUpdate({ qrSizeMm: value })}
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
  const widthMm = field.type === 'qrcode' ? (field.qrSizeMm ?? DEFAULT_QR_SIZE_MM) : (field.barcodeWidthMm ?? DEFAULT_BARCODE_WIDTH_MM);
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
            width: `${widthMm}mm`,
            padding: quietMm ? `${quietMm}mm` : undefined,
            boxSizing: 'content-box',
            background: quietMm ? 'var(--neutral-surface)' : undefined,
            lineHeight: 0,
          }}
          dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', `<svg style="display:block;height:100%;width:100%;object-fit:contain" `) }}
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
      const realWidthMm = field.type === 'qrcode' ? realHeightMm : (field.barcodeWidthMm ?? DEFAULT_BARCODE_WIDTH_MM);
      // True scale, no minimum: a floor here would draw a symbol bigger than it prints.
      const heightPx = realHeightMm * scale;
      const widthPx = realWidthMm * scale;
      const square = field.type === 'qrcode';
      const quietPx = square ? (qrQuietZoneMm(sample, realHeightMm) ?? 0) * scale : 0;
      if (!square) {
        // Mirrors imgTag() in simple-template-renderer.ts: the printed 1D symbol
        // always carries a human-readable line inside the same box.
        const hriMm = Math.min(2, Math.max(1.6, realHeightMm * 0.25));
        return (
          <span aria-label={`${field.type} preview for ${sample}`} style={{
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
            width: widthPx, height: heightPx, overflow: 'hidden', lineHeight: 0, verticalAlign: 'top',
          }}>
            <span style={{ display: 'block', width: '100%', height: Math.max(1, realHeightMm - hriMm) * scale, lineHeight: 0 }}
              dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg style="display:block;height:100%;width:100%" ') }} />
            <span style={{
              display: 'block', width: '100%', height: hriMm * scale, lineHeight: `${hriMm * scale}px`,
              fontFamily: 'Arial,sans-serif', fontSize: 1.5 * scale, fontWeight: 400, textAlign: 'center',
              whiteSpace: 'nowrap', overflow: 'hidden', color: '#000',
            }}>{sample}</span>
          </span>
        );
      }
      return (
        <span
          aria-label={`${field.type} preview for ${sample}`}
          style={{
            display: 'inline-block',
            height: heightPx,
            width: widthPx,
            padding: quietPx || undefined,
            // Print adds the quiet zone outside the symbol; the global
            // border-box rule would otherwise shrink the QR on the canvas.
            boxSizing: 'content-box',
            background: quietPx ? '#fff' : undefined,
            lineHeight: 0,
          }}
          dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', `<svg style="display:block;height:100%;width:100%;object-fit:contain" `) }}
        />
      );
    }
    // Unencodable sample: nothing prints, but keep the field findable (the button's font-size is 0).
    return <span style={{ fontSize: 10, lineHeight: 1.2, color: 'var(--state-danger-text, #b91c1c)' }}>[{field.type}: {sample || '?'}]</span>;
  }
  return <>{textSample(field)}</>;
}

function textSample(field: DynamicField): string {
  return field.defaultValue || field.label || field.key || 'field';
}

/** The size the printer will use for the sample: shrink-to-fit runs the same shared fit as the server. */
function previewFontSizePt(field: DynamicField): number {
  return field.shrinkToFit && field.displayWidthMm
    ? fitFontSizePt(textSample(field), field.fontSize, field.bold, field.displayWidthMm)
    : field.fontSize;
}

export function PaperCanvas({
  form,
  ux,
  scale,
  sheetRef,
  selectedFieldId,
  selectedFieldIds,
  onFieldPointerDown,
  onFieldSelect,
  onFieldNudge,
  onFieldResizePointerDown,
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
  /** Whole selection for multi-select; defaults to just `selectedFieldId`. */
  selectedFieldIds?: string[];
  onFieldPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  onFieldSelect?: (id: string, event?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  onFieldNudge?: (id: string, deltaVisualXmm: number, deltaVisualYmm: number) => void;
  onFieldResizePointerDown?: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  showVerticalGrid?: boolean;
  showHorizontalGrid?: boolean;
  showAlignmentGuides?: boolean;
  gridIntervalMm?: number;
  artworkUrl?: string;
  artworkFitMode?: ImportFitMode;
  showDimensions?: boolean;
}) {
  const { t } = useLocale();
  // Like Figma/Canva the design stays upright: the profile's rotation/flip
  // describe how the paper sits in the printer and are applied only at print.
  const geometry = getDesignPaperGeometry(form);
  const pvW = geometry.widthMm * scale;
  const pvH = geometry.heightMm * scale;
  const pvMT = geometry.marginTopMm * scale;
  const pvMR = geometry.marginRightMm * scale;
  const pvMB = geometry.marginBottomMm * scale;
  const pvML = geometry.marginLeftMm * scale;
  const pvPrintW = geometry.printableWidthMm * scale;
  const pvPrintH = geometry.printableHeightMm * scale;
  const interactive = Boolean(onFieldPointerDown || onFieldSelect || onFieldNudge);
  const selectedIds = new Set(selectedFieldIds ?? (selectedFieldId ? [selectedFieldId] : []));

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
        // Outline, not border: a border moves every absolutely placed field 1px
        // off the anchor the printer uses.
        outline: '1px dashed var(--pp-canvas-outline)', outlineOffset: -1, zIndex: 1,
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
            data-field-id={f.id}
            aria-pressed={selectedIds.has(f.id)}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            disabled={!interactive}
            onPointerDown={interactive ? (event) => onFieldPointerDown?.(event, f.id) : undefined}
            onClick={interactive ? (event) => onFieldSelect?.(f.id, event) : undefined}
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
            className="pp-canvas-field"
            style={{
              position: 'absolute', left: point.xMm * scale, top: point.yMm * scale,
              // Barcode/QR spans print with font-size:0;line-height:0, so no text
              // strut can push the symbol down; text uses the print line height.
              fontSize: isSymbol(f) ? 0 : fontPointSizeToPreviewPixels(previewFontSizePt(f), scale), fontWeight: f.bold ? 700 : 400,
              lineHeight: isSymbol(f) ? 0 : PRINT_LINE_HEIGHT,
              color: f.color, whiteSpace: 'nowrap',
              // The app's global button max-width:100% would cap long text at the
              // printable width; the printed span has no cap, and a capped box
              // shifts centre/right anchors and misleads align/distribute.
              maxWidth: 'none',
              ...(f.displayWidthMm ? { width: f.displayWidthMm * scale, overflow: 'hidden', textAlign: f.align } : {}),
              fontFamily: PRINT_FONT_FAMILY, pointerEvents: interactive ? 'auto' : 'none',
              cursor: interactive ? 'grab' : 'default',
              // No padding and no border: this element's box IS the printed
              // field. Both are layout-affecting, so either one offsets the text
              // from `left`/`top` — the exact anchor the printer uses — and
              // because they are fixed px they represent more millimetres the
              // smaller the canvas gets. The affordance moved to `outline` and a
              // `::before` hit area in paperProfilesEditor.css, neither of which
              // takes part in layout. See __tests__/fieldPreviewFidelity.
              padding: 0,
              border: 'none',
              outline: selectedIds.has(f.id) ? '1px solid var(--primary)' : 'none',
              outlineOffset: 2,
              background: f.bgColor ?? (selectedIds.has(f.id) ? 'var(--state-info-surface)' : 'transparent'),
              transform: anchorTransform(f.align, geometry.rotated),
              transformOrigin: anchorTransformOrigin(f.align),
              zIndex: 4,
            }}
          >
            <FieldPreviewContent field={f} scale={scale} />
            {/* Pointer-only resize grip; keyboard users resize from the Properties panel. */}
            {onFieldResizePointerDown && selectedFieldId === f.id && selectedIds.size === 1 && (
              <span aria-hidden="true" className={`pp-resize-handle pp-resize-handle--${resizeHandleSide(f)}`}
                onPointerDown={(event) => onFieldResizePointerDown(event, f.id)}
                onClick={(event) => event.stopPropagation()} />
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

/**
 * Barcodes/QR take width from a horizontal drag, so their grip sits on the
 * free side of the anchor. Text only scales with vertical drag, so its grip
 * sits at the anchor, which is always on the paper even when long text is
 * clipped past the edge.
 */
/**
 * Measures selected fields as rendered on the design canvas, in mm from the
 * printable-area origin. The canvas uses the print's own units and font, so
 * this box is the printed one; align/distribute works on it like Figma does.
 */
export function measureFieldBoxes(sheet: HTMLElement | null, scale: number, geometry: { marginLeftMm: number; marginTopMm: number }, ids: string[]): FieldBox[] {
  if (!sheet || scale <= 0) return [];
  const origin = sheet.getBoundingClientRect();
  return ids.flatMap((id) => {
    const element = sheet.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(id)}"]`);
    if (!element) return [];
    const rect = element.getBoundingClientRect();
    return [{
      id,
      left: (rect.left - origin.left) / scale - geometry.marginLeftMm,
      top: (rect.top - origin.top) / scale - geometry.marginTopMm,
      width: rect.width / scale,
      height: rect.height / scale,
    }];
  });
}

function isSymbol(field: DynamicField): boolean {
  return field.type === 'barcode' || field.type === 'qrcode';
}

function resizeHandleSide(field: DynamicField): 'left' | 'right' {
  const isText = field.type !== 'barcode' && field.type !== 'qrcode';
  if (isText) return field.align === 'right' ? 'right' : 'left';
  return field.align === 'right' ? 'left' : 'right';
}

// ── Main Page ──────────────────────────────────────────────────────
