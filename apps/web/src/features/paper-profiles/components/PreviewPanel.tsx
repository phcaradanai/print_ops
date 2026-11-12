import type { RefObject } from 'react';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { useCanvasInteraction } from '../hooks/useCanvasInteraction.js';
import { actualSizePercent, CSS_PX_PER_MM, getDesignPaperGeometry } from '../model/geometry.js';
import { displayValue, toPixels } from '../model/units.js';
import { useMarqueeSelection } from '../hooks/useMarqueeSelection.js';
import { CanvasToolbar, type CanvasOptions } from './CanvasToolbar.js';
import { measureFieldBoxes, PaperCanvas, RulerSheet } from './PaperCanvas.js';
import { PropertiesPanel } from './PropertiesPanel.js';
import type { Translate } from './types.js';

export function PreviewPanel({ editor, popups, interaction, options, setOptions, sheetRef, artwork, t }: {
  editor: PaperProfileEditor;
  popups: PaperProfilePopups;
  interaction: ReturnType<typeof useCanvasInteraction>;
  options: CanvasOptions;
  setOptions: (patch: Partial<CanvasOptions>) => void;
  sheetRef: RefObject<HTMLDivElement>;
  artwork?: { objectUrl: string; fitMode: 'contain' | 'cover' | 'stretch' };
  t: Translate;
}) {
  const { form, ux } = editor;
  const geometry = getDesignPaperGeometry(form);
  const marquee = useMarqueeSelection(sheetRef, editor.selectedFieldIds, editor.setSelection);
  // Fit within the panel's ~560px box, but never scale past true physical
  // size — see CSS_PX_PER_MM for why an uncapped auto-fit isn't safe to use
  // as a print-size reference.
  const scale = Math.min(560 / geometry.widthMm, 560 / geometry.heightMm, CSS_PX_PER_MM);
  // Not a PageLayout `detail` region: this canvas is the surface the operator
  // edits against (drag, nudge, select a field), so it is half of the primary
  // task rather than supporting evidence. Kept as a plain div — a page's only
  // complementary landmark is the scaffold's `detail` slot.
  // See docs/frontend/LAYOUT_COMPONENT_STANDARD.md.
  return (
    <div className="pp-preview-panel">
      <div className="pp-preview-panel__body">
        <div className="pp-preview-header">
          <div><span className="pp-preview-header__title">{t('page.paperProfiles.labelCanvas')}</span>
            <span className="pp-preview-header__subtitle">{t('page.paperProfiles.canvasDragHint')}</span></div>
          <span className="pp-preview-header__size">
            {displayValue(geometry.widthMm, ux.displayUnit, form.dpi)} × {displayValue(geometry.heightMm, ux.displayUnit, form.dpi)} {ux.displayUnit}
          </span>
        </div>
        <CanvasToolbar editor={editor} options={options} setOptions={setOptions} onExpand={popups.openFullPreview} t={t} />
        <div className="pp-preview-stage"
          // Figma/Canva canvas habits: click empty space to deselect, Esc to
          // deselect, Delete/Backspace removes the focused field.
          onPointerDown={(event) => {
            // Empty space: start a marquee (a plain click just clears the selection).
            if (!(event.target as HTMLElement).closest('.pp-canvas-field')) marquee.start(event);
          }}
          onKeyDown={(event) => {
            const id = editor.state.selectedFieldId;
            if (!id || !(event.target as HTMLElement).closest('.pp-canvas-field')) return;
            if (event.key === 'Escape') { editor.selectField(null); (event.target as HTMLElement).blur(); }
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); editor.deleteFields(editor.selectedFieldIds); }
          }}>
          <div className="pp-preview-stage__meta">
            <span>{t('page.paperProfiles.previewCanvas')}</span>
            <span>{form.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</span>
          </div>
          {ux.dynamicFields.length === 0 && <p className="pp-canvas-empty">{t('page.paperProfiles.canvasEmptyHint')}</p>}
          <RulerSheet form={form} scale={scale} showRulers={options.rulers} unit={ux.displayUnit}>
            <PaperCanvas form={form} ux={ux} scale={scale} sheetRef={sheetRef}
              selectedFieldId={editor.state.selectedFieldId}
              selectedFieldIds={editor.selectedFieldIds}
              onFieldPointerDown={(event, id) => interaction.startDrag(event, id, sheetRef.current, scale)}
              onFieldResizePointerDown={(event, id) => interaction.startResize(event, id, scale)}
              onFieldSelect={(id, event) => {
                // Modifier clicks already toggled the selection on pointerdown; a
                // plain click on a member of a group keeps the group, as in Figma.
                if (event && (event.shiftKey || event.metaKey || event.ctrlKey)) return;
                if (editor.selectedFieldIds.length > 1 && editor.selectedFieldIds.includes(id)) return;
                editor.selectField(id);
                document.getElementById(`paper-field-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
              onFieldNudge={editor.nudgeField}
              showVerticalGrid={options.verticalGrid} showHorizontalGrid={options.horizontalGrid}
              showAlignmentGuides={Boolean(editor.state.selectedFieldId)}
              showDimensions={options.dimensions} gridIntervalMm={options.gridSpacingMm}
              artworkUrl={artwork?.objectUrl} artworkFitMode={artwork?.fitMode} />
          </RulerSheet>
          {marquee.rect && (
            <div className="pp-marquee" aria-hidden="true" style={{
              position: 'fixed', left: marquee.rect.left, top: marquee.rect.top,
              width: marquee.rect.width, height: marquee.rect.height,
            }} />
          )}
        </div>
        <div className="pp-preview-quick-info">
          <span>{t('page.paperProfiles.quickSize')}: {geometry.widthMm} × {geometry.heightMm} mm</span>
          <span>{t('page.paperProfiles.quickDpi')}: {form.dpi}</span>
          <span>{t('page.paperProfiles.quickPrintable')}: {geometry.printableWidthMm.toFixed(1)} × {geometry.printableHeightMm.toFixed(1)} mm</span>
          <span>{t('page.paperProfiles.quickPixels')}: {Math.round(toPixels(geometry.widthMm, form.dpi))} × {Math.round(toPixels(geometry.heightMm, form.dpi))} px</span>
          <span>{t('page.paperProfiles.quickScale')}: {scale.toFixed(2)}x ({actualSizePercent(scale)}% {t('page.paperProfiles.actualSize')})</span>
          <span>{t('page.paperProfiles.quickFields')}: {ux.dynamicFields.length}</span>
        </div>
        <PropertiesPanel editor={editor} t={t}
          measureSelection={() => measureFieldBoxes(sheetRef.current, scale, geometry, editor.selectedFieldIds)} />
      </div>
    </div>
  );
}
