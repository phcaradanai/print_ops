import {
  resolveRenderTransform,
  resolveRenderTransformFrame,
  qrQuietZoneUpperBoundMm,
  transformedRectBounds,
} from '@printerops/shared';
import type { DynamicField, PaperForm, ValidationIssue } from './types.js';
import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_BARCODE_WIDTH_MM, DEFAULT_QR_SIZE_MM } from './defaults.js';
import { getVisualPaperGeometry, mapPrintablePointToVisual } from './geometry.js';

type PaperFormForValidation = Pick<
  PaperForm,
  | 'name'
  | 'widthMm'
  | 'heightMm'
  | 'gapMm'
  | 'dpi'
  | 'marginTopMm'
  | 'marginRightMm'
  | 'marginBottomMm'
  | 'marginLeftMm'
  | 'layout'
> & Partial<Pick<PaperForm, 'rotation' | 'flipHorizontal' | 'flipVertical'>>;

function validateLayout(form: PaperFormForValidation): ValidationIssue[] {
  const layout = form.layout;
  if (!layout) return [];
  const issues: ValidationIssue[] = [];
  const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
  if (!Number.isInteger(layout.columns) || layout.columns < 1) issues.push({ field: 'layout.columns', messageKey: 'validation.layoutColumns' });
  if (!finitePositive(layout.cellWidthMm)) issues.push({ field: 'layout.cellWidthMm', messageKey: 'validation.layoutPositive' });
  if (!finitePositive(layout.cellHeightMm)) issues.push({ field: 'layout.cellHeightMm', messageKey: 'validation.layoutPositive' });
  if (!Number.isFinite(layout.columnGapMm) || layout.columnGapMm < 0) issues.push({ field: 'layout.columnGapMm', messageKey: 'validation.layoutGap' });
  if (!finitePositive(layout.rowPitchMm)) issues.push({ field: 'layout.rowPitchMm', messageKey: 'validation.layoutPositive' });
  const printableWidth = form.widthMm - form.marginLeftMm - form.marginRightMm;
  const printableHeight = form.heightMm - form.marginTopMm - form.marginBottomMm;
  const usedWidth = layout.columns * layout.cellWidthMm + Math.max(0, layout.columns - 1) * layout.columnGapMm;
  if (Number.isFinite(usedWidth) && usedWidth > printableWidth + 0.0001) issues.push({ field: 'layout', messageKey: 'validation.layoutDoesNotFitWidth' });
  if (Number.isFinite(layout.cellHeightMm) && layout.cellHeightMm > printableHeight + 0.0001) issues.push({ field: 'layout.cellHeightMm', messageKey: 'validation.layoutDoesNotFitHeight' });
  if (Number.isFinite(layout.rowPitchMm) && Number.isFinite(layout.cellHeightMm) && layout.rowPitchMm < layout.cellHeightMm) issues.push({ field: 'layout.rowPitchMm', messageKey: 'validation.layoutPitch' });
  return issues;
}

export function validatePaperForm(form: PaperFormForValidation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!form.name.trim()) issues.push({ field: 'name', messageKey: 'validation.nameRequired' });
  if (form.widthMm <= 0) issues.push({ field: 'widthMm', messageKey: 'validation.dimensionsPositive' });
  if (form.heightMm <= 0) issues.push({ field: 'heightMm', messageKey: 'validation.dimensionsPositive' });
  if (form.dpi <= 0) issues.push({ field: 'dpi', messageKey: 'validation.dpiPositive' });
  if (form.rotation !== undefined && (!Number.isFinite(form.rotation) || form.rotation < 0 || form.rotation >= 360)) {
    issues.push({ field: 'rotation', messageKey: 'validation.rotationRange' });
  }
  if (form.flipHorizontal !== undefined && typeof form.flipHorizontal !== 'boolean') {
    issues.push({ field: 'flipHorizontal', messageKey: 'validation.boolean' });
  }
  if (form.flipVertical !== undefined && typeof form.flipVertical !== 'boolean') {
    issues.push({ field: 'flipVertical', messageKey: 'validation.boolean' });
  }
  if (form.gapMm !== undefined && (!Number.isFinite(form.gapMm) || form.gapMm < 0)) issues.push({ field: 'gapMm', messageKey: 'validation.gapNonNegative' });
  if (form.marginTopMm < 0) issues.push({ field: 'marginTopMm', messageKey: 'validation.marginsNonNegative' });
  if (form.marginRightMm < 0) issues.push({ field: 'marginRightMm', messageKey: 'validation.marginsNonNegative' });
  if (form.marginBottomMm < 0) issues.push({ field: 'marginBottomMm', messageKey: 'validation.marginsNonNegative' });
  if (form.marginLeftMm < 0) issues.push({ field: 'marginLeftMm', messageKey: 'validation.marginsNonNegative' });
  if (form.marginLeftMm + form.marginRightMm >= form.widthMm) {
    issues.push({ field: 'margins', messageKey: 'validation.marginsExceedWidth' });
  }
  if (form.marginTopMm + form.marginBottomMm >= form.heightMm) {
    issues.push({ field: 'margins', messageKey: 'validation.marginsExceedHeight' });
  }
  issues.push(...validateLayout(form));
  return issues;
}

