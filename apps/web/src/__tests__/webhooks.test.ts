import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Unit tests for Webhooks UI state logic (Import, Export, Batch Operations, Template Variables, Filtering)

interface Endpoint {
  id: string;
  endpointCode: string;
  name: string;
  sourceSystem: string;
  authMode: string;
  enabled: boolean;
  routePolicyId: string;
  callbackTransport: 'NONE' | 'HTTP' | 'NATS' | 'BOTH';
  callbackUrl?: string;
  callbackNatsSubject?: string;
  callbackPayloadTemplate?: Record<string, unknown>;
  callbackOnPrintResult: boolean;
}

function parseImportJSON(jsonText: string): { valid: Partial<Endpoint>[]; invalidCount: number } {
  try {
    const parsed = JSON.parse(jsonText);
    const importedList: Partial<Endpoint>[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.endpoints)
      ? parsed.endpoints
      : [];

    const valid = importedList.filter((item) => item.endpointCode && item.name);
    return {
      valid,
      invalidCount: importedList.length - valid.length,
    };
  } catch {
    return { valid: [], invalidCount: 0 };
  }
}

function createExportPayload(endpoints: Endpoint[], selectedIds: string[] = []) {
  const listToExport = selectedIds.length > 0
    ? endpoints.filter((e) => selectedIds.includes(e.id))
    : endpoints;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: listToExport.length,
    endpoints: listToExport.map((e) => ({
      endpointCode: e.endpointCode,
      name: e.name,
      sourceSystem: e.sourceSystem,
      authMode: e.authMode,
      enabled: e.enabled,
      routePolicyId: e.routePolicyId,
      callbackTransport: e.callbackTransport,
      callbackUrl: e.callbackUrl,
      callbackNatsSubject: e.callbackNatsSubject,
      callbackPayloadTemplate: e.callbackPayloadTemplate,
      callbackOnPrintResult: e.callbackOnPrintResult,
    })),
  };
}

/** Mirrors insertVariableIntoTemplate in Webhooks.tsx: the token goes in as
 *  written. It used to be rewritten to `${.field}`, which the callback resolver
 *  matches as neither a field path nor an embedded token. */
function insertVariablePattern(currentText: string, variable: string, startPos?: number, endPos?: number): string {
  if (startPos === undefined || endPos === undefined) {
    return currentText + ' ' + variable;
  }
  return currentText.substring(0, startPos) + variable + currentText.substring(endPos);
}

function calculateTabCounts(endpoints: Endpoint[]) {
  return {
    all: endpoints.length,
    active: endpoints.filter((e) => e.enabled).length,
    draft: endpoints.filter((e) => !e.enabled).length,
    none_callback: endpoints.filter((e) => e.callbackTransport === 'NONE').length,
  };
}

function filterEndpoints(
  endpoints: Endpoint[],
  tabFilter: 'all' | 'active' | 'draft' | 'none_callback',
  statusFilter: 'all' | 'active' | 'draft' | 'none_callback',
  searchQuery: string
) {
  return endpoints.filter((e) => {
    if (tabFilter === 'active' && !e.enabled) return false;
    if (tabFilter === 'draft' && e.enabled) return false;
    if (tabFilter === 'none_callback' && e.callbackTransport !== 'NONE') return false;

    if (statusFilter === 'active' && !e.enabled) return false;
    if (statusFilter === 'draft' && e.enabled) return false;
    if (statusFilter === 'none_callback' && e.callbackTransport !== 'NONE') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const codeMatch = e.endpointCode.toLowerCase().includes(q);
      const nameMatch = e.name.toLowerCase().includes(q);
      const sourceMatch = e.sourceSystem.toLowerCase().includes(q);
      return codeMatch || nameMatch || sourceMatch;
    }
    return true;
  });
}

