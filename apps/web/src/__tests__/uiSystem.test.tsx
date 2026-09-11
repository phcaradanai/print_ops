import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  DataCell,
  DataHead,
  DataTable,
  Drawer,
  Input,
  Panel,
  Tab,
  TabList,
} from '../components/ui/index.js';

describe('shared UI composition', () => {
  it('connects invalid control semantics and input affixes', () => {
    const html = renderToStaticMarkup(<Input invalid leading="Search" aria-label="Search printers" />);
    expect(html).toContain('ui-input-group--invalid');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-label="Search printers"');
  });

  it('exposes tab selection and counts without relying on color', () => {
    const html = renderToStaticMarkup(
      <TabList label="Template filters"><Tab selected count={12}>Active</Tab></TabList>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('12');
  });

  it('labels panels by their generated heading', () => {
    const html = renderToStaticMarkup(<Panel title="Printer state">Ready</Panel>);
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
  });

  it('keeps responsive table labels in one semantic table', () => {
    const html = renderToStaticMarkup(
      <DataTable label="Users" responsive>
        <thead><tr><DataHead>Name</DataHead></tr></thead>
        <tbody><tr><DataCell label="Name">Ada</DataCell></tr></tbody>
      </DataTable>,
    );
    expect(html).toContain('<table');
    expect(html).toContain('data-responsive="true"');
    expect(html).toContain('data-label="Name"');
  });

  it('renders badge state as literal text', () => {
    const html = renderToStaticMarkup(<Badge tone="success">READY</Badge>);
    expect(html).toContain('ui-badge--success');
    expect(html).toContain('READY');
  });

  it('does not mount a closed drawer', () => {
    expect(renderToStaticMarkup(
      <Drawer open={false} onClose={() => {}} title="Fields" closeLabel="Close">content</Drawer>,
    )).toBe('');
  });
});
