import bwipjs from 'bwip-js';
import type { BarcodeSymbology } from '@printerops/domain';

/**
 * Renders a barcode or QR code to a PNG data URI, for embedding directly in
 * HTML print payloads and in the dashboard's template/paper-profile preview
 * (regardless of the template's engine — the preview always shows a real,
 * scannable graphic so an operator can verify it before publishing).
 *
 * bwip-js is pure JavaScript (no native/canvas dependency), so this works
 * unmodified inside the pkg-bundled Windows executable.
 */

const SYMBOLOGY_TO_BCID: Record<BarcodeSymbology, string> = {
  code128: 'code128',
  code39: 'code39',
  ean13: 'ean13',
  datamatrix: 'datamatrix',
};

export interface BarcodeRenderOptions {
  /** Bar height in mm for 1D symbologies. Ignored for QR. Default 12mm. */
  heightMm?: number;
  /** Print human-readable text beneath a 1D barcode. Default true. */
  includeText?: boolean;
  /** Side length in mm for QR codes. The rasterizer deliberately ignores this:
   *  physical size has one source of truth, the CSS mm box emitted by imgTag.
   *  Keeping raster generation size-independent prevents bwip-js rounding and
   *  quiet-zone choices from competing with the configured print dimension. */
  qrSizeMm?: number;
}

/**
 * Renders `data` as the requested kind and returns a `data:image/png;base64,...`
 * URI. Throws if the data cannot be encoded in the requested symbology (e.g.
 * non-numeric data for EAN-13) — callers should catch and fall back to
 * showing the raw text plus a warning, the same way template rendering
 * already surfaces other warnings.
 */
export async function renderBarcodeDataUri(
  data: string,
  kind: 'barcode' | 'qrcode',
  symbology?: BarcodeSymbology,
  opts?: BarcodeRenderOptions,
): Promise<string> {
  const bcid = kind === 'qrcode' ? 'qrcode' : SYMBOLOGY_TO_BCID[symbology ?? 'code128'];
  // bwip-js rejects an explicit `undefined` for any option key (it checks the
  // key's presence, not just its value) — so QR options must omit `height`/
  // `includetext` entirely rather than setting them to undefined.
  const buffer = await bwipjs.toBuffer(
    kind === 'qrcode'
      ? { bcid, text: data, scale: 4 }
      : {
          bcid,
          text: data,
          scale: 3,
          height: opts?.heightMm ?? 12,
          includetext: opts?.includeText ?? true,
          textxalign: 'center',
        },
  );
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
