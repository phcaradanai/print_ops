/**
 * Pure binary PNG/JPEG parser — zero dependencies, no decompression.
 *
 * - Detects MIME type by magic bytes only (never trusts extension/MIME).
 * - PNG: reads IHDR (dimensions) + optional pHYs (DPI from pixels-per-meter).
 * - JPEG: reads SOF markers (dimensions) + JFIF density (DPI) when present.
 * - Rejects buffers > 8 MiB, empty/corrupt files, spoofed headers.
 */

import { createHash } from 'node:crypto';

// ---- constants ----

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MiB
const MAX_DIMENSION = 20_000;
const MAX_MEGAPIXELS = 100;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOI = 0xffd8;

// ---- types ----

export interface ImageInfo {
  detectedMimeType: string;
  fileSizeBytes: number;
  sha256: string;
  pixelWidth: number;
  pixelHeight: number;
  detectedDpi: number | null;
  warnings: string[];
}

export type ParseErrorCode =
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_FORMAT'
  | 'MIME_SPOOF'
  | 'CORRUPT_FILE'
  | 'OVERSIZE_FILE'
  | 'OVERSIZE_DIMENSION';

export class ImageParseError extends Error {
  constructor(
    public readonly code: ParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImageParseError';
  }
}

// ---- public API ----

export function parseImageBytes(
  buffer: Buffer,
  declaredMimeType?: string,
): ImageInfo {
  if (!buffer || buffer.length === 0) {
    throw new ImageParseError('EMPTY_FILE', 'File is empty');
  }

  if (buffer.length > MAX_FILE_BYTES) {
    throw new ImageParseError(
      'OVERSIZE_FILE',
      `File size ${buffer.length} exceeds maximum ${MAX_FILE_BYTES}`,
    );
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');

  // Detect by magic bytes
  let detectedMimeType: string;
  let pixelWidth: number;
  let pixelHeight: number;
  let detectedDpi: number | null;
  const warnings: string[] = [];

  if (buffer.length >= PNG_SIG.length && PNG_SIG.equals(buffer.subarray(0, PNG_SIG.length))) {
    detectedMimeType = 'image/png';
    const info = parsePng(buffer);
    pixelWidth = info.width;
    pixelHeight = info.height;
    detectedDpi = info.dpi;
    if (info.warnings) warnings.push(...info.warnings);
  } else if (buffer.length >= 2 && buffer.readUInt16BE(0) === JPEG_SOI) {
    detectedMimeType = 'image/jpeg';
    const info = parseJpeg(buffer);
    pixelWidth = info.width;
    pixelHeight = info.height;
    detectedDpi = info.dpi;
    if (info.warnings) warnings.push(...info.warnings);
  } else {
    throw new ImageParseError(
      'UNSUPPORTED_FORMAT',
      'File is not a supported PNG or JPEG image',
    );
  }

  // MIME spoof check
  if (declaredMimeType && declaredMimeType !== detectedMimeType) {
    throw new ImageParseError(
      'MIME_SPOOF',
      `Declared MIME type "${declaredMimeType}" does not match detected "${detectedMimeType}"`,
    );
  }

  // Dimension limits
  if (pixelWidth > MAX_DIMENSION || pixelHeight > MAX_DIMENSION) {
    throw new ImageParseError(
      'OVERSIZE_DIMENSION',
      `Image dimensions ${pixelWidth}x${pixelHeight} exceed maximum ${MAX_DIMENSION}`,
    );
  }

  const megapixels = (pixelWidth * pixelHeight) / 1_000_000;
  if (megapixels > MAX_MEGAPIXELS) {
    throw new ImageParseError(
      'OVERSIZE_DIMENSION',
      `Image ${megapixels.toFixed(1)} MP exceeds maximum ${MAX_MEGAPIXELS} MP`,
    );
  }

  // Validate dimensions are > 0
  if (pixelWidth <= 0 || pixelHeight <= 0) {
    throw new ImageParseError(
      'CORRUPT_FILE',
      'Image has invalid dimensions (zero or negative)',
    );
  }

  return {
    detectedMimeType,
    fileSizeBytes: buffer.length,
    sha256,
    pixelWidth,
    pixelHeight,
    detectedDpi,
    warnings,
  };
}

// ---- PNG parser ----

function parsePng(buffer: Buffer): {
  width: number;
  height: number;
  dpi: number | null;
  warnings: string[];
} {
  // IHDR is always the first chunk after the 8-byte signature
  if (buffer.length < 33) {
    throw new ImageParseError('CORRUPT_FILE', 'PNG too small to contain IHDR');
  }

  // Chunk layout: 4B length, 4B type, data, 4B CRC
  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new ImageParseError('CORRUPT_FILE', `Expected IHDR chunk, got "${chunkType}"`);
  }
  if (buffer.readUInt32BE(8) !== 13) {
    throw new ImageParseError('CORRUPT_FILE', 'PNG IHDR must contain 13 bytes');
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  // Scan for pHYs chunk
  let dpi: number | null = null;
  const warnings: string[] = [];
  let offset = 8; // after signature
  let sawIend = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4; // CRC after data

    if (nextOffset > buffer.length) {
      throw new ImageParseError('CORRUPT_FILE', `Truncated PNG ${type || 'chunk'}`);
    }

    if (type === 'pHYs' && length >= 9) {
      const pixelsPerUnitX = buffer.readUInt32BE(dataStart);
      const pixelsPerUnitY = buffer.readUInt32BE(dataStart + 4);
      const unit = buffer.readUInt8(dataStart + 8);
      if (unit === 1) {
        // Pixels per meter → DPI
        const dpiX = Math.round(pixelsPerUnitX / 39.3701);
        const dpiY = Math.round(pixelsPerUnitY / 39.3701);
        dpi = dpiX;
        if (Math.abs(dpiX - dpiY) > 1) {
          warnings.push(`Non-square pixels: X ${dpiX} dpi, Y ${dpiY} dpi`);
        }
      }
    }

    if (type === 'IEND') {
      if (length !== 0) throw new ImageParseError('CORRUPT_FILE', 'PNG IEND must be empty');
      sawIend = true;
      break;
    }
    offset = nextOffset;
  }

  if (!sawIend) {
    throw new ImageParseError('CORRUPT_FILE', 'PNG is missing a complete IEND chunk');
  }

  return { width, height, dpi, warnings };
}

