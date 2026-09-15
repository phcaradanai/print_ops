export {
  default,
} from '../features/paper-profiles/PaperProfileWorkspace.js';

export type {
  ImportFitMode,
  ImportPhase,
} from '../features/paper-profiles/model/types.js';

export {
  DEFAULT_BARCODE_HEIGHT_MM,
  DEFAULT_QR_SIZE_MM,
} from '../features/paper-profiles/model/defaults.js';

export {
  nextSaveStatus,
} from '../features/paper-profiles/state/editorReducer.js';

export {
  getFieldInspectorState,
} from '../features/paper-profiles/state/selectors.js';

export {
  getIconButtonAriaLabel,
  getIconButtonTooltipText,
  isIconButtonActionBlocked,
} from '../features/paper-profiles/components/editorPrimitives.js';

export {
  CANVAS_SCALE_MAX,
  CANVAS_SCALE_MIN,
  CANVAS_SCALE_STEP,
  clampFontSize,
  clampGridSpacing,
  clampPreviewZoom,
  fontPointSizeToPreviewPixels,
  getVisualPaperGeometry,
  mapPrintablePointToVisual,
  mapVisualPointToPrintable,
  nudgePrintablePoint,
  stepPreviewZoom,
} from '../features/paper-profiles/model/geometry.js';

export {
  anchorTransform,
  anchorTransformOrigin,
  centerFieldAnchorHorizontal,
  centerFieldAnchorVertical,
  resolveSelectionAfterDelete,
} from '../features/paper-profiles/model/fieldGeometry.js';

export {
  validateImportDraft,
  validatePaperForm,
} from '../features/paper-profiles/model/validation.js';

export {
  ACCEPTED_IMPORT_MIME_TYPES,
  MAX_IMPORT_FILE_BYTES,
  buildImportRequestBody,
  generateImportCode,
  importFitModeToCss,
  inferMimeFromExtension,
  isAcceptedImportExtension,
  isAcceptedImportMime,
  isLowImportDpi,
  isValidImportFileSize,
  nextImportPhase,
} from '../features/paper-profiles/model/importDesign.js';
