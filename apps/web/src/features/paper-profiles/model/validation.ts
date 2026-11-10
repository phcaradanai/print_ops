import {
  fieldContentBounds,
  fieldContentFitsPaper,
  maxFieldContentMm,
  maxFieldSymbolSizeMm,
  qrQuietZoneUpperBoundMm,
  resolveRenderTransform,
  resolveRenderTransformFrame,
  type FieldContentBounds,
  type FieldContentBox,
} from '@printerops/shared';
import type { DynamicField, PaperForm, ValidationIssue } from './types.js';
import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_BARCODE_WIDTH_MM, DEFAULT_QR_SIZE_MM } from './defaults.js';
import { getVisualPaperGeometry } from './geometry.js';

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

/**
 * Text advance estimate, deliberately crude and shared with nothing else: a
 * glyph is `TEXT_GLYPH_ADVANCE_EM` of the font size wide and a line is
 * `TEXT_LINE_HEIGHT_EM` tall. It over-estimates proportional lowercase and
 * under-estimates wide scripts, so it only ever quotes a character budget or
 * warns an operator — it never moves a field on its own.
 */
const TEXT_GLYPH_ADVANCE_EM = 0.6;
const TEXT_LINE_HEIGHT_EM = 1.2;

/** Advance width of one glyph at `fontSizePt`, in millimetres. */
export function textGlyphWidthMm(fontSizePt: number): number {
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) return 0;
  return (fontSizePt * 25.4 * TEXT_GLYPH_ADVANCE_EM) / 72;
}

/** One-line text box estimate: `text.length` glyphs wide, one line high. */
export function estimateTextFieldSizeMm(text: string, fontSizePt: number): { widthMm: number; heightMm: number } {
  const glyphWidthMm = textGlyphWidthMm(fontSizePt);
  return {
    widthMm: Math.max(glyphWidthMm, text.length * glyphWidthMm),
    heightMm: (fontSizePt * 25.4 * TEXT_LINE_HEIGHT_EM) / 72,
  };
}

/**
 * Characters that still fit on one line in `availableWidthMm` at `fontSizePt`,
 * floored so the quoted budget never names a count that itself overflows.
 */
export function textFieldMaxCharacters(availableWidthMm: number, fontSizePt: number): number {
  const glyphWidthMm = textGlyphWidthMm(fontSizePt);
  if (glyphWidthMm <= 0 || !Number.isFinite(availableWidthMm) || availableWidthMm <= 0) return 0;
  return Math.floor((availableWidthMm - 1e-9) / glyphWidthMm);
}

function isMachineReadableField(field: DynamicField): boolean {
  return field.type === 'barcode' || field.type === 'qrcode';
}

/** Text a field is measured with while nothing has been printed yet. */
function sampleTextForField(field: DynamicField): string {
  return field.defaultValue || field.label || field.key || 'field';
}

export function getDynamicFieldSize(field: DynamicField): { widthMm: number; heightMm: number } {
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
  return estimateTextFieldSizeMm(sampleTextForField(field), field.fontSize);
}

export function getDynamicFieldContentBox(field: DynamicField): FieldContentBox {
  const size = getDynamicFieldSize(field);
  return {
    xMm: field.xMm,
    yMm: field.yMm,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    align: field.align,
  };
}

/** Frame-relative bounds of the field's printed content, in millimetres. */
export function getDynamicFieldTransformedBounds(form: PaperForm, field: DynamicField): FieldContentBounds {
  return fieldContentBounds(getVisualPaperGeometry(form), resolveRenderTransform(form), getDynamicFieldContentBox(field));
}

export interface DynamicFieldLimits {
  maxWidthMm: number;
  maxHeightMm: number;
  /** Characters that fit on one line, or null for barcode/QR codes, whose
   * limits are the box itself. */
  maxChars: number | null;
  charWidthMm: number | null;
  /** Whether the anchor itself — not just the content — is on the paper. */
  anchorInsidePaper: boolean;
}

