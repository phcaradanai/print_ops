import { PRINT_FONT_ADVANCES_EM } from './print-font.generated.js';

const PT_TO_MM = 25.4 / 72;
/** Characters outside the embedded subsets fall back to another font; assume a wide glyph. */
const FALLBACK_ADVANCE_EM = 0.65;
/** Smallest size shrink-to-fit goes to; below this the text is clipped instead. */
export const MIN_FIT_FONT_SIZE_PT = 4;
/** Headroom for shaping/kerning the advance table does not model. */
const FIT_SAFETY = 0.97;

/** Width of one line of `text` in the embedded print font, in mm. */
export function printTextWidthMm(text: string, fontSizePt: number, bold: boolean): number {
  const advances = PRINT_FONT_ADVANCES_EM[bold ? 700 : 400];
  let em = 0;
  for (const char of text) em += advances[char.codePointAt(0)!] ?? FALLBACK_ADVANCE_EM;
  return em * fontSizePt * PT_TO_MM;
}

/**
 * Font size that makes `text` fit `widthMm`: the configured size when it
 * already fits, otherwise scaled down (0.1 pt steps), never below
 * MIN_FIT_FONT_SIZE_PT. Server and canvas both call this, so the label
 * shrinks identically on screen and on paper.
 */
export function fitFontSizePt(text: string, fontSizePt: number, bold: boolean, widthMm: number): number {
  const width = printTextWidthMm(text, fontSizePt, bold);
  if (width <= widthMm * FIT_SAFETY || width === 0) return fontSizePt;
  const fitted = Math.floor(((fontSizePt * widthMm * FIT_SAFETY) / width) * 10) / 10;
  return Math.max(MIN_FIT_FONT_SIZE_PT, Math.min(fontSizePt, fitted));
}

const FIT_SPAN_PATTERN = /<span data-printops-fit="([0-9.]+)" data-printops-pt="([0-9.]+)" data-printops-bold="([01])" style="([^"]*)">([^<]*)<\/span>/g;

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#0?39);/g, (_m, name: string) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', '#039': "'", '#39': "'" } as Record<string, string>
  )[name]!);
}

/**
 * Resizes every shrink-to-fit span (emitted by the paper-profile companion
 * template) for the value it now holds. Run after placeholder substitution.
 * shortcut: a value containing markup is left at its configured size (clipped); upgrade if templates start nesting tags in fit fields.
 */
export function applyShrinkToFit(html: string): string {
  return html.replace(FIT_SPAN_PATTERN, (whole, widthMm: string, pt: string, bold: string, style: string, text: string) => {
    const size = fitFontSizePt(decodeEntities(text), Number(pt), bold === '1', Number(widthMm));
    if (size === Number(pt)) return whole;
    return whole.replace(style, style.replace(`font-size:${pt}pt`, `font-size:${size}pt`));
  });
}
