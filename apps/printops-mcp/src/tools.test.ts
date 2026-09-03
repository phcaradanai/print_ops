import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DATAMAX_PAPER_PROFILE_ID,
  DEFAULT_DATAMAX_PRINTER_CODE,
  DEFAULT_DATAMAX_TEMPLATE_CODE,
} from './config.js';
import { PrintOpsApiClient } from './printops-client.js';
import { buildValidationBatchRequest } from './tools.js';

const config = {
  datamaxPrinterCode: DEFAULT_DATAMAX_PRINTER_CODE,
  datamaxTemplateCode: DEFAULT_DATAMAX_TEMPLATE_CODE,
  datamaxPaperProfileId: DEFAULT_DATAMAX_PAPER_PROFILE_ID,
};

describe('PrintOps MCP Datamax validation request', () => {
  it('keeps dynamic values and creates exactly one 3-up row', () => {
    const request = buildValidationBatchRequest(
      {
        confirm: true,
        batchId: 'physical-001',
        values: ['12345678', '42', '1234567890'],
        printerCode: DEFAULT_DATAMAX_PRINTER_CODE,
        templateCode: DEFAULT_DATAMAX_TEMPLATE_CODE,
        paperProfileId: DEFAULT_DATAMAX_PAPER_PROFILE_ID,
      },
      config,
    );

    expect(request.scenarios).toHaveLength(3);
    expect(request.scenarios.map((scenario) => scenario.samplePayload.barcode)).toEqual([
      '12345678',
      '42',
      '1234567890',
    ]);
    expect(request.scenarios.map((scenario) => scenario.testPrint.printerCode)).toEqual([
      DEFAULT_DATAMAX_PRINTER_CODE,
      DEFAULT_DATAMAX_PRINTER_CODE,
      DEFAULT_DATAMAX_PRINTER_CODE,
    ]);
    expect(request.scenarios.map((scenario) => scenario.label)).toEqual([
      'physical-001-1',
      'physical-001-2',
      'physical-001-3',
    ]);
  });

  it('does not zero-pad or accept non-numeric values', () => {
    expect(() =>
      buildValidationBatchRequest(
        {
          confirm: true,
          batchId: 'physical-002',
          values: ['00000042', '7', '12345678'],
          printerCode: DEFAULT_DATAMAX_PRINTER_CODE,
          templateCode: DEFAULT_DATAMAX_TEMPLATE_CODE,
          paperProfileId: DEFAULT_DATAMAX_PAPER_PROFILE_ID,
        },
        config,
      ),
    ).not.toThrow();

    expect(() =>
      buildValidationBatchRequest(
        {
          confirm: true,
          batchId: 'physical-003',
          values: ['12A4', '7', '12345678'],
          printerCode: DEFAULT_DATAMAX_PRINTER_CODE,
          templateCode: DEFAULT_DATAMAX_TEMPLATE_CODE,
          paperProfileId: DEFAULT_DATAMAX_PAPER_PROFILE_ID,
        },
        config,
      ),
    ).toThrow(/digits only/);
  });
});

describe('PrintOps API authentication boundary', () => {
  it('uses X-Api-Key for printer reads and never includes it in the result', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key');
      return new Response(
        JSON.stringify({
          printers: [
            {
              id: 'printer-1',
              code: DEFAULT_DATAMAX_PRINTER_CODE,
              name: 'Datamax',
              location: null,
              protocol: 'windows_spooler',
              isActive: true,
              allowedTemplates: [],
              maxCopiesPerJob: 1,
              apiKey: 'must-not-leak',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new PrintOpsApiClient(
      {
        apiUrl: 'http://127.0.0.1:31415',
        apiKey: 'test-key',
        host: '127.0.0.1',
        port: 31888,
        datamaxPrinterCode: DEFAULT_DATAMAX_PRINTER_CODE,
        datamaxTemplateCode: DEFAULT_DATAMAX_TEMPLATE_CODE,
        datamaxPaperProfileId: DEFAULT_DATAMAX_PAPER_PROFILE_ID,
      },
      fetchMock,
    );

    const printers = await client.listPrinters();
    expect(printers).toEqual([
      {
        id: 'printer-1',
        code: DEFAULT_DATAMAX_PRINTER_CODE,
        name: 'Datamax',
        location: null,
        protocol: 'windows_spooler',
        isActive: true,
        allowedTemplates: [],
        maxCopiesPerJob: 1,
      },
    ]);
    expect(JSON.stringify(printers)).not.toContain('must-not-leak');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
