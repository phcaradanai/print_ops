import type { DisplayUnit } from './types.js';
import { dotsToMillimeters, millimetersToDots } from '@printerops/shared';

export function toPixels(mm: number, dpi: number): number {
  return millimetersToDots(mm, dpi);
}

export function displayValue(mm: number, unit: DisplayUnit, dpi: number): string | number {
  if (unit === 'cm') return (mm / 10).toFixed(1);
  if (unit === 'px') return Math.round(toPixels(mm, dpi));
  return mm.toFixed(1);
}

export function toMillimeters(value: number, fromUnit: DisplayUnit, dpi: number): number {
  if (fromUnit === 'cm') return value * 10;
  if (fromUnit === 'px') return dotsToMillimeters(value, dpi);
  return value;
}
