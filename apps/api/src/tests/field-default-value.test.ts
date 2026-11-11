import { describe, it, expect } from 'vitest';
import type { PrintTemplate, PaperProfile } from '@printerops/domain';
import { SimpleTemplateRenderer } from '../infra/template/simple-template-renderer.js';

const now = new Date();
const template = {
  id: 't', templateCode: 'T', name: 'T', engine: 'RAW_TEXT', content: 'A={{name}} B={{ward}}',
  version: 1, status: 'PUBLISHED', createdBy: 'x', updatedBy: 'x', createdAt: now, updatedAt: now,
} as PrintTemplate;
const field = (key: string, defaultValue: string) => ({
  id: key, key, label: key, defaultValue, type: 'text', xMm: 0, yMm: 0, fontSize: 12, bold: false, color: '#000', align: 'left',
});
const paper = {
  id: 'p', code: 'P', name: 'P', widthMm: 100, heightMm: 50, marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2,
  marginLeftMm: 2, dpi: 203, orientation: 'portrait', unit: 'mm',
  fields: [field('name', 'N/A'), field('ward', 'W0')], createdAt: now, updatedAt: now,
} as PaperProfile;

describe('paper-profile field defaultValue', () => {
  it('fills missing or empty keys but keeps supplied values', async () => {
    const r = await new SimpleTemplateRenderer().renderPrintPayload(template, { name: '', other: 1 }, paper);
    expect(r.renderedPrintPayload).toBe('A=N/A B=W0');
    const r2 = await new SimpleTemplateRenderer().renderPrintPayload(template, { name: 'Bob', ward: 'X' }, paper);
    expect(r2.renderedPrintPayload).toBe('A=Bob B=X');
  });
});
