import type { ImportFitMode, ImportPhase, ImportRequestBody } from './types.js';

export const ACCEPTED_IMPORT_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

export function isAcceptedImportMime(mime: string): boolean {
  return ACCEPTED_IMPORT_MIME_TYPES.includes(mime as (typeof ACCEPTED_IMPORT_MIME_TYPES)[number]);
}

export function isAcceptedImportExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');
}

export function isValidImportFileSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_IMPORT_FILE_BYTES;
}

export function isLowImportDpi(dpi: number | null): boolean {
  return dpi !== null && dpi < 150;
}

export function nextImportPhase(
  current: ImportPhase,
  action: 'file-selected' | 'analyzed' | 'review' | 'submitted' | 'done' | 'fail' | 'reset',
): ImportPhase {
  switch (action) {
    case 'file-selected':
      return 'analyzing';
    case 'analyzed':
      return 'review';
    case 'review':
      return current === 'review' ? 'review' : current;
    case 'submitted':
      return 'importing';
    case 'done':
      return 'success';
    case 'fail':
      return 'error';
    case 'reset':
      return 'select';
  }
}

export function inferMimeFromExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return '';
}

export function importFitModeToCss(fitMode: ImportFitMode): 'contain' | 'cover' | 'fill' {
  if (fitMode === 'stretch') return 'fill';
  if (fitMode === 'cover') return 'cover';
  return 'contain';
}

export function generateImportCode(basename: string): string {
  const sanitized = basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
  const suffix = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return sanitized ? `${sanitized}_${suffix}` : `pp_${suffix}`;
}

export function buildImportRequestBody(
  fileName: string,
  declaredMimeType: string,
  dataBase64: string,
  profile: ImportRequestBody['profile'],
  fitMode: ImportFitMode,
): ImportRequestBody {
  return { fileName, declaredMimeType, dataBase64, profile, fitMode };
}
