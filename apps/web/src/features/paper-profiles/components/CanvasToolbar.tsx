import { Button } from '../../../components/ui/index.js';
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

export function CanvasToolbar({ options, setOptions, onExpand, t }: {
  options: CanvasOptions;
  setOptions: (patch: Partial<CanvasOptions>) => void;
  onExpand: () => void;
  t: Translate;
}) {
  const grid = options.verticalGrid || options.horizontalGrid;
  return (
    <div className="pp-canvas-toolbar" role="toolbar" aria-label={t('page.paperProfiles.canvasControls')}>
      <IconButton icon={<PaperProfileIcon name="grid" />} label={t('page.paperProfiles.toggleGrid')} active={grid}
        onClick={() => setOptions({ verticalGrid: !grid, horizontalGrid: !grid })} />
      <IconButton icon={<PaperProfileIcon name="ruler" />} label={t('page.paperProfiles.toggleRulers')} active={options.rulers}
        onClick={() => setOptions({ rulers: !options.rulers })} />
      <IconButton icon={<PaperProfileIcon name="dimensions" />} label={t('page.paperProfiles.showFieldDimensions')} active={options.dimensions}
        onClick={() => setOptions({ dimensions: !options.dimensions })} />
      <Button variant="secondary" size="sm" className="pp-canvas-fit" onClick={onExpand}>
        {t('page.paperProfiles.expandCanvas')}
      </Button>
    </div>
  );
}
