import { useEffect, useMemo, useRef, useState } from 'react';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { useCanvasInteraction } from '../hooks/useCanvasInteraction.js';
import { clampGridSpacing, getVisualPaperGeometry, stepPreviewZoom } from '../model/geometry.js';
import { getFieldInspectorState } from '../state/selectors.js';
import { type CanvasOptions } from './CanvasToolbar.js';
import { FieldBarcodePreview, FieldTypeControls, PaperCanvas, RulerSheet } from './PaperCanvas.js';
import { Button, IconButton as SharedIconButton, Input } from '../../../components/ui/index.js';
import { IconButton } from './editorPrimitives.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
import type { Translate } from './types.js';

export function FullPreviewDialog({ editor, popups, interaction, options, setOptions, artwork, onNotice, t }: {
  editor: PaperProfileEditor;
  popups: PaperProfilePopups;
  interaction: ReturnType<typeof useCanvasInteraction>;
  options: CanvasOptions;
  setOptions: (patch: Partial<CanvasOptions>) => void;
  artwork?: { objectUrl: string; fitMode: 'contain' | 'cover' | 'stretch' };
  onNotice: (message: string) => void;
  t: Translate;
}) {
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const geometry = getVisualPaperGeometry(editor.form);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const fitScale = useMemo(() => Math.max(0.5, Math.min(
    20,
    Math.max(1, stageSize.width - 48) / geometry.widthMm,
    Math.max(1, stageSize.height - 48) / geometry.heightMm,
  )), [geometry.heightMm, geometry.widthMm, stageSize]);
  const scale = Math.max(0.25, Math.min(20, fitScale * zoom));
  const inspector = getFieldInspectorState(editor.ux.dynamicFields.length, Boolean(editor.selectedField));
  return (
    <div className="paper-preview-modal" role="dialog" aria-modal="true" aria-labelledby="paper-preview-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) popups.closeFullPreview(); }}>
      <div ref={popups.previewPanelRef} className="paper-preview-modal__panel">
        <header className="paper-preview-modal__header">
          <div><h2 id="paper-preview-title">{t('page.paperProfiles.fullPreviewTitle')}</h2>
            <p>{t('page.paperProfiles.dragHint')}</p></div>
          <div className="paper-preview-modal__toolstrip" role="toolbar" aria-label="Preview tools">
            <div className="paper-preview-modal__zoom-control" role="group" aria-label={t('page.paperProfiles.zoomControls')}>
              <IconButton icon={<PaperProfileIcon name="minus" />} label={t('page.paperProfiles.zoomOut')} onClick={() => setZoom((value) => stepPreviewZoom(value, -1))} />
              <Button variant="ghost" size="sm" className="paper-preview-modal__zoom-readout"
                onClick={() => setZoom(1)} title={t('page.paperProfiles.resetZoom')}
                aria-label={t('page.paperProfiles.resetZoom')}>{Math.round(zoom * 100)}%</Button>
              <IconButton icon={<PaperProfileIcon name="plus" />} label={t('page.paperProfiles.zoomIn')} onClick={() => setZoom((value) => stepPreviewZoom(value, 1))} />
            </div>
            <IconButton icon={<PaperProfileIcon name="vertical-grid" />} label={t('page.paperProfiles.toggleVerticalGrid')}
              onClick={() => setOptions({ verticalGrid: !options.verticalGrid })} active={options.verticalGrid} />
            <IconButton icon={<PaperProfileIcon name="horizontal-grid" />} label={t('page.paperProfiles.toggleHorizontalGrid')}
              onClick={() => setOptions({ horizontalGrid: !options.horizontalGrid })} active={options.horizontalGrid} />
            <IconButton icon={<PaperProfileIcon name="ruler" />} label={t('page.paperProfiles.toggleRulers')}
              onClick={() => setOptions({ rulers: !options.rulers })} active={options.rulers} />
            <IconButton icon={<PaperProfileIcon name="guides" />} label={t('page.paperProfiles.toggleAlignmentGuides')}
              onClick={() => setOptions({ alignmentGuides: !options.alignmentGuides })} active={options.alignmentGuides} />
            <label className="paper-preview-modal__spacing-label" title={t('page.paperProfiles.gridSpacing')}>
              <PaperProfileIcon name="grid" />
              <Input type="number" controlSize="sm" className="paper-preview-modal__spacing-input"
                value={options.gridSpacingMm} min={1} max={100}
                onChange={(event) => setOptions({ gridSpacingMm: clampGridSpacing(Number(event.target.value)) })}
                aria-label={t('page.paperProfiles.gridSpacing')} /><span>mm</span>
            </label>
          </div>
          <Button ref={popups.previewCloseButtonRef} variant="secondary" onClick={popups.closeFullPreview}>
            {t('page.paperProfiles.closePreview')}
          </Button>
        </header>
        <div className="paper-preview-modal__body">
          <section className="paper-preview-modal__canvas" aria-label={t('page.paperProfiles.previewCanvas')}>
            <div className="paper-preview-modal__canvas-label">
              <span>{t('page.paperProfiles.previewCanvas')}</span>
              <span>{editor.form.widthMm} × {editor.form.heightMm} mm · {editor.form.dpi} DPI</span>
            </div>
            <div ref={stageRef} className="paper-preview-modal__sheet-stage"
              onWheel={(event) => {
                if (!(event.ctrlKey || event.metaKey)) return;
                event.preventDefault();
                setZoom((value) => stepPreviewZoom(value, event.deltaY > 0 ? -1 : 1));
              }}>
              <div className="paper-preview-modal__sheet-stage-inner">
                <RulerSheet form={editor.form} scale={scale} showRulers={options.rulers} unit={editor.ux.displayUnit}>
                  <PaperCanvas form={editor.form} ux={editor.ux} scale={scale} sheetRef={sheetRef}
                    selectedFieldId={editor.state.selectedFieldId}
                    onFieldPointerDown={(event, id) => interaction.startDrag(event, id, sheetRef.current, scale)}
                    onFieldSelect={editor.selectField} onFieldNudge={editor.nudgeField}
                    showVerticalGrid={options.verticalGrid} showHorizontalGrid={options.horizontalGrid}
                    showAlignmentGuides={options.alignmentGuides} showDimensions={options.dimensions}
                    gridIntervalMm={options.gridSpacingMm} artworkUrl={artwork?.objectUrl} artworkFitMode={artwork?.fitMode} />
                </RulerSheet>
              </div>
            </div>
          </section>
          <aside className="paper-preview-modal__controls">
            <div className="paper-preview-modal__controls-heading">
              <div><h3>{t('page.paperProfiles.positionFields')}</h3><p>{t('page.paperProfiles.positionFieldsHint')}</p></div>
              <SharedIconButton variant="primary" className="pp-tool-btn"
                label={t('page.paperProfiles.addField')} onClick={() => editor.addField()}>
                <PaperProfileIcon name="plus" />
              </SharedIconButton>
            </div>
            {inspector !== 'empty' && (
              <div className={`paper-preview-modal__alignment${inspector === 'selection-required' ? ' is-disabled' : ''}`}
                role="toolbar" aria-label={t('page.paperProfiles.positionFields')}>
                <IconButton icon={<PaperProfileIcon name="align-horizontal" />} label={t('page.paperProfiles.centerHorizontally')}
                  onClick={() => { if (editor.selectedField) { editor.centerField(editor.selectedField.id, 'horizontal'); onNotice(t('page.paperProfiles.centerHorizontally')); } }}
                  disabled={!editor.selectedField} disabledReason={t('page.paperProfiles.centerDisabledNoField')} />
                <IconButton icon={<PaperProfileIcon name="align-vertical" />} label={t('page.paperProfiles.centerVertically')}
                  onClick={() => { if (editor.selectedField) { editor.centerField(editor.selectedField.id, 'vertical'); onNotice(t('page.paperProfiles.centerVertically')); } }}
                  disabled={!editor.selectedField} disabledReason={t('page.paperProfiles.centerDisabledNoField')} />
              </div>
            )}
            {inspector === 'empty' && <div className="paper-preview-modal__empty"><p>{t('page.paperProfiles.noCustomFields')}</p></div>}
            <div className="paper-preview-modal__field-list">
              {editor.ux.dynamicFields.map((field) => (
                <div key={field.id} className={`paper-preview-modal__field${editor.state.selectedFieldId === field.id ? ' is-selected' : ''}`}
                  role="group"
                  tabIndex={0}
                  aria-label={`${field.label || field.key || t('page.paperProfiles.untitledField')}. ${t('page.paperProfiles.selectFieldHint')}`}
                  aria-current={editor.state.selectedFieldId === field.id ? 'true' : undefined}
                  onClick={() => editor.selectField(field.id)}
                  onFocusCapture={() => editor.selectField(field.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    editor.selectField(field.id);
                  }}>
                  <div className="paper-preview-modal__field-heading"><code>{field.key || t('page.paperProfiles.noKey')}</code>
                    <Button variant="ghost" size="sm" className="pp-field-delete"
                      onClick={(event) => { event.stopPropagation(); editor.deleteField(field.id); }}>{t('page.paperProfiles.remove')}</Button></div>
                  <div className="paper-preview-modal__field-grid">
                    <label>{t('page.paperProfiles.fieldKey')}<Input controlSize="sm" mono value={field.key} onChange={(event) => editor.updateField(field.id, { key: event.target.value })} /></label>
                    <label>{t('page.paperProfiles.fieldLabel')}<Input controlSize="sm" value={field.label} onChange={(event) => editor.updateField(field.id, { label: event.target.value })} /></label>
                    <label>{t('page.paperProfiles.fieldType')}<FieldTypeControls field={field} onUpdate={(patch) => editor.updateField(field.id, patch)} /></label>
                  </div>
                  <FieldBarcodePreview field={field} />
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
