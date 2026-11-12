import { describe, expect, it } from 'vitest';
import { applyShrinkToFit, fitFontSizePt, MIN_FIT_FONT_SIZE_PT, printTextWidthMm } from './text-fit.js';
import { hoistPrintFontFace, PRINT_FONT_FAMILY, withPrintFontFace } from './rendering.js';

describe('print text fitting', () => {
  it('measures Thai marks as zero width and bold wider than regular', () => {
    expect(printTextWidthMm('ก่', 10, false)).toBeCloseTo(printTextWidthMm('ก', 10, false), 6);
    expect(printTextWidthMm('Hello', 10, true)).toBeGreaterThan(printTextWidthMm('Hello', 10, false));
    expect(printTextWidthMm('AB', 20, false)).toBeCloseTo(printTextWidthMm('AB', 10, false) * 2, 6);
  });

  it('keeps the size when the text fits and shrinks it when it does not', () => {
    expect(fitFontSizePt('HN', 12, false, 40)).toBe(12);
    const long = 'นายทดสอบ ระบบพิมพ์ ยาวมากกว่ากล่อง';
    const size = fitFontSizePt(long, 12, false, 30);
    expect(size).toBeLessThan(12);
    expect(printTextWidthMm(long, size, false)).toBeLessThanOrEqual(30);
    expect(fitFontSizePt('x'.repeat(500), 12, false, 10)).toBe(MIN_FIT_FONT_SIZE_PT);
  });

  it('rewrites only the font size of shrink-to-fit spans', () => {
    const span = (text: string) => `<span data-printops-fit="20" data-printops-pt="10" data-printops-bold="0" style="left:1mm;font-size:10pt;color:#000;">${text}</span>`;
    expect(applyShrinkToFit(span('OK'))).toBe(span('OK'));
    const shrunk = applyShrinkToFit(span('A much longer value than twenty mm'));
    expect(shrunk).toMatch(/font-size:[0-9.]+pt/);
    expect(shrunk).not.toContain('font-size:10pt');
    expect(shrunk).toContain('left:1mm;');
  });

  it('embeds the print font once, only where it is used', () => {
    const page = `<div style="font-family:${PRINT_FONT_FAMILY}">x</div>`;
    expect(withPrintFontFace('<p>no font</p>')).toBe('<p>no font</p>');
    const once = withPrintFontFace(page);
    expect(once.match(/data-printops-font/g)).toHaveLength(1);
    expect(withPrintFontFace(once)).toBe(once);
    const stitched = hoistPrintFontFace(`<section>${once}</section><section>${once}</section>`);
    expect(stitched.match(/@font-face/g)?.length).toBe(once.match(/@font-face/g)?.length);
    expect(stitched.startsWith('<style data-printops-font>')).toBe(true);
  });
});
