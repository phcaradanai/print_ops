/**
 * Paper Profile Import Service
 *
 * Handles raster (PNG/JPEG) image analysis and import into PaperProfile +
 * ImportedDesign entities. PDF/SVG/native formats are intentionally
 * unsupported in M1.
 */

import type {
  PaperProfileRepositoryPort,
  ImportedDesignRepositoryPort,
  AuditRepositoryPort,
  CreatePaperProfileInput,
  PaperProfile,
  ImportedDesign,
  FitMode,
} from '@printerops/domain';
import { AppError, ValidationError, ConflictError } from '@printerops/shared';
import { parseImageBytes } from './image-parser.js';

// ---- constants ----

const MAX_PROFILE_DIMENSION_MM = 1000;

// ---- types ----

export interface AnalyzeRequest {
  fileName: string;
  declaredMimeType: string;
  dataBase64: string;
}

export interface AnalyzeResponse {
  detectedMimeType: string;
  fileSizeBytes: number;
  sha256: string;
  pixelWidth: number;
  pixelHeight: number;
  detectedDpi: number | null;
  suggestedDpi: number;
  suggestedWidthMm: number;
  suggestedHeightMm: number;
  warnings: string[];
}

export interface ImportRequest {
  fileName: string;
  declaredMimeType: string;
  dataBase64: string;
  profile: {
    code: string;
    name: string;
    widthMm: number;
    heightMm: number;
    marginTopMm: number;
    marginRightMm: number;
    marginBottomMm: number;
    marginLeftMm: number;
    dpi: number;
    orientation: string;
    unit: string;
  };
  fitMode: FitMode;
}

export interface ImportResponse {
  profile: PaperProfile;
  artwork: Omit<ImportedDesign, 'dataBase64'>;
  duplicate: boolean;
}

export interface ArtworkResponse {
  id: string;
  paperProfileId: string;
  sha256: string;
  fileName: string;
  mimeType: string;
  fitMode: FitMode;
  pixelWidth: number;
  pixelHeight: number;
  detectedDpi: number | null;
  dataBase64: string;
}

// ---- service ----

export class ImportPaperProfileService {
  constructor(
    private readonly paperProfiles: PaperProfileRepositoryPort,
    private readonly importedDesigns: ImportedDesignRepositoryPort,
    private readonly audit: AuditRepositoryPort,
  ) {}

  /**
   * Analyze uploaded image bytes — extract metadata without persisting.
   */
  async analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    validateRequestObject(req);
    const fileName = sanitizeFilename(req.fileName);
    const declaredMimeType = validateDeclaredMime(req.declaredMimeType);
    const buffer = decodeBase64(req.dataBase64);

    const info = parseImageBytes(buffer, declaredMimeType);

    const suggestedDpi = info.detectedDpi ?? 300;
    const suggestedWidthMm = Math.round((info.pixelWidth / suggestedDpi) * 25.4 * 100) / 100;
    const suggestedHeightMm = Math.round((info.pixelHeight / suggestedDpi) * 25.4 * 100) / 100;

