import { describe, it, expect } from 'vitest';
import { parseImageBytes, ImageParseError } from '../services/image-parser.js';

// ---- helpers ----

/**
 * Build a minimal valid PNG with given width/height and optional pHYs DPI.
 * Does NOT compress pixel data — just a syntactically valid PNG structure.
 */
function makePng(
  width: number,
  height: number,
  dpi?: number,
): Buffer {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type (RGB)
  // compression=0, filter=0, interlace=0 (bytes 10-12 already zero)
  const ihdrChunk = makePngChunk('IHDR', ihdrData);

  let pHYsChunk: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  if (dpi !== undefined) {
    const ppm = Math.round(dpi * 39.3701); // DPI → pixels per meter
    const physData = Buffer.alloc(9);
    physData.writeUInt32BE(ppm, 0); // X
    physData.writeUInt32BE(ppm, 4); // Y
    physData[8] = 1;                // unit = meter
    pHYsChunk = makePngChunk('pHYs', physData);
  }

  const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIG, ihdrChunk, pHYsChunk, iendChunk]);
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  // Minimal CRC (not cryptographically correct but structurally valid for our parser)
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(0, 0);
  return Buffer.concat([length, typeB, data, crc]);
}

/**
 * Build a minimal valid JPEG with JFIF APP0 marker.
 */
function makeJpeg(
  width: number,
  height: number,
  dpi?: number,
): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);

  // JFIF APP0 segment
  let jfifSegment: Buffer;
  if (dpi !== undefined) {
    const payload = Buffer.alloc(14);
    payload.write('JFIF\0', 0, 'ascii');  // identifier (5 bytes)
    payload[5] = 1;  // version major
    payload[6] = 1;  // version minor
    payload[7] = 1;  // units = dpi
    payload.writeUInt16BE(dpi, 8);   // Xdensity
    payload.writeUInt16BE(dpi, 10);  // Ydensity
    payload[12] = 0;                 // Xthumbnail
    payload[13] = 0;                 // Ythumbnail
    jfifSegment = makeJpegSegment(0xe0, payload);
  } else {
    const payload = Buffer.alloc(14);
    payload.write('JFIF\0', 0, 'ascii');
    payload[5] = 1;
    payload[6] = 1;
    payload[7] = 0;  // units = none
    payload.writeUInt16BE(1, 8);   // Xdensity
    payload.writeUInt16BE(1, 10);  // Ydensity
    payload[12] = 0;
    payload[13] = 0;
    jfifSegment = makeJpegSegment(0xe0, payload);
  }

  // SOF0 segment (baseline DCT) — contains dimensions
  const sofPayload = Buffer.alloc(8);
  sofPayload[0] = 8;  // precision
  sofPayload.writeUInt16BE(height, 1);
  sofPayload.writeUInt16BE(width, 3);
  sofPayload[5] = 3;  // number of components
  // component 1: Y
  sofPayload[6] = 1;   // id
  sofPayload[7] = 0x11; // sampling
  // We need 2 more components (3 total × 3 bytes each)
  const compData = Buffer.from([2, 0x11, 0, 3, 0x11, 0]);
  const sofFull = Buffer.concat([sofPayload, compData]);
  const sofSegment = makeJpegSegment(0xc0, sofFull);

  // SOS + minimal image data placeholder (just enough to be structurally valid)
  const sosPayload = Buffer.alloc(4);
  sosPayload[0] = 3;  // number of components in scan
  sosPayload[1] = 1;  // component 1
  sosPayload[2] = 0;  // huffman table
  sosPayload[3] = 2;  // component 2
  // ... more components ...
  const sosFull = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
  const sosSegment = makeJpegSegment(0xda, sosFull);

  const eoi = Buffer.from([0xff, 0xd9]);

  return Buffer.concat([soi, jfifSegment, sofSegment, sosSegment, eoi]);
}

function makeJpegSegment(marker: number, data: Buffer): Buffer {
  // marker FF + marker type, length (2 bytes, big-endian, includes length field), data
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  const totalLength = data.length + 2; // length includes the 2 length bytes
  header.writeUInt16BE(totalLength, 2);
  return Buffer.concat([header, data]);
}

// ---- PNG tests ----

describe('parseImageBytes — PNG', () => {
  it('parses a minimal valid PNG', () => {
    const buf = makePng(100, 200);
    const info = parseImageBytes(buf);
    expect(info.detectedMimeType).toBe('image/png');
    expect(info.pixelWidth).toBe(100);
    expect(info.pixelHeight).toBe(200);
    expect(info.detectedDpi).toBeNull();
  });

  it('extracts DPI from pHYs chunk', () => {
    const buf = makePng(100, 200, 300);
    const info = parseImageBytes(buf);
    expect(info.detectedMimeType).toBe('image/png');
    expect(info.detectedDpi).toBe(300);
  });

  it('computes sha256', () => {
    const buf = makePng(100, 200);
    const info = parseImageBytes(buf);
    expect(info.sha256).toHaveLength(64);
    expect(info.fileSizeBytes).toBe(buf.length);
  });

  it('returns file size', () => {
    const buf = makePng(100, 200);
    const info = parseImageBytes(buf);
    expect(info.fileSizeBytes).toBe(buf.length);
  });
});