// ---- JPEG parser ----

function parseJpeg(buffer: Buffer): {
  width: number;
  height: number;
  dpi: number | null;
  warnings: string[];
} {
  let width = 0;
  let height = 0;
  let dpi: number | null = null;
  const warnings: string[] = [];

  let offset = 2; // after SOI marker (0xFFD8)

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      throw new ImageParseError('CORRUPT_FILE', 'Invalid JPEG marker stream');
    }

    const marker = buffer[offset + 1];
    if (marker === undefined) break;
    if (marker === 0xd9) break; // EOI
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) {
      throw new ImageParseError('CORRUPT_FILE', 'Truncated JPEG segment header');
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      throw new ImageParseError('CORRUPT_FILE', 'Invalid JPEG segment length');
    }
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentEnd > buffer.length) {
      throw new ImageParseError('CORRUPT_FILE', 'Truncated JPEG segment');
    }

    const isSof = (marker >= 0xc0 && marker <= 0xc3);
    if (isSof) {
      if (segmentLength < 8 || offset + 9 > segmentEnd) {
        throw new ImageParseError('CORRUPT_FILE', 'Truncated JPEG SOF segment');
      }
      height = buffer.readUInt16BE(offset + 5);
      width = buffer.readUInt16BE(offset + 7);
    }

    if (marker === 0xe0 && segmentLength >= 16) {
      const payloadStart = offset + 4;
      const identifier = buffer.subarray(payloadStart, payloadStart + 5).toString('ascii');
      if (identifier === 'JFIF\0') {
        const units = buffer[payloadStart + 7];
        const xDensity = buffer.readUInt16BE(payloadStart + 8);
        const yDensity = buffer.readUInt16BE(payloadStart + 10);
        if (units === 1 || units === 2) {
          dpi = units === 1 ? xDensity : Math.round(xDensity * 2.54);
          if (Math.abs(xDensity - yDensity) > 1) {
            const unitLabel = units === 1 ? 'dpi' : 'dpcm';
            warnings.push(`Non-square pixels: X ${xDensity} ${unitLabel}, Y ${yDensity} ${unitLabel}`);
          }
        }
      }
    }

    if (marker === 0xda) break; // image data starts after SOS
    offset = segmentEnd;
  }

  if (width === 0 || height === 0) {
    throw new ImageParseError(
      'CORRUPT_FILE',
      'Could not find image dimensions in JPEG',
    );
  }

  return { width, height, dpi, warnings };
}
