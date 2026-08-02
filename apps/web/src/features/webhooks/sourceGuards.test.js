import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, path), 'utf8');

describe('webhook workspace source guards', () => {
  it('keeps the route entry point thin and delegates to the feature workspace', () => {
    const source = read('../../pages/Webhooks.tsx');
    expect(source).toContain("features/webhooks/WebhookWorkspace.js");
    expect(source.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('does not use native confirm or clinical example fields', () => {
    const files = [
      read('./WebhookWorkspace.tsx'),
      read('./useWebhookWorkspace.ts'),
      read('./components/EndpointEditor.tsx'),
      read('./components/EndpointList.tsx'),
      read('./components/WebhookDialogs.tsx'),
      read('./model.ts'),
    ].join('\n');
    expect(files).not.toMatch(/\bwindow\.confirm\b|\bconfirm\s*\(/);
    expect(files).not.toMatch(/patient_name|\bhn\b|medication|PRINT_COMPLETED|COMPLETED/i);
  });

  it('keeps authentication, route policy, and callback transport separate', () => {
    const editor = read('./components/EndpointEditor.tsx');
    expect(editor).toContain("authModeLabel");
    expect(editor).toContain("routePolicyLabel");
    expect(editor).toContain("callbackTransportTitle");
    expect(editor).toContain("showHttp");
    expect(editor).toContain("showNats");
  });

  it('keeps endpoint and delivery failures on independent resources', () => {
    const workspace = read('./WebhookWorkspace.tsx');
    expect(workspace).toContain("endpointsResource.error");
    expect(workspace).toContain("callbackLogResource.error");
    expect(workspace).toContain("view === 'history'");
  });

  it('renders mobile record surfaces instead of relying on a miniature table', () => {
    const endpoints = read('./components/EndpointList.tsx');
    const history = read('./components/CallbackDeliveryLog.tsx');
    const css = read('./webhooks.css');
    expect(endpoints).toContain('RecordList');
    expect(history).toContain('RecordList');
    expect(css).toContain('.webhook-endpoint-cards');
    expect(css).toContain('@media (max-width: 760px)');
  });
});
