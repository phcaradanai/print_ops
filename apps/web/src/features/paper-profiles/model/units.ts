import type { DisplayUnit } from './types.js';

export function toPixels(mm: number, dpi: number): number {
  return (mm * dpi) / 25.4;
}

export function displayValue(mm: number, unit: DisplayUnit, dpi: number): string | number {
  if (unit === 'cm') return (mm / 10).toFixed(1);
  if (unit === 'px') return Math.round(toPixels(mm, dpi));
  return mm.toFixed(1);
}

export function toMillimeters(value: number, fromUnit: DisplayUnit, dpi: number): number {
  if (fromUnit === 'cm') return value * 10;
  if (fromUnit === 'px') return (value * 25.4) / dpi;
  return value;
}
