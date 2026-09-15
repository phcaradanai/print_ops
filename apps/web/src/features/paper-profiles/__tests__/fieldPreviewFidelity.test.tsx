import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaperCanvas } from '../components/PaperCanvas.js';
import { LocaleProvider } from '../../../i18n/index.js';
import { CSS_PX_PER_MM, fontPointSizeToPreviewPixels, getVisualPaperGeometry, mapPrintablePointToVisual } from '../model/geometry.js';
import type { PaperForm, PaperProfileUx, DynamicField } from '../model/types.js';

/**
 * The paper-profile canvas is a print reference, not a mood board: an operator
 * positions a field here and expects the printer to put it in that exact spot.
 *
 * The server renders each field as
 *   position:absolute; left:<x>mm; top:<y>mm; font-size:<pt>
 * with no padding and no border (see buildFieldsTemplateHtml in
 * apps/api/src/routes/v1/template.routes.ts). Any padding or border the preview
 * adds for its own selection affordance displaces the text from the anchor the
 * printer will use — and because that chrome is in px/rem, the displacement
 * grows as the canvas scale shrinks. That is the defect these tests pin: the
 * paper scales, the interactive chrome does not, and the preview stops agreeing
 * with the print.
 */

const FIELD: DynamicField = {
  id: 'f1',
  key: 'hn',
  label: 'HN',
  type: 'text',
  xMm: 84.2,
  yMm: 35.8,
  fontSize: 12,
  bold: false,
  color: '#111827',
  align: 'left',
} as DynamicField;

/** The profile from the reported screenshots: 100x50mm media, portrait. */
const FORM: PaperForm = {
  code: 'LABEL_100X50',
  name: 'Label 100 x 50 mm',
  widthMm: 100,
  heightMm: 50,
  marginTopMm: 2,
  marginRightMm: 2,
  marginBottomMm: 2,
  marginLeftMm: 2,
  dpi: 203,
  orientation: 'portrait',
  unit: 'mm',
} as PaperForm;

const UX: PaperProfileUx = {
  dynamicFields: [FIELD],
  bgColor: '#ffffff',
  fontColor: '#111827',
  fontFamily: 'system-ui',
  watermarkText: '',
  watermarkOpacity: 0,
  displayUnit: 'mm',
} as PaperProfileUx;

/**
 * Renders the canvas the way the editor does — interactive. That distinction
 * matters: the padding this suite is about is applied only when the field is
 * draggable, so a read-only render would quietly pass and prove nothing.
 */
function renderCanvas(scale: number): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <PaperCanvas
        form={FORM}
        ux={UX}
        scale={scale}
        sheetRef={{ current: null }}
        selectedFieldId="f1"
        onFieldSelect={() => {}}
        onFieldNudge={() => {}}
      />
    </LocaleProvider>,
  );
}

/** Inline style of the field button, whatever scale it was rendered at. */
function fieldStyle(markup: string): string {
  const match = markup.match(/<button[^>]*aria-label="[^"]*at 84\.2[^"]*"[^>]*style="([^"]*)"/);
  return match?.[1] ?? '';
}

describe('field preview fidelity against the printed output', () => {
  it('anchors the field at exactly the coordinate the printer will use', () => {
    const geometry = getVisualPaperGeometry(FORM);
    const point = mapPrintablePointToVisual(FIELD.xMm, FIELD.yMm, geometry);
    const style = fieldStyle(renderCanvas(CSS_PX_PER_MM));

    // The rotation itself is shared with the server, so the expected anchor is
    // the mapped point — no fudge factor.
    expect(style).toContain(`left:${point.xMm * CSS_PX_PER_MM}px`);
    expect(style).toContain(`top:${point.yMm * CSS_PX_PER_MM}px`);
  });

  it('adds no padding, because the printed field has none', () => {
    const style = fieldStyle(renderCanvas(CSS_PX_PER_MM));
    // Padding on an absolutely-positioned field pushes its text away from the
    // anchor: the operator aims at one place and the printer uses another.
    const padding = style.match(/(?:^|;)\s*padding:\s*([^;]+)/)?.[1]?.trim();
    const isZero = padding == null || /^0(px|rem|em|%)?( 0(px|rem|em|%)?)*$/.test(padding);
    expect(isZero, `field carries padding "${padding}", which displaces it from its print anchor`).toBe(true);
  });

  it('draws the selection affordance without displacing the field', () => {
    const style = fieldStyle(renderCanvas(CSS_PX_PER_MM));
    // A 1px border is layout-affecting; an outline is not. The affordance has
    // to be free.
    expect(style).not.toMatch(/(^|;)\s*border:\s*1px/);
  });

  it('keeps every part of the field proportional to the paper', () => {
    // Same field, half the scale. Everything that describes the field's
    // physical footprint must halve with it; anything that stays constant is
    // chrome leaking into the measurement.
    const full = fieldStyle(renderCanvas(CSS_PX_PER_MM));
    const half = fieldStyle(renderCanvas(CSS_PX_PER_MM / 2));

    const px = (style: string, prop: string) =>
      Number(style.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([0-9.]+)px`))?.[1] ?? NaN);

    expect(px(half, 'left')).toBeCloseTo(px(full, 'left') / 2, 3);
    expect(px(half, 'top')).toBeCloseTo(px(full, 'top') / 2, 3);
    expect(px(half, 'font-size')).toBeCloseTo(px(full, 'font-size') / 2, 3);
    // Sanity: the font size is the pt->px conversion, not an arbitrary value.
    expect(px(full, 'font-size')).toBeCloseTo(
      fontPointSizeToPreviewPixels(FIELD.fontSize, CSS_PX_PER_MM),
      3,
    );
  });
});
