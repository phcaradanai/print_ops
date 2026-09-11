import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchField } from './SearchField.js';

describe('SearchField', () => {
  it('renders a labelled search control with localized copy', () => {
    const markup = renderToStaticMarkup(
      <SearchField
        label="ค้นหางาน"
        value="HN-123"
        placeholder="รหัสงานหรือเครื่องพิมพ์"
        onValueChange={() => undefined}
      />,
    );

    expect(markup).toContain('ค้นหางาน');
    expect(markup).toContain('type="search"');
    expect(markup).toContain('value="HN-123"');
    expect(markup).toContain('placeholder="รหัสงานหรือเครื่องพิมพ์"');
    expect(markup).toMatch(/<label[^>]+for="([^"]+)"/);
    expect(markup).toMatch(/<input[^>]+id="([^"]+)"/);
  });

  it('keeps required and error states aligned across label, aria, and styling', () => {
    const markup = renderToStaticMarkup(
      <SearchField
        label="ค้นหางาน"
        value=""
        required
        requiredLabel="จำเป็น"
        error="กรุณาระบุคำค้น"
        onValueChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="จำเป็น"');
    expect(markup).toContain('required=""');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('ui-input--invalid');
    expect(markup).toContain('กรุณาระบุคำค้น');
  });

  it('treats an empty error string as no error', () => {
    const markup = renderToStaticMarkup(
      <SearchField
        label="ค้นหางาน"
        value=""
        error=""
        onValueChange={() => undefined}
      />,
    );

    expect(markup).not.toContain('aria-invalid="true"');
    expect(markup).not.toContain('ui-input--invalid');
    expect(markup).not.toContain('ui-field--invalid');
    expect(markup).not.toContain('ui-field-error');
  });
});
