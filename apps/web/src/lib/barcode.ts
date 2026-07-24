// Explicit browser subpath: bwip-js's default "." export only exposes
// conditional branches (browser/node/electron/react-native) with no
// unconditional fallback, and tsc's bundler resolution doesn't enable the
// "browser" condition by default — importing the subpath sidesteps that.
// @ts-expect-error No types for bwip-js/browser
import bwipjs from 'bwip-js/browser';

/**
 * Client-side barcode/QR rendering, shared by the Paper Profile field canvas
 * and the Template editor's local preview. Uses the SAME bwip-js library the
 * server uses (apps/api/src/infra/template/barcode-renderer.ts), so what an
 * operator sees while designing matches what actually prints.
 */

export type BarcodeKind = 'barcode' | 'qrcode';
export type BarcodeSymbology = 'code128' | 'code39' | 'ean13' | 'datamatrix';

const SYMBOLOGY_TO_BCID: Record<BarcodeSymbology, string> = {
  code128: 'code128',
  code39: 'code39',
  ean13: 'ean13',
  datamatrix: 'datamatrix',
};

/**
 * Renders `data` as an inline SVG string. Returns `undefined` (instead of
 * throwing) when the data can't be encoded in the requested symbology, so
 * callers can fall back to a plain text placeholder without a try/catch at
 * every call site.
 */
export function renderBarcodeSvg(data: string, kind: BarcodeKind, symbology?: BarcodeSymbology): string | undefined {
  if (!data) return undefined;
  try {
    const bcid = kind === 'qrcode' ? 'qrcode' : SYMBOLOGY_TO_BCID[symbology ?? 'code128'];
    return bwipjs.toSVG(
      kind === 'qrcode'
        ? { bcid, text: data, scale: 2 }
        : { bcid, text: data, scale: 2, height: 10, includetext: true, textxalign: 'center' },
    );
  } catch {
    return undefined;
  }
}
