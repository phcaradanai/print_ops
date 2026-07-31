import { describe, it, expect } from 'vitest';
import type { PrintTemplate, PaperProfile } from '@printerops/domain';
import { SimpleTemplateRenderer } from '../infra/template/simple-template-renderer.js';

function makeTemplate(overrides: Partial<PrintTemplate> = {}): PrintTemplate {
  const now = new Date();
  return {
    id: 'tpl-1',
    templateCode: 'TEST_TPL',
    name: 'Test Template',
    engine: 'RAW_TEXT',
    content: 'TEST {{label}}',
    version: 1,
    status: 'PUBLISHED',
    createdBy: 'tester',
    updatedBy: 'tester',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePaper(overrides: Partial<PaperProfile> = {}): PaperProfile {
  const now = new Date();
  return {
    id: 'paper-1',
    code: 'LABEL_100X50',
    name: 'Label 100x50',
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 2,
    marginBottomMm: 2,
    marginLeftMm: 2,
    dpi: 203,
    orientation: 'portrait',
    unit: 'mm',
    fields: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SimpleTemplateRenderer — barcode/QR support', () => {
  it('HTML engine embeds a real <img> barcode in BOTH the print payload and the preview', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'HTML', content: '<div>{{label}}</div><div>{{barcode:code}}</div>' });
    const paper = makePaper();
    const payload = { label: 'Tube A', code: 'ABC123' };

    const print = await renderer.renderPrintPayload(template, payload, paper);
    expect(print.renderedPrintPayload).toContain('<img src="data:image/png;base64,');
    expect(print.warnings).toHaveLength(0);

    const preview = await renderer.renderPreview(template, payload, paper);
    expect(preview.renderedPreview).toContain('<img src="data:image/png;base64,');
  });

  it('HTML engine embeds a real <img> QR code via {{qrcode:key}}', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'HTML', content: '<div>{{qrcode:hn}}</div>' });
    const print = await renderer.renderPrintPayload(template, { hn: 'HN-0001' }, makePaper());
    expect(print.renderedPrintPayload).toContain('<img src="data:image/svg+xml;base64,');
    expect(print.renderedPrintPayload).toContain('padding:3.8095');
    expect(print.renderedPrintPayload).toContain('height:20mm;width:20mm');
  });

  it('ZPL engine emits a native ^BC barcode command in the print payload, positioned by the author\'s own ^FO', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'ZPL', content: '^XA\n^FO50,50{{barcode:code}}\n^XZ' });
    const print = await renderer.renderPrintPayload(template, { code: 'ABC123' }, makePaper());
    expect(print.renderedPrintPayload).toContain('^FO50,50^BCN,60,Y,N,N^FDABC123^FS');
    expect(print.renderedPrintPayload).not.toContain('<img');
  });

  it('ZPL engine emits an exact-size device-DPI ^GF QR graphic for {{qrcode:key}}', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'ZPL', content: '^XA\n^FO50,50{{qrcode:hn}}\n^XZ' });
    const print = await renderer.renderPrintPayload(template, { hn: 'HN-0001' }, makePaper());
    expect(print.renderedPrintPayload).toContain('^GFA,');
    expect(print.renderedPrintPayload).not.toContain('^BQN');
  });

  it('RAW_TEXT engine keeps the plain value in the print payload (unchanged behaviour) but shows a real image in the preview', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'RAW_TEXT', content: 'LABEL {{label}}\n{{barcode:code}}' });
    const payload = { label: 'Tube A', code: 'ABC123' };
    const paper = makePaper();

    const print = await renderer.renderPrintPayload(template, payload, paper);
    expect(print.renderedPrintPayload).toContain('LABEL Tube A');
    expect(print.renderedPrintPayload).toContain('ABC123');
    expect(print.renderedPrintPayload).not.toContain('<img');
    expect(print.renderedPrintPayload).not.toContain('^BC');

    const preview = await renderer.renderPreview(template, payload, paper);
    expect(preview.renderedPreview).toContain('<img src="data:image/png;base64,');
    // Literal text around the token is still escaped/wrapped as before.
    expect(preview.renderedPreview).toContain('LABEL Tube A');
  });

  it('infers barcode rendering from a bound paper-profile field typed "barcode", with no special template syntax', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'RAW_TEXT', content: 'LABEL {{code}}' });
    const paper = makePaper({
      fields: [
        {
          id: 'f1', key: 'code', label: 'Code', defaultValue: '', type: 'barcode',
          barcodeSymbology: 'code128', xMm: 5, yMm: 5, fontSize: 10, bold: false, color: '#000', align: 'left',
        },
      ],
    });
    const preview = await renderer.renderPreview(template, { code: 'ABC123' }, paper);
    expect(preview.renderedPreview).toContain('<img src="data:image/png;base64,');
    // The print payload for a non-HTML/ZPL engine is still the plain value —
    // profile-field inference only changes what the OPERATOR sees, not the
    // native output for engines with no barcode command of their own.
    const print = await renderer.renderPrintPayload(template, { code: 'ABC123' }, paper);
    expect(print.renderedPrintPayload).toBe('LABEL ABC123');
  });

  it('infers QR rendering from a bound paper-profile field typed "qrcode"', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'HTML', content: '<div>{{hn}}</div>' });
    const paper = makePaper({
      fields: [
        { id: 'f1', key: 'hn', label: 'HN', defaultValue: '', type: 'qrcode', xMm: 5, yMm: 5, fontSize: 10, bold: false, color: '#000', align: 'left' },
      ],
    });
    const print = await renderer.renderPrintPayload(template, { hn: 'HN-0001' }, paper);
    expect(print.renderedPrintPayload).toContain('<img src="data:image/svg+xml;base64,');
  });

  it('defaults to 12mm bar height / 20mm QR size in the img CSS when no paper-profile field size is configured', async () => {
    const renderer = new SimpleTemplateRenderer();
    const barcodeTpl = makeTemplate({ engine: 'HTML', content: '<div>{{barcode:code}}</div>' });
    const barcodePrint = await renderer.renderPrintPayload(barcodeTpl, { code: 'ABC123' }, makePaper());
    expect(barcodePrint.renderedPrintPayload).toContain('height:12mm');
    expect(barcodePrint.renderedPrintPayload).toContain('width:auto');

    const qrTpl = makeTemplate({ engine: 'HTML', content: '<div>{{qrcode:hn}}</div>' });
    const qrPrint = await renderer.renderPrintPayload(qrTpl, { hn: 'HN-0001' }, makePaper());
    expect(qrPrint.renderedPrintPayload).toContain('height:20mm');
    expect(qrPrint.renderedPrintPayload).toContain('width:20mm');
  });

  it('honours a paper-profile field\'s configured barcodeHeightMm/qrSizeMm in the img CSS, for both the plain-inferred and explicit-token forms', async () => {
    const renderer = new SimpleTemplateRenderer();
    const paper = makePaper({
      fields: [
        {
          id: 'f1', key: 'code', label: 'Code', defaultValue: '', type: 'barcode',
          barcodeSymbology: 'code128', barcodeHeightMm: 18, xMm: 5, yMm: 5, fontSize: 10, bold: false, color: '#000', align: 'left',
        },
        {
          id: 'f2', key: 'hn', label: 'HN', defaultValue: '', type: 'qrcode',
          qrSizeMm: 35, xMm: 5, yMm: 5, fontSize: 10, bold: false, color: '#000', align: 'left',
        },
      ],
    });

    // Plain-inferred: {{code}} / {{hn}} pick up size from the matching field.
    const plainTpl = makeTemplate({ engine: 'HTML', content: '<div>{{code}}</div><div>{{hn}}</div>' });
    const plainPrint = await renderer.renderPrintPayload(plainTpl, { code: 'ABC123', hn: 'HN-0001' }, paper);
    expect(plainPrint.renderedPrintPayload).toContain('height:18mm');
    expect(plainPrint.renderedPrintPayload).toContain('height:35mm');
    expect(plainPrint.renderedPrintPayload).toContain('width:35mm');

    // Explicit token naming the same field key still inherits its size.
    const explicitTpl = makeTemplate({ engine: 'HTML', content: '<div>{{barcode:code}}</div><div>{{qrcode:hn}}</div>' });
    const explicitPrint = await renderer.renderPrintPayload(explicitTpl, { code: 'ABC123', hn: 'HN-0001' }, paper);
    expect(explicitPrint.renderedPrintPayload).toContain('height:18mm');
    expect(explicitPrint.renderedPrintPayload).toContain('height:35mm');
  });

  it('adds a warning and omits the token gracefully when the barcode field is missing from the payload', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'HTML', content: '<div>{{barcode:code}}</div>' });
    const print = await renderer.renderPrintPayload(template, {}, makePaper());
    expect(print.warnings).toContain('Missing field: code');
    expect(print.renderedPrintPayload).not.toContain('<img');
  });

  it('does not affect templates with no barcode/qrcode tokens at all (existing plain-substitution behaviour)', async () => {
    const renderer = new SimpleTemplateRenderer();
    const template = makeTemplate({ engine: 'RAW_TEXT', content: 'TEST {{label}}' });
    const print = await renderer.renderPrintPayload(template, { label: 'hi' }, makePaper());
    expect(print.renderedPrintPayload).toBe('TEST hi');
  });
});
