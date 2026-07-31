import bwipjs from 'bwip-js';
import type { BarcodeSymbology } from '@printerops/domain';
import {
  dotsToMillimeters,
  millimetersToRoundedDots,
} from '@printerops/shared';

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
  /** Side length in mm for QR codes. HTML uses a vector image in an exact CSS
   *  mm box; native printer languages round this once to the nearest dot. */
  qrSizeMm?: number;
}

export interface ZplQrGraphic {
  command: string;
  requestedSizeMm: number;
  dpi: number;
  symbolDots: number;
  physicalSizeMm: number;
  quietZoneDots: number;
  totalDots: number;
  modules: number;
}

export interface QrGeometry {
  modules: number;
  quietZoneMm: number;
}

function qrModuleMatrix(data: string) {
  const raw = bwipjs.raw({ bcid: 'qrcode', text: data });
  const symbol = raw[0];
  if (!symbol || !('pixs' in symbol) || symbol.pixx !== symbol.pixy || symbol.pixx <= 0) {
    throw new Error('bwip-js did not return a square QR module matrix');
  }
  return symbol;
}

/** A QR quiet zone is four modules and is not part of the configured symbol
 * side length. Callers render this space outside the exact-size dark matrix. */
export function qrGeometry(data: string, symbolSizeMm: number): QrGeometry {
  const symbol = qrModuleMatrix(data);
  return {
    modules: symbol.pixx,
    quietZoneMm: (symbolSizeMm * 4) / symbol.pixx,
  };
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
  if (kind === 'qrcode') {
    // A fixed 168px QR was previously resized by the browser to (for example)
    // 160 printer dots at 203 DPI. Interpolation softened the outer modules and
    // made the measured dark symbol about 0.5mm smaller. SVG keeps module edges
    // vector-sharp until the one final device-DPI rasterization.
    const svg = bwipjs.toSVG({ bcid, text: data, scale: 1 });
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }
  // bwip-js rejects an explicit `undefined` for any option key (it checks the
  // key's presence, not just its value) — so QR options must omit `height`/
  // `includetext` entirely rather than setting them to undefined.
  const buffer = await bwipjs.toBuffer(
    {
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

/**
 * Render a QR as an exact-size 1-bit ZPL graphic.
 *
 * ZPL's native `^BQ` only accepts an integer module magnification. At 203 DPI,
 * a 21-module QR can therefore jump by 2.63mm per magnification step — nowhere
 * near the ±0.1mm acceptance tolerance. `^GF` lets us round the requested side
 * once to the nearest device dot. A four-module quiet zone is generated around
 * (not inside) that configured symbol size, so a requested 20mm QR remains a
 * 20mm symbol rather than a 19.5mm symbol inside a 20mm bounding box.
 */
export function renderZplQrGraphic(
  data: string,
  requestedSizeMm: number,
  dpi: number,
): ZplQrGraphic {
  const symbol = qrModuleMatrix(data);

  const modules = symbol.pixx;
  const symbolDots = millimetersToRoundedDots(requestedSizeMm, dpi);
  if (symbolDots < modules) {
    throw new RangeError(
      `QR size ${requestedSizeMm}mm at ${dpi} DPI provides ${symbolDots} dots for ${modules} modules`,
    );
  }

  const quietZoneDots = Math.max(4, Math.round((symbolDots * 4) / modules));
  const totalDots = symbolDots + quietZoneDots * 2;
  const bytesPerRow = Math.ceil(totalDots / 8);
  const bitmap = Buffer.alloc(bytesPerRow * totalDots, 0);

  for (let y = 0; y < symbolDots; y += 1) {
    const moduleY = Math.min(modules - 1, Math.floor((y * modules) / symbolDots));
    for (let x = 0; x < symbolDots; x += 1) {
      const moduleX = Math.min(modules - 1, Math.floor((x * modules) / symbolDots));
      if (symbol.pixs[moduleY * modules + moduleX] !== 1) continue;
      const outputX = quietZoneDots + x;
      const outputY = quietZoneDots + y;
      const byteIndex = outputY * bytesPerRow + Math.floor(outputX / 8);
      bitmap[byteIndex] = (bitmap[byteIndex] ?? 0) | (0x80 >> (outputX % 8));
    }
  }

  const bytes = bitmap.length;
  return {
    command: `^GFA,${bytes},${bytes},${bytesPerRow},${bitmap.toString('hex').toUpperCase()}^FS`,
    requestedSizeMm,
    dpi,
    symbolDots,
    physicalSizeMm: dotsToMillimeters(symbolDots, dpi),
    quietZoneDots,
    totalDots,
    modules,
  };
}