    return {
      detectedMimeType: info.detectedMimeType,
      fileSizeBytes: info.fileSizeBytes,
      sha256: info.sha256,
      pixelWidth: info.pixelWidth,
      pixelHeight: info.pixelHeight,
      detectedDpi: info.detectedDpi,
      suggestedDpi,
      suggestedWidthMm,
      suggestedHeightMm,
      warnings: info.warnings,
    };
  }

  /**
   * Full import: parse, validate, dedup by sha256, create profile + artwork.
   * Rolls back the profile if artwork persistence fails.
   */
  async import(req: ImportRequest, actorId = 'system'): Promise<ImportResponse> {
    validateRequestObject(req);
    const fileName = sanitizeFilename(req.fileName);
    const declaredMimeType = validateDeclaredMime(req.declaredMimeType);
    const buffer = decodeBase64(req.dataBase64);
    validateFitMode(req.fitMode);
    validateProfileInput(req.profile);

    const info = parseImageBytes(buffer, declaredMimeType);

    // Dedup: check if this exact file was already imported
    const existingArtwork = await this.importedDesigns.findBySha256(info.sha256);
    if (existingArtwork) {
      const existingProfile = await this.paperProfiles.findById(existingArtwork.paperProfileId);
      if (existingProfile) {
        const { dataBase64: _, ...safeArtwork } = existingArtwork;
        return {
          profile: existingProfile,
          artwork: safeArtwork,
          duplicate: true,
        };
      }
    }

    // Create profile
    let profile: PaperProfile | undefined;
    try {
      const createInput: CreatePaperProfileInput = {
        code: req.profile.code.trim(),
        name: req.profile.name.trim(),
        widthMm: req.profile.widthMm,
        heightMm: req.profile.heightMm,
        marginTopMm: req.profile.marginTopMm,
        marginRightMm: req.profile.marginRightMm,
        marginBottomMm: req.profile.marginBottomMm,
        marginLeftMm: req.profile.marginLeftMm,
        dpi: req.profile.dpi,
        orientation: req.profile.orientation as PaperProfile['orientation'],
        unit: req.profile.unit as PaperProfile['unit'],
      };
      profile = await this.paperProfiles.create(createInput);
    } catch (err: unknown) {
      // Detect duplicate code
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already exists')) {
        throw new ConflictError(`Paper profile code "${req.profile.code}" already exists`);
      }
      if (err instanceof AppError) throw err;
      throw new AppError('IMPORT_FAILED', 'Failed to create paper profile', 500);
    }

    let artwork: ImportedDesign;
    try {
      artwork = await this.importedDesigns.create({
        paperProfileId: profile.id,
        sha256: info.sha256,
        fileName,
        mimeType: info.detectedMimeType,
        fitMode: req.fitMode,
        dataBase64: req.dataBase64,
        pixelWidth: info.pixelWidth,
        pixelHeight: info.pixelHeight,
        detectedDpi: info.detectedDpi,
      });

    } catch (err: unknown) {
      try {
        await this.paperProfiles.delete(profile.id);
      } catch {
        // Preserve the original persistence error.
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new AppError('ARTWORK_PERSIST_FAILED', `Failed to persist artwork: ${message}`, 500);
    }

    // The imported pair is authoritative. Audit failure must not create an orphan.
    try {
      await this.audit.create({
        traceId: `import_${profile.id}`,
        action: 'paper_profile.artwork_imported',
        actorId,
        resourceType: 'paper_profile',
        resourceId: profile.id,
        after: {
          sha256: info.sha256,
          fileName,
          mimeType: info.detectedMimeType,
          pixelWidth: info.pixelWidth,
          pixelHeight: info.pixelHeight,
          detectedDpi: info.detectedDpi,
          fitMode: req.fitMode,
        } as unknown as Record<string, unknown>,
        metadata: {},
      });
    } catch {
      // Audit is best-effort; profile and artwork already form a consistent pair.
    }

    const { dataBase64: _, ...safeArtwork } = artwork;
    return { profile, artwork: safeArtwork, duplicate: false };
  }

  /**
   * Get artwork for an existing paper profile.
   */
  async getArtwork(paperProfileId: string): Promise<ArtworkResponse> {
    const artwork = await this.importedDesigns.findByPaperProfileId(paperProfileId);
    if (!artwork) {
      throw new AppError('ARTWORK_NOT_FOUND', 'No artwork found for this paper profile', 404);
    }
    return {
      id: artwork.id,
      paperProfileId: artwork.paperProfileId,
      sha256: artwork.sha256,
      fileName: artwork.fileName,
      mimeType: artwork.mimeType,
      fitMode: artwork.fitMode,
      pixelWidth: artwork.pixelWidth,
      pixelHeight: artwork.pixelHeight,
      detectedDpi: artwork.detectedDpi,
      dataBase64: artwork.dataBase64,
    };
  }
}

// ---- validation helpers ----

function decodeBase64(dataBase64: string): Buffer {
  // Reject data URIs
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    throw new ValidationError('Empty base64 data');
  }

  // Reject data URI prefix
  if (/^data:/i.test(dataBase64)) {
    throw new ValidationError('Data URIs are not accepted — send raw base64');
  }

  // Length must be a multiple of 4
  if (dataBase64.length % 4 !== 0) {
    throw new ValidationError('Invalid base64 length: must be a multiple of 4');
  }

  // Only canonical alphabet
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
    throw new ValidationError('Invalid base64: contains non-standard characters');
  }

  // Check decoded size before allocating
  const padding = dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0;
  const decodedLen = Math.floor((dataBase64.length * 3) / 4) - padding;
  if (decodedLen > 8 * 1024 * 1024) {
    throw new ValidationError(
      `Base64 payload too large: ~${Math.round(decodedLen / 1024)} KiB decoded`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    throw new ValidationError('Invalid base64 encoding');
  }

  // Canonical re-encode check: round-trip must match
  const reEncoded = buffer.toString('base64');
  if (reEncoded !== dataBase64) {
    throw new ValidationError('Non-canonical base64: padding or encoding mismatch');
  }

  return buffer;
}

