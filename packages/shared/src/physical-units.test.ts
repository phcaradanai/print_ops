import { describe, expect, it } from 'vitest';
import {
  dotsToMillimeters,
  millimetersToDots,
  millimetersToRoundedDots,
} from './physical-units.js';

const CASES = [
  { mm: 10, dpi: 203, dots: 80 },
  { mm: 15, dpi: 203, dots: 120 },
  { mm: 20, dpi: 203, dots: 160 },
  { mm: 25, dpi: 203, dots: 200 },
  { mm: 30, dpi: 203, dots: 240 },
  { mm: 10, dpi: 300, dots: 118 },
  { mm: 15, dpi: 300, dots: 177 },
  { mm: 20, dpi: 300, dots: 236 },
  { mm: 25, dpi: 300, dots: 295 },
  { mm: 30, dpi: 300, dots: 354 },
  { mm: 10, dpi: 600, dots: 236 },
  { mm: 15, dpi: 600, dots: 354 },
  { mm: 20, dpi: 600, dots: 472 },
  { mm: 25, dpi: 600, dots: 591 },
  { mm: 30, dpi: 600, dots: 709 },
] as const;

describe('physical unit conversion', () => {
  it.each(CASES)('renders $mm mm at $dpi DPI as $dots whole dots', ({ mm, dpi, dots }) => {
    const continuousDots = millimetersToDots(mm, dpi);
    const renderedDots = millimetersToRoundedDots(mm, dpi);
    const physicalMm = dotsToMillimeters(renderedDots, dpi);

    expect(renderedDots).toBe(dots);
    expect(continuousDots).toBeCloseTo((mm * dpi) / 25.4, 10);
    expect(Math.abs(physicalMm - mm)).toBeLessThanOrEqual(0.1);
  });

  it('rejects non-physical inputs instead of producing NaN or Infinity', () => {
    expect(() => millimetersToDots(20, 0)).toThrow(RangeError);
    expect(() => millimetersToRoundedDots(-1, 203)).toThrow(RangeError);
    expect(() => dotsToMillimeters(-1, 203)).toThrow(RangeError);
  });
});