// ---- JPEG tests ----

describe('parseImageBytes — JPEG', () => {
  it('parses a minimal valid JPEG with dimensions', () => {
    const buf = makeJpeg(150, 100);
    const info = parseImageBytes(buf);
    expect(info.detectedMimeType).toBe('image/jpeg');
    expect(info.pixelWidth).toBe(150);
    expect(info.pixelHeight).toBe(100);
  });

  it('extracts DPI from JFIF APP0 when units=1', () => {
    const buf = makeJpeg(150, 100, 300);
    const info = parseImageBytes(buf);
    expect(info.detectedMimeType).toBe('image/jpeg');
    expect(info.detectedDpi).toBe(300);
  });

  it('returns null DPI when JFIF units=0', () => {
    const buf = makeJpeg(150, 100); // no DPI
    const info = parseImageBytes(buf);
    expect(info.detectedDpi).toBeNull();
  });

  it('computes sha256 for JPEG', () => {
    const buf = makeJpeg(150, 100, 300);
    const info = parseImageBytes(buf);
    expect(info.sha256).toHaveLength(64);
  });
});

// ---- error cases ----

describe('parseImageBytes — errors', () => {
  it('throws EMPTY_FILE for empty buffer', () => {
    expect(() => parseImageBytes(Buffer.alloc(0))).toThrow(ImageParseError);
    try { parseImageBytes(Buffer.alloc(0)); } catch (e) {
      expect((e as ImageParseError).code).toBe('EMPTY_FILE');
    }
  });

  it('throws UNSUPPORTED_FORMAT for non-image data', () => {
    const buf = Buffer.from('Hello, world!');
    expect(() => parseImageBytes(buf)).toThrow(ImageParseError);
    try { parseImageBytes(buf); } catch (e) {
      expect((e as ImageParseError).code).toBe('UNSUPPORTED_FORMAT');
    }
  });

  it('throws MIME_SPOOF when declared MIME does not match', () => {
    const buf = makePng(100, 200);
    expect(() => parseImageBytes(buf, 'image/jpeg')).toThrow(ImageParseError);
    try { parseImageBytes(buf, 'image/jpeg'); } catch (e) {
      expect((e as ImageParseError).code).toBe('MIME_SPOOF');
    }
  });

  it('throws OVERSIZE_FILE for > 8 MiB', () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 0x00);
    big[0] = 0x89; big[1] = 0x50; big[2] = 0x4e; big[3] = 0x47;
    big[4] = 0x0d; big[5] = 0x0a; big[6] = 0x1a; big[7] = 0x0a;
    expect(() => parseImageBytes(big)).toThrow(ImageParseError);
    try { parseImageBytes(big); } catch (e) {
      expect((e as ImageParseError).code).toBe('OVERSIZE_FILE');
    }
  });

  it('throws OVERSIZE_DIMENSION for > 20000 px', () => {
    const buf = makePng(20001, 100);
    expect(() => parseImageBytes(buf)).toThrow(ImageParseError);
    try { parseImageBytes(buf); } catch (e) {
      expect((e as ImageParseError).code).toBe('OVERSIZE_DIMENSION');
    }
  });

  it('throws OVERSIZE_DIMENSION for > 100 MP', () => {
    const buf = makePng(12000, 12000); // 144 MP
    expect(() => parseImageBytes(buf)).toThrow(ImageParseError);
    try { parseImageBytes(buf); } catch (e) {
      expect((e as ImageParseError).code).toBe('OVERSIZE_DIMENSION');
    }
  });

  it('throws CORRUPT_FILE for zero dimensions', () => {
    const buf = makePng(0, 100);
    expect(() => parseImageBytes(buf)).toThrow(ImageParseError);
    try { parseImageBytes(buf); } catch (e) {
      expect((e as ImageParseError).code).toBe('CORRUPT_FILE');
    }
  });

  it('allows 20_000 px dimension', () => {
    const buf = makePng(20000, 100);
    const info = parseImageBytes(buf);
    expect(info.pixelWidth).toBe(20000);
  });

  it('rejects a truncated JPEG segment', () => {
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);
    expect(() => parseImageBytes(truncated)).toThrowError(/Truncated JPEG segment/);
  });

  it('rejects a PNG with a truncated chunk CRC', () => {
    const valid = makePng(20, 10);
    expect(() => parseImageBytes(valid.subarray(0, valid.length - 2))).toThrowError(/IEND|Truncated PNG/);
  });
});

// ---- real PNG magic bytes ----

describe('parseImageBytes — magic byte detection', () => {
  it('detects a known PNG magic-bytes fragment as PNG', () => {
    const buf = makePng(64, 64);
    const info = parseImageBytes(buf);
    expect(info.detectedMimeType).toBe('image/png');
  });

  it('detects SOI marker as JPEG', () => {
    const buf = makeJpeg(64, 64);
    const info = parseImageBytes(buf);
    expect(info.detectedMimeType).toBe('image/jpeg');
  });
});
