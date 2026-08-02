import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SelectFilter } from './SelectFilter.js';

describe('SelectFilter', () => {
  it('renders a labelled select and preserves options', () => {
    const markup = renderToStaticMarkup(
      <SelectFilter label="สถานะ" value="FAILED" onValueChange={() => undefined}>
        <option value="ALL">ทั้งหมด</option>
        <option value="FAILED">FAILED (2)</option>
      </SelectFilter>,
    );

    expect(markup).toContain('สถานะ');
    expect(markup).toContain('<select');
    expect(markup).toContain('value="FAILED"');
    expect(markup).toContain('FAILED (2)');
    expect(markup).toMatch(/<label[^>]+for="([^"]+)"/);
    expect(markup).toMatch(/<select[^>]+id="([^"]+)"/);
  });

  it('keeps required and error states aligned across label, aria, and styling', () => {
    const markup = renderToStaticMarkup(
      <SelectFilter
        label="สถานะ"
        value=""
        required
        requiredLabel="จำเป็น"
        error="กรุณาเลือกสถานะ"
        onValueChange={() => undefined}
      >
        <option value="">เลือกสถานะ</option>
      </SelectFilter>,
    );

    expect(markup).toContain('aria-label="จำเป็น"');
    expect(markup).toContain('required=""');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('ui-select--invalid');
    expect(markup).toContain('กรุณาเลือกสถานะ');
  });
});