export function getDynamicFieldTransformedBounds(form: PaperForm, field: DynamicField) {
  const geometry = getVisualPaperGeometry(form);
  const transform = resolveRenderTransform(form);
  const frame = resolveRenderTransformFrame(geometry.widthMm, geometry.heightMm, transform);
  const point = mapPrintablePointToVisual(field.xMm, field.yMm, geometry);
  const size = getDynamicFieldSize(field);
  const anchorX = geometry.marginLeftMm + point.xMm;
  const anchorY = geometry.marginTopMm + point.yMm;
  const left = field.align === 'center' ? anchorX - size.widthMm / 2
    : field.align === 'right' ? anchorX - size.widthMm
      : anchorX;
  const bounds = transformedRectBounds(
    left,
    anchorY,
    size.widthMm,
    size.heightMm,
    geometry.widthMm,
    geometry.heightMm,
    transform,
  );
  return {
    ...bounds,
    minX: bounds.minX + frame.offsetX,
    minY: bounds.minY + frame.offsetY,
    maxX: bounds.maxX + frame.offsetX,
    maxY: bounds.maxY + frame.offsetY,
  };
}

export function validateDynamicFields(form: PaperForm, fields: DynamicField[]): ValidationIssue[] {
  const geometry = getVisualPaperGeometry(form);
  const transform = resolveRenderTransform(form);
  const frame = resolveRenderTransformFrame(geometry.widthMm, geometry.heightMm, transform);
  if (![geometry.widthMm, geometry.heightMm, frame.width, frame.height].every(Number.isFinite)) return [];
  const epsilon = 0.0001;
  return fields.flatMap((field) => {
    const bounds = getDynamicFieldTransformedBounds(form, field);
    const fits = bounds.minX >= -epsilon
      && bounds.minY >= -epsilon
      && bounds.maxX <= frame.width + epsilon
      && bounds.maxY <= frame.height + epsilon;
    return fits ? [] : [{ field: `fields.${field.id}`, messageKey: 'validation.fieldOutsidePaper' }];
  });
}

function getDynamicFieldSize(field: DynamicField): { widthMm: number; heightMm: number } {
  if (field.type === 'qrcode') {
    const sizeMm = field.qrSizeMm ?? DEFAULT_QR_SIZE_MM;
    const quietZoneMm = qrQuietZoneUpperBoundMm(sizeMm);
    return { widthMm: sizeMm + quietZoneMm * 2, heightMm: sizeMm + quietZoneMm * 2 };
  }
  if (field.type === 'barcode') {
    return {
      widthMm: field.barcodeWidthMm ?? DEFAULT_BARCODE_WIDTH_MM,
      heightMm: field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM,
    };
  }
  const sample = field.defaultValue || field.label || field.key || 'field';
  const charWidthMm = field.fontSize * 25.4 * 0.6 / 72;
  return {
    widthMm: Math.max(charWidthMm, sample.length * charWidthMm),
    heightMm: field.fontSize * 25.4 * 1.2 / 72,
  };
}

export interface ImportDraftForValidation extends PaperFormForValidation {
  code: string;
}

export function validateImportDraft(draft: ImportDraftForValidation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!draft.name.trim()) issues.push({ field: 'name', messageKey: 'validation.nameRequired' });
  if (!draft.code.trim()) issues.push({ field: 'code', messageKey: 'validation.nameRequired' });
  if (draft.rotation !== undefined && (!Number.isFinite(draft.rotation) || draft.rotation < 0 || draft.rotation >= 360)) {
    issues.push({ field: 'rotation', messageKey: 'validation.rotationRange' });
  }
  if (draft.flipHorizontal !== undefined && typeof draft.flipHorizontal !== 'boolean') {
    issues.push({ field: 'flipHorizontal', messageKey: 'validation.boolean' });
  }
  if (draft.flipVertical !== undefined && typeof draft.flipVertical !== 'boolean') {
    issues.push({ field: 'flipVertical', messageKey: 'validation.boolean' });
  }
  if (!Number.isFinite(draft.widthMm) || draft.widthMm <= 0) {
    issues.push({ field: 'widthMm', messageKey: 'validation.dimensionsPositive' });
  }
  if (!Number.isFinite(draft.heightMm) || draft.heightMm <= 0) {
    issues.push({ field: 'heightMm', messageKey: 'validation.dimensionsPositive' });
  }
  if (draft.gapMm !== undefined && (!Number.isFinite(draft.gapMm) || draft.gapMm < 0)) issues.push({ field: 'gapMm', messageKey: 'validation.gapNonNegative' });
  if (!Number.isFinite(draft.dpi) || draft.dpi <= 0) {
    issues.push({ field: 'dpi', messageKey: 'validation.dpiPositive' });
  }
  if (draft.marginTopMm < 0) issues.push({ field: 'marginTopMm', messageKey: 'validation.marginsNonNegative' });
  if (draft.marginRightMm < 0) issues.push({ field: 'marginRightMm', messageKey: 'validation.marginsNonNegative' });
  if (draft.marginBottomMm < 0) issues.push({ field: 'marginBottomMm', messageKey: 'validation.marginsNonNegative' });
  if (draft.marginLeftMm < 0) issues.push({ field: 'marginLeftMm', messageKey: 'validation.marginsNonNegative' });
  if (draft.marginLeftMm + draft.marginRightMm >= draft.widthMm) {
    issues.push({ field: 'margins', messageKey: 'validation.marginsExceedWidth' });
  }
  if (draft.marginTopMm + draft.marginBottomMm >= draft.heightMm) {
    issues.push({ field: 'margins', messageKey: 'validation.marginsExceedHeight' });
  }
  issues.push(...validateLayout(draft));
  return issues;
}
