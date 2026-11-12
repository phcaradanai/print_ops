import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PropertiesPanel } from '../components/PropertiesPanel.js';
import { DEFAULT_FORM, DEFAULT_UX, type PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { DynamicField } from '../model/types.js';

const FIELD = { id: 'f1', key: 'hn', label: 'HN', type: 'text', xMm: 4, yMm: 6, fontSize: 12, bold: true, color: '#000000', align: 'center', defaultValue: '' } as DynamicField;

function render(selectedField: DynamicField | null) {
  const editor = { form: DEFAULT_FORM, ux: { ...DEFAULT_UX, displayUnit: 'mm' }, selectedField } as unknown as PaperProfileEditor;
  return renderToStaticMarkup(<PropertiesPanel editor={editor} t={(key) => key} />);
}

describe('properties panel', () => {
  it('shows paper size and margins when nothing is selected', () => {
    const html = render(null);
    expect(html).toContain('page.paperProfiles.paperProperties');
    expect(html).toContain(`value="${DEFAULT_FORM.widthMm}"`);
    expect(html).toContain('page.paperProfiles.margins');
  });

  it('shows the selected field position and text style instead', () => {
    const html = render(FIELD);
    expect(html).not.toContain('page.paperProfiles.paperProperties');
    expect(html).toContain('value="4"');
    expect(html).toContain('value="6"');
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="page.paperProfiles.alignCenter"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="page.paperProfiles.bold"/);
  });
});
