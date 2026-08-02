import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataCell, DataHead, DataTable } from './data-display.js';

describe('DataTable', () => {
  it('keeps the shared and visual compatibility classes together', () => {
    const markup = renderToStaticMarkup(
      <DataTable label="คิวงานพิมพ์" responsive className="queue-table">
        <thead>
          <tr>
            <DataHead>สถานะ</DataHead>
          </tr>
        </thead>
        <tbody>
          <tr className="is-selected">
            <DataCell label="สถานะ">SUCCESS</DataCell>
          </tr>
        </tbody>
      </DataTable>,
    );

    expect(markup).toContain('class="data-table ui-data-table queue-table"');
    expect(markup).toContain('class="ui-data-table-frame"');
    expect(markup).toContain('aria-label="คิวงานพิมพ์"');
    expect(markup).toContain('data-responsive="true"');
    expect(markup).toContain('class="is-selected"');
  });
});
