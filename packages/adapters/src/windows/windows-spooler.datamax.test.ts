import { describe, expect, it } from 'vitest';
import { isDatamaxI4208, textPayloadToHtml } from './windows-spooler.adapter.js';

describe('Datamax-O\'Neil I-4208 label routing', () => {
  it('recognises the hardware from model metadata and the Windows queue name', () => {
    expect(isDatamaxI4208({ model: "Datamax-O'Neil I-4208", dpi: 203 })).toBe(true);
    expect(isDatamaxI4208({}, "Datamax-O'Neil I-4208")).toBe(true);
    expect(isDatamaxI4208({ model: 'EPSON L15160' }, 'EPSON L15160')).toBe(false);
  });

  it('escapes RAW_TEXT before sending it through the profile-sized HTML path', () => {
    const html = textPayloadToHtml('HN <123>\n"AB\'');

    expect(html).toContain('HN &lt;123&gt;');
    expect(html).toContain('&quot;AB&#39;');
    expect(html).toContain('white-space:pre-wrap');
    expect(html).toContain('overflow:hidden');
  });
});
