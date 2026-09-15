/** Millimetres per inch, shared by preview, renderers and printer adapters. */
export const MILLIMETERS_PER_INCH = 25.4;

/** Convert a physical length to the printer's continuous dot coordinate. */
export function millimetersToDots(millimeters: number, dpi: number): number {
  assertPositiveFinite(millimeters, 'millimeters');
  assertPositiveFinite(dpi, 'dpi');
  return (millimeters * dpi) / MILLIMETERS_PER_INCH;
}

/** Convert printer dots back to a physical length. */
export function dotsToMillimeters(dots: number, dpi: number): number {
  if (!Number.isFinite(dots) || dots < 0) {
    throw new RangeError('dots must be a finite number greater than or equal to zero');
  }
  assertPositiveFinite(dpi, 'dpi');
  return (dots * MILLIMETERS_PER_INCH) / dpi;
}

/**
 * Choose the nearest whole printer dot for a requested physical length.
 *
 * A printer cannot address a fraction of a dot. Rounding once, at the final
 * raster/native-printer boundary, keeps the error bounded to half a dot and
 * prevents the repeated floor/ceil operations that previously accumulated
 * through preview, render and driver layers.
 */
export function millimetersToRoundedDots(millimeters: number, dpi: number): number {
  return Math.round(millimetersToDots(millimeters, dpi));
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero`);
  }
}