describe('Webhooks page layout composition', () => {
  // Source-level, deliberately: rendering this page needs the locale provider,
  // the API client and four resource hooks, and the thing worth guarding is
  // structural — that the header goes through PageLayout's own props instead of
  // drifting back to the bespoke `wh-header` markup this page used to carry.
  // See docs/frontend/webhooks-layout-audit.md.
  const source = readFileSync(
    fileURLToPath(new URL('../pages/Webhooks.tsx', import.meta.url)),
    'utf8',
  );

  it('composes the page header from title, description and actions', () => {
    expect(source).toContain("title={t('page.webhooks.title')}");
    expect(source).toContain("description={t('page.webhooks.subtitle')}");
    expect(source).toMatch(/actions=\{<>/);
  });

  it('passes no custom header, so the shared PageHeader owns the landmark', () => {
    expect(source).not.toMatch(/\bheader=\{/);
  });

  it('no longer references the retired bespoke layout classes', () => {
    for (const dead of ['wh-header', 'wh-header-title-area', 'wh-header-text',
                        'wh-header-actions', 'wh-card-title', 'wh-table-header']) {
      expect(source).not.toContain(dead);
    }
  });

  it('routes all three card headings through SectionHeading', () => {
    // One per Card, plus the two level-3 sub-headings inside the editor.
    expect(source.match(/<SectionHeading/g) ?? []).toHaveLength(5);
  });
});

describe('Webhooks Import JSON logic', () => {
  it('parses valid endpoint array JSON structure', () => {
    const raw = JSON.stringify([
      { endpointCode: 'ep-1', name: 'Endpoint 1', sourceSystem: 'sys1' },
      { endpointCode: 'ep-2', name: 'Endpoint 2', sourceSystem: 'sys2' },
    ]);
    const res = parseImportJSON(raw);
    expect(res.valid.length).toBe(2);
    expect(res.valid[0].endpointCode).toBe('ep-1');
    expect(res.invalidCount).toBe(0);
  });

  it('parses object container with endpoints property', () => {
    const raw = JSON.stringify({
      version: 1,
      endpoints: [
        { endpointCode: 'ep-3', name: 'Endpoint 3' },
      ],
    });
    const res = parseImportJSON(raw);
    expect(res.valid.length).toBe(1);
    expect(res.valid[0].name).toBe('Endpoint 3');
  });

  it('filters out invalid objects missing endpointCode or name', () => {
    const raw = JSON.stringify([
      { endpointCode: 'ep-valid', name: 'Valid' },
      { endpointCode: '', name: 'No Code' },
      { name: 'No Code Property' },
      { endpointCode: 'No Name' },
    ]);
    const res = parseImportJSON(raw);
    expect(res.valid.length).toBe(1);
    expect(res.valid[0].endpointCode).toBe('ep-valid');
    expect(res.invalidCount).toBe(3);
  });

  it('returns empty result for malformed JSON string', () => {
    const res = parseImportJSON('{ malformed json }');
    expect(res.valid).toEqual([]);
    expect(res.invalidCount).toBe(0);
  });
});

describe('Webhooks Export JSON logic', () => {
  const sampleEndpoints: Endpoint[] = [
    {
      id: 'id-1',
      endpointCode: 'dev-intake',
      name: 'Dev Intake',
      sourceSystem: 'integration-service',
      authMode: 'NONE',
      enabled: true,
      routePolicyId: '',
      callbackTransport: 'NONE',
      callbackOnPrintResult: false,
    },
    {
      id: 'id-2',
      endpointCode: 'qa-intake',
      name: 'QA Intake',
      sourceSystem: 'his-system',
      authMode: 'API_KEY',
      enabled: false,
      routePolicyId: 'pol-1',
      callbackTransport: 'HTTP',
      callbackUrl: 'https://example.com/callback',
      callbackOnPrintResult: true,
    },
  ];

  it('exports all endpoints when no selection is specified', () => {
    const exported = createExportPayload(sampleEndpoints, []);
    expect(exported.version).toBe(1);
    expect(exported.count).toBe(2);
    expect(exported.endpoints.length).toBe(2);
    expect(exported.endpoints[0].endpointCode).toBe('dev-intake');
    expect(exported.endpoints[1].endpointCode).toBe('qa-intake');
  });

  it('exports only selected endpoints when selectedIds are provided', () => {
    const exported = createExportPayload(sampleEndpoints, ['id-2']);
    expect(exported.count).toBe(1);
    expect(exported.endpoints.length).toBe(1);
    expect(exported.endpoints[0].endpointCode).toBe('qa-intake');
    expect(exported.endpoints[0].callbackUrl).toBe('https://example.com/callback');
  });

  it('handles empty list gracefully', () => {
    const exported = createExportPayload([], []);
    expect(exported.count).toBe(0);
    expect(exported.endpoints).toEqual([]);
  });
});

describe('Webhooks Template Variable Insertion', () => {
  it('inserts an intake token verbatim at the cursor position', () => {
    const original = '{"hn": ""}';
    const result = insertVariablePattern(original, '$.hn', 8, 8);
    expect(result).toBe('{"hn": "$.hn"}');
  });

  it('inserts a system token verbatim, replacing the selection range', () => {
    const original = '{"id": "REPLACE_ME"}';
    const result = insertVariablePattern(original, '$$.print_job_id', 8, 18);
    expect(result).toBe('{"id": "$$.print_job_id"}');
  });

  it('appends with a space when no selection positions are provided', () => {
    const original = '{"key":';
    const result = insertVariablePattern(original, '$$.status');
    expect(result).toBe('{"key": $$.status');
  });

  it('never produces the ${.field} form the resolver cannot read', () => {
    for (const token of ['$.hn', '$$.request_id', '$$.duplicate']) {
      expect(insertVariablePattern('{}', token, 1, 1)).not.toContain('${.');
    }
  });
});

describe('Webhooks Filtering & Tab Count logic', () => {
  const dataset: Endpoint[] = [
    { id: '1', endpointCode: 'dev-intake', name: 'Dev Intake', sourceSystem: 'integration-service', authMode: 'NONE', enabled: true, routePolicyId: '', callbackTransport: 'NONE', callbackOnPrintResult: false },
    { id: '2', endpointCode: 'qa-intake', name: 'QA Intake', sourceSystem: 'his-system', authMode: 'NONE', enabled: false, routePolicyId: '', callbackTransport: 'HTTP', callbackOnPrintResult: false },
    { id: '3', endpointCode: 'prod-intake', name: 'Prod Intake', sourceSystem: 'pos-gateway', authMode: 'API_KEY', enabled: true, routePolicyId: '', callbackTransport: 'NONE', callbackOnPrintResult: false },
  ];

  it('calculates tab counts accurately', () => {
    const counts = calculateTabCounts(dataset);
    expect(counts.all).toBe(3);
    expect(counts.active).toBe(2);
    expect(counts.draft).toBe(1);
    expect(counts.none_callback).toBe(2);
  });

  it('filters active endpoints when tab is active', () => {
    const filtered = filterEndpoints(dataset, 'active', 'all', '');
    expect(filtered.length).toBe(2);
    expect(filtered.every((e) => e.enabled)).toBe(true);
  });

  it('filters draft endpoints when tab is draft', () => {
    const filtered = filterEndpoints(dataset, 'draft', 'all', '');
    expect(filtered.length).toBe(1);
    expect(filtered[0].endpointCode).toBe('qa-intake');
  });

  it('filters by search query', () => {
    const filtered = filterEndpoints(dataset, 'all', 'all', 'his-system');
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('QA Intake');
  });
});
