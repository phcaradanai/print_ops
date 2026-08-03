import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildImportCandidates, filterEndpoints } from '../features/webhooks/model.js';
import { parseWebhookImportJson } from '../features/webhooks/parseImportJson.js';
import type { Endpoint } from '../features/webhooks/types.js';

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

function createExportPayload(endpoints: Endpoint[], selectedIds: string[] = []) {
  const listToExport = selectedIds.length > 0
    ? endpoints.filter((endpoint) => selectedIds.includes(endpoint.id))
    : endpoints;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: listToExport.length,
    endpoints: listToExport.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...endpoint }) => endpoint),
  };
}

function insertVariablePattern(
  currentText: string,
  variable: string,
  startPos?: number,
  endPos?: number,
): string {
  if (startPos === undefined || endPos === undefined) {
    return `${currentText} ${variable}`;
  }
  return currentText.substring(0, startPos) + variable + currentText.substring(endPos);
}

const sampleEndpoints: Endpoint[] = [
  {
    id: 'id-1',
    endpointCode: 'dev-intake',
    name: 'Development intake',
    sourceSystem: 'integration-service',
    authMode: 'NONE',
    enabled: true,
    routePolicyId: 'policy-1',
    callbackTransport: 'NONE',
    callbackOnPrintResult: false,
  },
  {
    id: 'id-2',
    endpointCode: 'documents-draft',
    name: 'Document bridge',
    sourceSystem: 'document-service',
    authMode: 'API_KEY',
    enabled: false,
    routePolicyId: 'policy-1',
    callbackTransport: 'HTTP',
    callbackUrl: 'https://integration.example/callback',
    callbackOnPrintResult: true,
  },
  {
    id: 'id-3',
    endpointCode: 'erp-intake',
    name: 'ERP intake',
    sourceSystem: 'erp-connector',
    authMode: 'API_KEY',
    enabled: true,
    routePolicyId: 'policy-1',
    callbackTransport: 'NATS',
    callbackNatsSubject: 'printops.erp.result',
    callbackOnPrintResult: false,
  },
];

