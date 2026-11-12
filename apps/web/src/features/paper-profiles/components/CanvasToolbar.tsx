import { normalizeRotation, renderTransformCss, resolveRenderTransform } from '@printerops/shared';
import { Button } from '../../../components/ui/index.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { IconButton } from './editorPrimitives.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export interface CanvasOptions {
  verticalGrid: boolean;
  horizontalGrid: boolean;
  rulers: boolean;
  alignmentGuides: boolean;
  dimensions: boolean;
  gridSpacingMm: number;
}

export function CanvasToolbar({ editor, options, setOptions, onExpand, t }: {
  editor: Pick<PaperProfileEditor, 'form' | 'patchForm'>;
  options: CanvasOptions;
  setOptions: (patch: Partial<CanvasOptions>) => void;
  onExpand: () => void;
  t: Translate;
}) {
  const grid = options.verticalGrid || options.horizontalGrid;
  const { form, patchForm } = editor;
  const rotation = form.rotation ?? 0;
  const rotateBy = (degrees: number) => patchForm('rotation', normalizeRotation(rotation + degrees));
  const ratio = form.widthMm / Math.max(1, form.heightMm);
  return (
    <div className="pp-canvas-toolbar" role="toolbar" aria-label={t('page.paperProfiles.canvasControls')}>
      <IconButton icon={<PaperProfileIcon name="grid" />} label={t('page.paperProfiles.toggleGrid')} active={grid}
        onClick={() => setOptions({ verticalGrid: !grid, horizontalGrid: !grid })} />
      <IconButton icon={<PaperProfileIcon name="ruler" />} label={t('page.paperProfiles.toggleRulers')} active={options.rulers}
        onClick={() => setOptions({ rulers: !options.rulers })} />
      <IconButton icon={<PaperProfileIcon name="dimensions" />} label={t('page.paperProfiles.showFieldDimensions')} active={options.dimensions}
        onClick={() => setOptions({ dimensions: !options.dimensions })} />
      {/* Rotate/flip the paper as it sits in the printer; the design above stays upright. */}
      <span className="pp-canvas-toolbar__divider" aria-hidden="true" />
      <IconButton icon={<PaperProfileIcon name="rotate-ccw" />} label={t('page.paperProfiles.rotatePaperLeft')} onClick={() => rotateBy(-90)} />
      <IconButton icon={<PaperProfileIcon name="rotate-cw" />} label={t('page.paperProfiles.rotatePaperRight')} onClick={() => rotateBy(90)} />
      <IconButton icon={<PaperProfileIcon name="flip-horizontal" />} label={t('page.paperProfiles.flipHorizontal')} active={Boolean(form.flipHorizontal)}
        onClick={() => patchForm('flipHorizontal', !form.flipHorizontal)} />
      <IconButton icon={<PaperProfileIcon name="flip-vertical" />} label={t('page.paperProfiles.flipVertical')} active={Boolean(form.flipVertical)}
        onClick={() => patchForm('flipVertical', !form.flipVertical)} />
      <span className="pp-feed-preview" role="img"
        aria-label={`${t('page.paperProfiles.printerFeedPreview')}: ${rotation}°`}
        title={`${t('page.paperProfiles.printerFeedPreview')}: ${rotation}°`}>
        <span className="pp-feed-preview__paper"
          style={{
            width: ratio >= 1 ? 22 : 22 * ratio,
            height: ratio >= 1 ? 22 / ratio : 22,
            transform: renderTransformCss(resolveRenderTransform(form)),
          }}>A</span>
        <span className="pp-feed-preview__angle">{rotation}°</span>
      </span>
      <Button variant="secondary" size="sm" className="pp-canvas-fit" onClick={onExpand}>
        {t('page.paperProfiles.expandCanvas')}
      </Button>
    </div>
  );
}
