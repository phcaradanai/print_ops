import { describe, expect, it } from 'vitest';
import type { PaperProfile, PrintTemplate } from '@printerops/domain';
import { SimpleTemplateRenderer } from '../infra/template/simple-template-renderer.js';

function makePaper(overrides: Partial<PaperProfile> = {}): PaperProfile {
  const now = new Date();
  return {
    id: 'paper-transform',
    code: 'LABEL_100X50',
    name: 'Label 100x50',
    widthMm: 100,
    heightMm: 50,
    marginTopMm: 2,
    marginRightMm: 3,
    marginBottomMm: 4,
    marginLeftMm: 5,
    dpi: 203,
    orientation: 'landscape',
    unit: 'mm',
    fields: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTemplate(): PrintTemplate {
  const now = new Date();
  return {
    id: 'template-transform',
    templateCode: 'TRANSFORM',
    name: 'Transform test',
    engine: 'HTML',
    content: '<div>{{label}}</div><div>{{barcode:code}}</div><div>{{qrcode:code}}</div>',
    version: 1,
    status: 'PUBLISHED',
    createdBy: 'test',
    updatedBy: 'test',
    createdAt: now,
    updatedAt: now,
  };
}

describe('HTML rendering transforms', () => {
  it('uses the Paper Profile transform for print and preview, including barcode/QR output', async () => {
    const renderer = new SimpleTemplateRenderer();
    const paper = makePaper({ rotation: 90, flipHorizontal: true, flipVertical: false });
    const payload = { label: 'Sample label', code: 'ABC123' };

    const print = await renderer.renderPrintPayload(makeTemplate(), payload, paper);
    const preview = await renderer.renderPreview(makeTemplate(), payload, paper);

    for (const output of [print.renderedPrintPayload, preview.renderedPreview]) {
      expect(output).toContain('data-printops-transform-frame="true"');
      expect(output).toContain('transform:rotate(90deg) scaleX(-1) scaleY(1)');
      expect(output).toContain('Sample label');
      expect(output).toContain('data:image/png;base64,');
      expect(output).toContain('data:image/svg+xml;base64,');
      expect(output).toContain('width:100mm;height:50mm;overflow:hidden');
    }
  });

  it('applies per-job overrides without changing the physical paper frame', async () => {
    const renderer = new SimpleTemplateRenderer();
    const paper = makePaper({ rotation: 15, flipHorizontal: true, flipVertical: true });
    const options = { rotate: 270, flipHorizontal: false, flipVertical: true };
    const result = await renderer.renderPreview(makeTemplate(), { label: 'Override', code: 'JOB-1' }, paper, options);

    expect(result.renderedPrintPayload).toContain('transform:rotate(270deg) scaleX(1) scaleY(-1)');
    expect(result.renderedPreview).toContain('transform:rotate(270deg) scaleX(1) scaleY(-1)');
    expect(result.renderedPrintPayload).not.toContain('rotate(15deg)');
    expect(result.renderedPreview).not.toContain('rotate(15deg)');
    expect(result.renderedPrintPayload).toContain('width:100mm;height:50mm;overflow:hidden');
    expect(result.renderedPreview).toContain('width:100mm;height:50mm;overflow:hidden');
  });
});