function sanitizeFilename(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ValidationError('Filename is required');
  }

  // Extract basename (strip path)
  let name = raw.replace(/^.*[/\\]/, '');

  // Remove control characters
  name = name.replace(/[\x00-\x1f\x7f]/g, '');

  // Truncate to 255 chars
  if (name.length > 255) {
    const ext = name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')) : '';
    name = name.slice(0, 255 - ext.length) + ext;
  }

  if (name.length === 0) {
    throw new ValidationError('Filename is empty after sanitization');
  }

  return name;
}

function validateDeclaredMime(mime: string): string {
  const trimmed = (mime || '').trim().toLowerCase();
  if (!['image/png', 'image/jpeg'].includes(trimmed)) {
    throw new ValidationError('declaredMimeType must be image/png or image/jpeg');
  }
  return trimmed;
}

function validateFitMode(mode: string): void {
  if (!['contain', 'cover', 'stretch'].includes(mode)) {
    throw new ValidationError(
      `Invalid fitMode "${mode}" — must be contain, cover, or stretch`,
    );
  }
}

function validateProfileInput(profile: ImportRequest['profile']): void {
  if (!profile || typeof profile !== 'object') {
    throw new ValidationError('profile is required');
  }
  const errors: string[] = [];

  // Trim and validate code/name
  const code = typeof profile.code === 'string' ? profile.code.trim() : '';
  const name = typeof profile.name === 'string' ? profile.name.trim() : '';

  if (!code || code.length === 0) {
    errors.push('profile.code is required (non-empty after trimming)');
  } else if (code.length > 100) {
    errors.push('profile.code must be ≤ 100 characters');
  }
  if (!name || name.length === 0) {
    errors.push('profile.name is required (non-empty after trimming)');
  } else if (name.length > 255) {
    errors.push('profile.name must be ≤ 255 characters');
  }

  const dims: Array<[string, number]> = [
    ['widthMm', profile.widthMm],
    ['heightMm', profile.heightMm],
    ['marginTopMm', profile.marginTopMm],
    ['marginRightMm', profile.marginRightMm],
    ['marginBottomMm', profile.marginBottomMm],
    ['marginLeftMm', profile.marginLeftMm],
  ];
  for (const [dimName, val] of dims) {
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > MAX_PROFILE_DIMENSION_MM) {
      errors.push(
        `profile.${dimName} must be a finite number between 0 and ${MAX_PROFILE_DIMENSION_MM}, got ${val}`,
      );
    }
  }

  if (typeof profile.widthMm !== 'number' || !Number.isFinite(profile.widthMm) || profile.widthMm <= 0) {
    errors.push('profile.widthMm must be a finite number > 0');
  }
  if (typeof profile.heightMm !== 'number' || !Number.isFinite(profile.heightMm) || profile.heightMm <= 0) {
    errors.push('profile.heightMm must be a finite number > 0');
  }

  // Margin sum validation: margins cannot exceed dimensions
  if (
    typeof profile.marginLeftMm === 'number' && Number.isFinite(profile.marginLeftMm) &&
    typeof profile.marginRightMm === 'number' && Number.isFinite(profile.marginRightMm) &&
    typeof profile.widthMm === 'number' && Number.isFinite(profile.widthMm) &&
    (profile.marginLeftMm + profile.marginRightMm >= profile.widthMm)
  ) {
    errors.push('profile.marginLeftMm + marginRightMm must be less than widthMm');
  }
  if (
    typeof profile.marginTopMm === 'number' && Number.isFinite(profile.marginTopMm) &&
    typeof profile.marginBottomMm === 'number' && Number.isFinite(profile.marginBottomMm) &&
    typeof profile.heightMm === 'number' && Number.isFinite(profile.heightMm) &&
    (profile.marginTopMm + profile.marginBottomMm >= profile.heightMm)
  ) {
    errors.push('profile.marginTopMm + marginBottomMm must be less than heightMm');
  }

  if (typeof profile.dpi !== 'number' || !Number.isFinite(profile.dpi) || profile.dpi <= 0 || profile.dpi > 2400) {
    errors.push('profile.dpi must be a finite number between 1 and 2400');
  }

  if (!['portrait', 'landscape'].includes(profile.orientation)) {
    errors.push('profile.orientation must be portrait or landscape');
  }

  if (!['mm', 'inch'].includes(profile.unit)) {
    errors.push('profile.unit must be mm or inch');
  }

  if (errors.length > 0) {
    throw new ValidationError('Invalid profile', errors);
  }
}

function validateRequestObject(req: unknown): asserts req is AnalyzeRequest | ImportRequest {
  if (!req || typeof req !== 'object') {
    throw new ValidationError('JSON request body is required');
  }
}
