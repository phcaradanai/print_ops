import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { PrintOpsMcpConfig } from './config.js';
import {
  type PrinterSummary,
  type PrintOpsApiClient,
  type SandboxBatchRequest,
} from './printops-client.js';

export const DEFAULT_VALIDATION_VALUES = ['12345678', '1234', '1234567890'] as const;

export interface PrintOpsToolClient {
  listPrinters(): Promise<PrinterSummary[]>;
  getPrinterStatus(printerId: string): Promise<unknown>;
  getPrintJob(jobId: string): Promise<unknown>;
  runSandboxBatch(request: SandboxBatchRequest): Promise<unknown>;
}

const barcodeValue = z
  .string()
  .trim()
  .min(1, 'barcode value cannot be empty')
  .max(240, 'barcode value cannot exceed 240 characters')
  .regex(/^\d+$/, 'barcode value must contain digits only');

const idValue = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'id contains unsupported characters');

const batchIdValue = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'batchId contains unsupported characters');

const listPrintersOutput = {
  printers: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      location: z.string().nullable(),
      protocol: z.string(),
      isActive: z.boolean(),
      allowedTemplates: z.array(z.string()),
      maxCopiesPerJob: z.number().nullable(),
    }),
  ),
};

const recordValue = z.record(z.string(), z.unknown());

const readResult = {
  id: z.string(),
  result: recordValue,
};

const validationInput = {
  confirm: z
    .literal(true)
    .describe('Must be true. This tool submits a real physical print job.'),
  batchId: batchIdValue.describe('Unique operator-supplied id for this physical test batch.'),
  values: z
    .array(barcodeValue)
    .length(3, 'provide exactly three values so the test occupies one 3-up row')
    .default([...DEFAULT_VALIDATION_VALUES])
    .describe(
      'Three numeric barcode values for one row. Keep the 8-character value as the baseline; shorter and longer values are allowed.',
    ),
  printerCode: z.string().trim().min(1).default('DATAMAXONEIL_I4208'),
  templateCode: z.string().trim().min(1).default('DMX_I4208_3UP_NATIVE_DPL_20260902'),
  paperProfileId: z
    .string()
    .trim()
    .min(1)
    .default('e6f3d58b-04db-4e21-b1c7-91182072ca4b'),
};

const validationOutput = {
  batchId: z.string(),
  accepted: z.boolean(),
  printerCode: z.string(),
  templateCode: z.string(),
  paperProfileId: z.string(),
  values: z.array(z.string()),
  pageCount: z.number().int().nonnegative(),
  jobIds: z.array(z.string()),
};

type ValidationInput = {
  confirm: true;
  batchId: string;
  values: string[];
  printerCode: string;
  templateCode: string;
  paperProfileId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function collectJobIds(value: unknown, ids = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectJobIds(item, ids);
    return [...ids];
  }
  if (!isRecord(value)) return [...ids];

  for (const key of ['id', 'jobId', 'job_id']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) ids.add(candidate);
  }
  for (const key of ['job', 'jobs', 'result', 'data', 'runs']) {
    collectJobIds(value[key], ids);
  }
  return [...ids];
}

function numericField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0
    ? candidate
    : undefined;
}

function resultError(error: unknown): {
  isError: true;
  content: [{ type: 'text'; text: string }];
} {
  const raw = error instanceof Error ? error.message : 'PrintOps operation failed';
  const safe = raw
    .replace(/(x-api-key|api[_-]?key|authorization|bearer)\s*[:=]?\s*\S+/gi, '$1=[redacted]')
    .slice(0, 800);
  return {
    isError: true,
    content: [{ type: 'text', text: safe }],
  };
}