/** What this field can still hold at its position, rotation and font size. */
export function getDynamicFieldLimits(form: PaperForm, field: DynamicField): DynamicFieldLimits | null {
  const geometry = getVisualPaperGeometry(form);
  const transform = resolveRenderTransform(form);
  const frame = resolveRenderTransformFrame(geometry.widthMm, geometry.heightMm, transform);
  if (![geometry.widthMm, geometry.heightMm, frame.width, frame.height].every(Number.isFinite)) return null;
  const box = getDynamicFieldContentBox(field);
  const isText = !isMachineReadableField(field);
  // Text keeps its font size, so only the width can grow; a symbol keeps its
  // shape, so both sides grow together.
  const limits = isText
    ? maxFieldContentMm(geometry, transform, box)
    : maxFieldSymbolSizeMm(geometry, transform, box);
  return {
    maxWidthMm: limits.maxWidthMm,
    maxHeightMm: limits.maxHeightMm,
    charWidthMm: isText ? textGlyphWidthMm(field.fontSize) : null,
    maxChars: isText ? textFieldMaxCharacters(limits.maxWidthMm, field.fontSize) : null,
    anchorInsidePaper: fieldContentFitsPaper(geometry, transform, { ...box, widthMm: 0, heightMm: 0 }),
  };
}

export interface DynamicFieldDiagnostics {
  /** Blocking: the profile cannot print this field where it is configured. */
  errors: ValidationIssue[];
  /** Content that prints clipped. The payload decides the real width, so this
   * warns instead of blocking a save. */
  warnings: ValidationIssue[];
}

export function validateDynamicFieldDiagnostics(form: PaperForm, fields: DynamicField[]): DynamicFieldDiagnostics {
  const geometry = getVisualPaperGeometry(form);
  const transform = resolveRenderTransform(form);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  for (const field of fields) {
    const box = getDynamicFieldContentBox(field);
    const name = field.label.trim() || field.key.trim() || field.id;
    if (!fieldContentFitsPaper(geometry, transform, { ...box, widthMm: 0, heightMm: 0 })) {
      errors.push({
        field: `fields.${field.id}`,
        messageKey: 'validation.fieldAnchorOutsidePaper',
        params: { name, xMm: Number(field.xMm.toFixed(1)), yMm: Number(field.yMm.toFixed(1)) },
      });
      continue;
    }
    if (fieldContentFitsPaper(geometry, transform, box)) continue;
    if (isMachineReadableField(field)) {
      const limits = maxFieldSymbolSizeMm(geometry, transform, box);
      errors.push({
        field: `fields.${field.id}`,
        messageKey: 'validation.fieldOutsidePaper',
        params: {
          name,
          widthMm: Number(box.widthMm.toFixed(1)),
          heightMm: Number(box.heightMm.toFixed(1)),
          maxWidthMm: limits.maxWidthMm,
          maxHeightMm: limits.maxHeightMm,
        },
      });
      continue;
    }
    const limits = maxFieldContentMm(geometry, transform, box);
    warnings.push({
      field: `fields.${field.id}`,
      messageKey: 'validation.fieldTextOverflow',
      params: {
        name,
        chars: sampleTextForField(field).length,
        maxChars: textFieldMaxCharacters(limits.maxWidthMm, field.fontSize),
        fontSize: field.fontSize,
      },
    });
  }
  return { errors, warnings };
}

/** Blocking field problems only. */
export function validateDynamicFields(form: PaperForm, fields: DynamicField[]): ValidationIssue[] {
  return validateDynamicFieldDiagnostics(form, fields).errors;
}

/** Fill `{name}` placeholders, the shape the dictionaries already use. */
export function formatMessage(template: string, params: Record<string, string | number>): string {
  let message = template;
  for (const [key, value] of Object.entries(params)) {
    message = message.split(`{${key}}`).join(String(value));
  }
  return message;
}

export function formatValidationIssue(translate: (key: string) => string, issue: ValidationIssue): string {
  return formatMessage(translate(issue.messageKey), issue.params ?? {});
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
