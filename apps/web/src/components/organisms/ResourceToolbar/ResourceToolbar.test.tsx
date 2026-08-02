import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResourceToolbar } from './ResourceToolbar.js';

describe('ResourceToolbar', () => {
  it('groups controls and optional actions under one accessible name', () => {
    const markup = renderToStaticMarkup(
      <ResourceToolbar ariaLabel="ตัวกรองคิวงาน" actions={<button>รีเซ็ต</button>}>
        <input aria-label="ค้นหา" />
      </ResourceToolbar>,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="ตัวกรองคิวงาน"');
    expect(markup).toContain('ui-resource-toolbar__controls');
    expect(markup).toContain('ui-resource-toolbar__actions');
    expect(markup).toContain('รีเซ็ต');
  });
});
