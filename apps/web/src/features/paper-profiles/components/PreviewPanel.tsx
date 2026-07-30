import type { RefObject } from 'react';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { useCanvasInteraction } from '../hooks/useCanvasInteraction.js';
import { getVisualPaperGeometry } from '../model/geometry.js';
import { displayValue, toPixels } from '../model/units.js';
import { CanvasToolbar, type CanvasOptions } from './CanvasToolbar.js';
import { PaperCanvas, RulerSheet } from './PaperCanvas.js';
import { SelectionStatus } from './SelectionStatus.js';
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
  const geometry = getVisualPaperGeometry(form);
  const scale = Math.min(560 / geometry.widthMm, 560 / geometry.heightMm, 5);
  return (
    <aside className="pp-preview-panel">
      <div className="pp-preview-panel__body">
        <div className="pp-preview-header">
          <div><span className="pp-preview-header__title">{t('page.paperProfiles.labelCanvas')}</span>
            <span className="pp-preview-header__subtitle">{t('page.paperProfiles.canvasDragHint')}</span></div>
          <span className="pp-preview-header__size">
            {displayValue(form.widthMm, ux.displayUnit, form.dpi)} × {displayValue(form.heightMm, ux.displayUnit, form.dpi)} {ux.displayUnit}
          </span>
        </div>
        <CanvasToolbar options={options} setOptions={setOptions} onExpand={popups.openFullPreview} t={t} />
        <div className="pp-preview-stage">
          <div className="pp-preview-stage__meta">
            <span>{t('page.paperProfiles.previewCanvas')}</span>
            <span>{form.orientation === 'portrait' ? t('page.paperProfiles.portrait') : t('page.paperProfiles.landscape')}</span>
          </div>
          {ux.dynamicFields.length === 0 && <p className="pp-canvas-empty">{t('page.paperProfiles.canvasEmptyHint')}</p>}
          <RulerSheet form={form} scale={scale} showRulers={options.rulers} unit={ux.displayUnit}>
            <PaperCanvas form={form} ux={ux} scale={scale} sheetRef={sheetRef}
              selectedFieldId={editor.state.selectedFieldId}
              onFieldPointerDown={(event, id) => interaction.startDrag(event, id, sheetRef.current, scale)}
              onFieldSelect={(id) => {
                editor.selectField(id);
                document.getElementById(`paper-field-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
              onFieldNudge={editor.nudgeField}
              showVerticalGrid={options.verticalGrid} showHorizontalGrid={options.horizontalGrid}
              showAlignmentGuides={Boolean(editor.state.selectedFieldId)}
              showDimensions={options.dimensions} gridIntervalMm={options.gridSpacingMm}
              artworkUrl={artwork?.objectUrl} artworkFitMode={artwork?.fitMode} />
          </RulerSheet>
        </div>
        <div className="pp-preview-quick-info">
          <span>{t('page.paperProfiles.quickSize')}: {form.widthMm} × {form.heightMm} mm</span>
          <span>{t('page.paperProfiles.quickDpi')}: {form.dpi}</span>
          <span>{t('page.paperProfiles.quickPrintable')}: {(form.widthMm - form.marginLeftMm - form.marginRightMm).toFixed(1)} × {(form.heightMm - form.marginTopMm - form.marginBottomMm).toFixed(1)} mm</span>
          <span>{t('page.paperProfiles.quickPixels')}: {Math.round(toPixels(form.widthMm, form.dpi))} × {Math.round(toPixels(form.heightMm, form.dpi))} px</span>
          <span>{t('page.paperProfiles.quickScale')}: {scale.toFixed(2)}x</span>
          <span>{t('page.paperProfiles.quickFields')}: {ux.dynamicFields.length}</span>
        </div>
        <SelectionStatus field={editor.selectedField} t={t} />
      </div>
    </aside>
  );
}
