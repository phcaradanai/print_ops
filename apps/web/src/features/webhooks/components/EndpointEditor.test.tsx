import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_WEBHOOK_FORM } from '../model.js';
import type { Policy, WebhookEditorForm } from '../types.js';
import type { WebhookWorkspaceController } from '../useWebhookWorkspace.js';
import { EndpointEditor } from './EndpointEditor.js';

const policy: Policy = {
  id: 'policy-1',
  policyCode: 'GENERIC_LABEL',
  name: 'Generic label route',
  payloadMapping: { request_id: '$.request_id', barcode: '$.barcode' },
};

const labels: Record<string, string> = {
  'page.webhooks.backToEndpoints': 'Back to endpoints',
  'page.webhooks.editorCreateTitle': 'Create intake endpoint',
  'page.webhooks.editorEditTitle': 'Edit endpoint: {code}',
  'page.webhooks.editorDescription': 'Editor description',
  'page.webhooks.inboundSection': 'Inbound intake endpoint',
  'page.webhooks.outboundSection': 'Outbound callbacks',
  'page.webhooks.identityTitle': 'Endpoint identity',
  'page.webhooks.identityDescription': 'External integration service',
  'page.webhooks.endpointCode': 'Endpoint code',
  'page.webhooks.endpointCodeHint': 'Code hint',
  'page.webhooks.endpointCodePlaceholder': 'labels-v1',
  'page.webhooks.displayName': 'Display name',
  'page.webhooks.namePlaceholder': 'Generic labels',
  'page.webhooks.source': 'Source system',
  'page.webhooks.sourceHint': 'External integration service calling PrintOps',
  'page.webhooks.routingTitle': 'Intake routing and authentication',
  'page.webhooks.authModeLabel': 'Authentication mode',
  'page.webhooks.authNone': 'None',
  'page.webhooks.authApiKey': 'API key',
  'page.webhooks.authNoneHelp': 'Trusted network only',
  'page.webhooks.authApiKeyHelp': 'X-Api-Key required',
  'page.webhooks.routePolicyLabel': 'Route policy',
  'page.webhooks.routePolicyPlaceholder': 'Select a route policy',
  'page.webhooks.callbackTriggerTitle': 'Callback trigger',
  'page.webhooks.callbackTriggerAcceptance': 'Send acceptance callback',
  'page.webhooks.callbackTriggerTerminal': 'Send terminal print-result callback',
  'page.webhooks.callbackAcceptanceHelp': 'Acceptance does not prove printing.',
  'page.webhooks.callbackTerminalHelp': 'SUCCESS and UNVERIFIED remain distinct.',
  'page.webhooks.callbackTransportTitle': 'Callback transport',
  'page.webhooks.transport.none': 'None',
  'page.webhooks.transport.http': 'HTTP',
  'page.webhooks.transport.nats': 'NATS',
  'page.webhooks.transport.both': 'HTTP and NATS',
  'page.webhooks.httpTargetLabel': 'HTTP target URL',
  'page.webhooks.httpTargetPlaceholder': 'https://integration.example/callback',
  'page.webhooks.natsSubjectLabel': 'NATS subject',
  'page.webhooks.natsSubjectPlaceholder': 'printops.result',
  'page.webhooks.payloadTemplate': 'Acceptance payload template',
  'page.webhooks.payloadTemplateHelp': 'Acceptance template help',
  'page.webhooks.payloadTemplateIgnoredOnResult': 'Fixed terminal envelope',
  'page.webhooks.saveDraft': 'Save draft',
  'page.webhooks.testSavedEndpoint': 'Test callback',
  'page.webhooks.unsavedTestHelp': 'Save the endpoint before testing callback delivery.',
  'page.webhooks.createEndpoint': 'Create endpoint',
  'common.cancel': 'Cancel',
  'common.required': 'required',
};

function controllerFor(
  patch: Partial<WebhookEditorForm> = {},
  editingId: string | null = null,
): WebhookWorkspaceController {
  const form: WebhookEditorForm = {
    ...EMPTY_WEBHOOK_FORM,
    endpointCode: 'labels-v1',
    name: 'Generic labels',
    routePolicyId: policy.id,
    ...patch,
  };
  return {
    t: (key: string) => labels[key] ?? key,
    form,
    updateForm: vi.fn(),
    errors: {},
    editingId,
    policies: [policy],
    policiesResource: { error: null, loading: false },
    busy: false,
    closeEditor: vi.fn(),
    saveEndpoint: vi.fn(),
    testCallback: vi.fn(),
  } as unknown as WebhookWorkspaceController;
}

describe('EndpointEditor', () => {
  it('renders authentication and route policy as separate labelled controls', () => {
    const html = renderToStaticMarkup(<EndpointEditor controller={controllerFor()} />);
    expect(html).toContain('Authentication mode');
    expect(html).toContain('Route policy');
    expect(html).toContain('GENERIC_LABEL — Generic label route');
  });

  it('progressively discloses callback transport fields', () => {
    const none = renderToStaticMarkup(<EndpointEditor controller={controllerFor()} />);
    expect(none).not.toContain('HTTP target URL');
    expect(none).not.toContain('NATS subject');

    const http = renderToStaticMarkup(
      <EndpointEditor controller={controllerFor({ callbackTransport: 'HTTP' })} />,
    );
    expect(http).toContain('HTTP target URL');
    expect(http).not.toContain('NATS subject');

    const both = renderToStaticMarkup(
      <EndpointEditor controller={controllerFor({ callbackTransport: 'BOTH' })} />,
    );
    expect(both).toContain('HTTP target URL');
    expect(both).toContain('NATS subject');
  });

  it('exposes invalid JSON before submission', () => {
    const html = renderToStaticMarkup(
      <EndpointEditor controller={controllerFor({ callbackPayloadTemplate: '{bad' })} />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('page.webhooks.validationJsonParse');
  });

  it('keeps line numbers aligned to actual newline-delimited rows', () => {
    const html = renderToStaticMarkup(
      <EndpointEditor controller={controllerFor({ callbackPayloadTemplate: '{\n  "long": "value"\n}' })} />,
    );
    const gutter = html.match(/<div class="webhook-json-editor__gutter"[^>]*>(.*?)<\/div>/s)?.[1] ?? '';

    expect(gutter).toContain('<span>1</span><span>2</span><span>3</span>');
    expect(gutter).not.toContain('<span>4</span>');
    expect(html).toContain('wrap="off"');
  });

  it('disables callback testing for an unsaved endpoint and explains why', () => {
    const html = renderToStaticMarkup(<EndpointEditor controller={controllerFor()} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Test callback/s);
    expect(html).toContain('Save the endpoint before testing callback delivery.');
  });

  it('explains terminal result semantics without collapsing UNVERIFIED into failure', () => {
    const html = renderToStaticMarkup(
      <EndpointEditor controller={controllerFor({ callbackOnPrintResult: true }, 'endpoint-1')} />,
    );
    expect(html).toContain('Send terminal print-result callback');
    expect(html).toContain('SUCCESS and UNVERIFIED remain distinct.');
    expect(html).toContain('Fixed terminal envelope');
  });
});
