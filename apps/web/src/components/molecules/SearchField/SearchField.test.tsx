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
});