describe('Webhooks focused workspace composition', () => {
  const routeSource = read('../pages/Webhooks.tsx');
  const workspaceSource = read('../features/webhooks/WebhookWorkspace.tsx');
  const editorSource = read('../features/webhooks/components/EndpointEditor.tsx');
  const listSource = read('../features/webhooks/components/EndpointList.tsx');
  const historySource = read('../features/webhooks/components/CallbackDeliveryLog.tsx');

  it('keeps the route entry point thin and delegates to the feature workspace', () => {
    expect(routeSource.trim()).toBe("export { default } from '../features/webhooks/WebhookWorkspace.js';");
  });

  it('composes the shared page header from title, description, freshness, and create action', () => {
    expect(workspaceSource).toContain("title={t('page.webhooks.title')}");
    expect(workspaceSource).toContain("description={t('page.webhooks.subtitle')}");
    expect(workspaceSource).toContain('actions={headerActions}');
    expect(workspaceSource).toContain('<Freshness');
    expect(workspaceSource).toContain("t('page.webhooks.createEndpoint')");
    expect(workspaceSource).not.toMatch(/\bheader=\{/);
  });

  it('separates endpoint list, editor, and delivery history into focused views', () => {
    expect(workspaceSource).toContain("view === 'editor'");
    expect(workspaceSource).toContain("view === 'history'");
    expect(workspaceSource).toContain('<EndpointList');
    expect(workspaceSource).toContain('<EndpointEditor');
    expect(workspaceSource).toContain('<CallbackDeliveryLog');
  });

  it('routes all editor section headings through the shared SectionHeading component', () => {
    expect(editorSource.match(/<SectionHeading/g) ?? []).toHaveLength(5);
  });

  it('uses one search and one status control rather than duplicate filters', () => {
    expect(listSource.match(/<SearchField/g) ?? []).toHaveLength(1);
    expect(listSource.match(/statusFilterLabel/g) ?? []).toHaveLength(1);
    expect(listSource).not.toContain('tabFilter');
  });

  it('keeps endpoint and delivery resource errors independent', () => {
    expect(workspaceSource).toContain('endpointsResource.error');
    expect(workspaceSource).toContain('callbackLogResource.error');
    expect(historySource).toContain('callbackLogResource.loading');
  });

  it('does not reference the retired bespoke layout classes', () => {
    const combined = `${workspaceSource}\n${editorSource}\n${listSource}\n${historySource}`;
    for (const dead of [
      'wh-header',
      'wh-header-title-area',
      'wh-header-text',
      'wh-header-actions',
      'wh-card-title',
      'wh-table-header',
    ]) {
      expect(combined).not.toContain(dead);
    }
  });
});

describe('Webhooks import preview logic', () => {
  it('parses an endpoint array and marks valid records as new', () => {
    const parsed = parseWebhookImportJson(new TextEncoder().encode(JSON.stringify([
      { endpointCode: 'ep-1', name: 'Endpoint 1', sourceSystem: 'integration-service' },
      { endpointCode: 'ep-2', name: 'Endpoint 2', sourceSystem: 'document-service' },
    ])).buffer);
    const candidates = buildImportCandidates(parsed as Partial<Endpoint>[], []);
    expect(candidates.map((candidate) => candidate.status)).toEqual(['new', 'new']);
  });

  it('parses the exported object container with an endpoints property', () => {
    const parsed = parseWebhookImportJson(new TextEncoder().encode(JSON.stringify({
      version: 1,
      endpoints: [{ endpointCode: 'ep-3', name: 'Endpoint 3' }],
    })).buffer) as { endpoints: Partial<Endpoint>[] };
    expect(parsed.endpoints[0]?.name).toBe('Endpoint 3');
  });

  it('marks existing and invalid rows independently instead of dropping evidence', () => {
    const candidates = buildImportCandidates([
      { endpointCode: 'dev-intake', name: 'Existing endpoint' },
      { endpointCode: 'bad endpoint', name: '' },
    ], sampleEndpoints);
    expect(candidates[0]?.status).toBe('existing');
    expect(candidates[1]?.status).toBe('invalid');
    expect(candidates[1]?.errors).toHaveLength(2);
  });

  it('throws for malformed JSON so the UI can show a persistent error', () => {
    expect(() => parseWebhookImportJson(new TextEncoder().encode('{ malformed json }').buffer)).toThrow();
  });
});

describe('Webhooks export scope logic', () => {
  it('exports all endpoints when no selection is specified', () => {
    const exported = createExportPayload(sampleEndpoints);
    expect(exported.version).toBe(1);
    expect(exported.count).toBe(3);
    expect(exported.endpoints.map((endpoint) => endpoint.endpointCode))
      .toEqual(['dev-intake', 'documents-draft', 'erp-intake']);
  });

  it('exports only selected endpoints when selected IDs are provided', () => {
    const exported = createExportPayload(sampleEndpoints, ['id-2']);
    expect(exported.count).toBe(1);
    expect(exported.endpoints[0]?.endpointCode).toBe('documents-draft');
    expect(exported.endpoints[0]?.callbackUrl).toBe('https://integration.example/callback');
  });

  it('does not export database-only identity and timestamp fields', () => {
    const exported = createExportPayload(sampleEndpoints, ['id-1']);
    expect(exported.endpoints[0]).not.toHaveProperty('id');
    expect(exported.endpoints[0]).not.toHaveProperty('createdAt');
    expect(exported.endpoints[0]).not.toHaveProperty('updatedAt');
  });
});

describe('Webhooks template variable insertion', () => {
  it('inserts an intake token verbatim at the cursor position', () => {
    const original = '{"document_ref": ""}';
    const result = insertVariablePattern(original, '$.document_ref', 18, 18);
    expect(result).toBe('{"document_ref": "$.document_ref"}');
  });

  it('inserts a system token verbatim, replacing the selection range', () => {
    const original = '{"id": "REPLACE_ME"}';
    const result = insertVariablePattern(original, '$$.print_job_id', 8, 18);
    expect(result).toBe('{"id": "$$.print_job_id"}');
  });

  it('appends with a space when no selection positions are provided', () => {
    expect(insertVariablePattern('{"key":', '$$.status')).toBe('{"key": $$.status');
  });

  it('never produces the unreadable ${.field} form', () => {
    for (const token of ['$.document_ref', '$$.request_id', '$$.duplicate']) {
      expect(insertVariablePattern('{}', token, 1, 1)).not.toContain('${.');
    }
  });
});

describe('Webhooks canonical filtering logic', () => {
  it('filters enabled endpoints with one canonical state filter', () => {
    const filtered = filterEndpoints(sampleEndpoints, '', 'enabled');
    expect(filtered.map((endpoint) => endpoint.endpointCode)).toEqual(['dev-intake', 'erp-intake']);
  });

  it('filters draft endpoints', () => {
    const filtered = filterEndpoints(sampleEndpoints, '', 'draft');
    expect(filtered.map((endpoint) => endpoint.endpointCode)).toEqual(['documents-draft']);
  });

  it('filters endpoints without callbacks', () => {
    const filtered = filterEndpoints(sampleEndpoints, '', 'no_callback');
    expect(filtered.map((endpoint) => endpoint.endpointCode)).toEqual(['dev-intake']);
  });

  it('searches endpoint code, display name, and source system', () => {
    expect(filterEndpoints(sampleEndpoints, 'document-service', 'all').map((endpoint) => endpoint.endpointCode))
      .toEqual(['documents-draft']);
    expect(filterEndpoints(sampleEndpoints, 'ERP intake', 'all').map((endpoint) => endpoint.endpointCode))
      .toEqual(['erp-intake']);
  });
});
