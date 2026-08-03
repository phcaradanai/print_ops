import type { PaperForm, ValidationIssue } from './types.js';

type PaperFormForValidation = Pick<
  PaperForm,
  | 'name'
  | 'widthMm'
  | 'heightMm'
  | 'dpi'
  | 'marginTopMm'
  | 'marginRightMm'
  | 'marginBottomMm'
  | 'marginLeftMm'
>;

export function validatePaperForm(form: PaperFormForValidation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!form.name.trim()) issues.push({ field: 'name', messageKey: 'validation.nameRequired' });
  if (form.widthMm <= 0) issues.push({ field: 'widthMm', messageKey: 'validation.dimensionsPositive' });
  if (form.heightMm <= 0) issues.push({ field: 'heightMm', messageKey: 'validation.dimensionsPositive' });
  if (form.dpi <= 0) issues.push({ field: 'dpi', messageKey: 'validation.dpiPositive' });
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
  return issues;
}

export interface ImportDraftForValidation extends PaperFormForValidation {
  code: string;
}

export function validateImportDraft(draft: ImportDraftForValidation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!draft.name.trim()) issues.push({ field: 'name', messageKey: 'validation.nameRequired' });
  if (!draft.code.trim()) issues.push({ field: 'code', messageKey: 'validation.nameRequired' });
  if (!Number.isFinite(draft.widthMm) || draft.widthMm <= 0) {
    issues.push({ field: 'widthMm', messageKey: 'validation.dimensionsPositive' });
  }
  if (!Number.isFinite(draft.heightMm) || draft.heightMm <= 0) {
    issues.push({ field: 'heightMm', messageKey: 'validation.dimensionsPositive' });
  }
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
  return issues;
}