export function buildValidationBatchRequest(
  input: ValidationInput,
  config: Pick<
    PrintOpsMcpConfig,
    'datamaxPrinterCode' | 'datamaxTemplateCode' | 'datamaxPaperProfileId'
  >,
): SandboxBatchRequest {
  if (input.confirm !== true) {
    throw new Error('confirm must be true before a physical print batch can be submitted');
  }
  if (input.printerCode !== config.datamaxPrinterCode) {
    throw new Error(`Only the configured Datamax printer is allowed: ${config.datamaxPrinterCode}`);
  }
  if (input.templateCode !== config.datamaxTemplateCode) {
    throw new Error(`Only the configured Datamax template is allowed: ${config.datamaxTemplateCode}`);
  }
  if (input.paperProfileId !== config.datamaxPaperProfileId) {
    throw new Error(
      `Only the configured Datamax paper profile is allowed: ${config.datamaxPaperProfileId}`,
    );
  }
  if (input.values.length !== 3) {
    throw new Error('exactly three barcode values are required for one 3-up row');
  }

  const values = input.values.map((value) => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error('barcode values must contain digits only and are never zero-padded');
    }
    return normalized;
  });

  return {
    templateCode: input.templateCode,
    paperProfileId: input.paperProfileId,
    scenarios: values.map((value, index) => ({
      label: `${input.batchId}-${index + 1}`,
      samplePayload: { barcode: value },
      testPrint: { printerCode: input.printerCode },
    })),
  };
}

export function registerPrintOpsTools(
  server: McpServer,
  client: PrintOpsToolClient | PrintOpsApiClient,
  config: PrintOpsMcpConfig,
): void {
  server.registerTool(
    'list_printers',
    {
      title: 'List PrintOps printers',
      description:
        'Use this to inspect active PrintOps printers before selecting a device. Read-only; it does not print.',
      inputSchema: {},
      outputSchema: listPrintersOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const printers = await client.listPrinters();
        return {
          structuredContent: { printers },
          content: [{ type: 'text', text: `Found ${printers.length} active printer records.` }],
        };
      } catch (error) {
        return resultError(error);
      }
    },
  );

  server.registerTool(
    'get_printer_status',
    {
      title: 'Get printer status',
      description: 'Use this to check one printer status before a print action. Read-only.',
      inputSchema: { printerId: idValue },
      outputSchema: readResult,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ printerId }) => {
      try {
        const result = asRecord(await client.getPrinterStatus(printerId));
        return {
          structuredContent: { id: printerId, result },
          content: [{ type: 'text', text: `Status read for printer ${printerId}.` }],
        };
      } catch (error) {
        return resultError(error);
      }
    },
  );

  server.registerTool(
    'get_print_job',
    {
      title: 'Get PrintOps print job',
      description: 'Use this to inspect the current state of an existing PrintOps job. Read-only.',
      inputSchema: { jobId: idValue },
      outputSchema: readResult,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ jobId }) => {
      try {
        const result = asRecord(await client.getPrintJob(jobId));
        return {
          structuredContent: { id: jobId, result },
          content: [{ type: 'text', text: `Read print job ${jobId}.` }],
        };
      } catch (error) {
        return resultError(error);
      }
    },
  );

  server.registerTool(
    'run_datamax_validation_batch',
    {
      title: 'Run Datamax I-4208 validation batch',
      description:
        'Use only when the operator explicitly wants a real Datamax-O’Neil I-4208 test print. Requires confirm=true, exactly three numeric values, and submits one consolidated 3-up row through the authenticated PrintOps sandbox. Values remain dynamic: do not zero-pad them. The default set contains an 8-character baseline plus shorter and longer values.',
      inputSchema: validationInput,
      outputSchema: validationOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false,
      },
    },
    async (input) => {
      try {
        const request = buildValidationBatchRequest(input, config);
        const apiResult = await client.runSandboxBatch(request);
        const pageCount = numericField(apiResult, 'pageCount') ?? 1;
        const jobIds = collectJobIds(apiResult);
        const result = {
          batchId: input.batchId,
          accepted: true,
          printerCode: input.printerCode,
          templateCode: input.templateCode,
          paperProfileId: input.paperProfileId,
          values: request.scenarios.map((scenario) => scenario.samplePayload.barcode),
          pageCount,
          jobIds,
        };
        return {
          structuredContent: result,
          content: [
            {
              type: 'text',
              text: `Submitted Datamax validation batch ${input.batchId} as ${pageCount} physical row(s).`,
            },
          ],
        };
      } catch (error) {
        return resultError(error);
      }
    },
  );
}
