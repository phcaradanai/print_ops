import type { JobStatus } from './job.js';

/** Result of a single sandbox (template rehearsal) run. */
export interface SandboxRunResult {
  /** Unique run identifier */
  runId: string;
  /** Template that was tested */
  templateCode: string;
  /** Paper profile used */
  paperProfileId: string;
  /** The sample payload that was rendered */
  samplePayload: Record<string, unknown>;
  /** Rendered output (the actual print payload) */
  renderedPayload: string;
  /** HTML preview markup for the dashboard */
  renderedPreview: string;
  /** Warnings collected during rendering */
  warnings: string[];
  /** Whether all template fields were satisfied */
  allFieldsResolved: boolean;
  /** List of template fields that were expected but missing in payload */
  missingFields: string[];
  /** List of template fields that were successfully resolved */
  resolvedFields: string[];
  /** Template validation result (script/security checks) */
  templateValid: boolean;
  /** Template validation warnings */
  templateWarnings: string[];
  /** Render time in milliseconds */
  renderTimeMs: number;
  /** When this run was performed */
  performedAt: Date;
  /** Optional job ID if a test-print was sent */
  testJobId?: string;
  /** Optional test-print result (true = printer acknowledged success) */
  testPrintSuccess?: boolean;
  /** Real job status from the printer adapter execution */
  testPrintStatus?: JobStatus;
  /** Error message if test-print failed */
  testPrintError?: string;
}

/** Input for a sandbox run */
export interface SandboxRunInput {
  /** Template code or ID to test */
  templateCode: string;
  /** Optional paper profile override (falls back to template's default) */
  paperProfileId?: string;
  /** Sample data payload to render */
  samplePayload: Record<string, unknown>;
  /** Optionally send a real test print to a printer */
  testPrint?: {
    printerCode: string;
  };
}

/** Batch sandbox result — runs multiple scenarios */
export interface SandboxBatchResult {
  batchId: string;
  templateCode: string;
  runs: SandboxRunResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    totalRenderTimeMs: number;
  };
  performedAt: Date;
}
