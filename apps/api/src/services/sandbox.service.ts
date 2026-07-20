import type {
  PrintTemplateRepositoryPort,
  PaperProfileRepositoryPort,
  TemplateRendererPort,
  SandboxRunResult,
  SandboxRunInput,
  SandboxBatchResult,
  PrinterRepositoryPort,
  PrintTemplate,
  PaperProfile,
} from '@printerops/domain';
import { generateId, NotFoundError, ValidationError } from '@printerops/shared';
import { CreatePrintJobService } from './create-print-job.service.js';

/** Extracts all {{field}} placeholders from template content. */
function extractTemplateFields(template: PrintTemplate): string[] {
  const pattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  const fields: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template.content)) !== null) {
    if (match[1]) fields.push(match[1]);
  }
  return [...new Set(fields)];
}

/** Resolve a dotted field path from a payload (e.g. "patient.name"). */
function valueAt(payload: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, payload);
}

export class SandboxService {
  constructor(
    private templates: PrintTemplateRepositoryPort,
    private papers: PaperProfileRepositoryPort,
    private renderer: TemplateRendererPort,
    /** Optional — only needed when sending real test prints */
    private createJob?: CreatePrintJobService,
  ) {}

  /** Run a single sandbox rehearsal against a template. */
  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const t0 = Date.now();

    const template = await this.templates.findByCode(input.templateCode);
    if (!template) throw new NotFoundError('PrintTemplate', input.templateCode);

    const paper = await this.resolvePaper(template, input.paperProfileId);

    // Validate template structure
    const validation = await this.renderer.validateTemplate(template);

    // Compile and render
    await this.renderer.compileTemplate(template);
    const rendered = await this.renderer.renderPrintPayload(
      template,
      input.samplePayload,
      paper,
    );

    const preview = await this.renderer.renderPreview(
      template,
      input.samplePayload,
      paper,
    );

    // Field analysis
    const templateFields = extractTemplateFields(template);
    const resolvedFields = templateFields.filter(
      (f) => valueAt(input.samplePayload, f) != null,
    );
    const missingFields = templateFields.filter(
      (f) => valueAt(input.samplePayload, f) == null,
    );

    const renderTimeMs = Date.now() - t0;
    const runId = generateId();

    let testJobId: string | undefined;
    let testPrintSuccess: boolean | undefined;

    if (input.testPrint) {
      try {
        if (!this.createJob) {
          throw new Error('CreatePrintJobService not provided for test-print');
        }
        const job = await this.createJob.execute(
          {
            printerId: '',
            printerCode: input.testPrint.printerCode,
            templateCode: template.templateCode,
            resolvedTemplateCode: template.templateCode,
            paperProfileId: paper.id,
            renderedPrintPayload: rendered.renderedPrintPayload,
            createdBy: 'sandbox',
            mimeType: 'text/plain',
            copies: 1,
            duplex: false,
            colorMode: 'auto',
            metadata: { sandbox: true, runId },
          },
          'sandbox',
        );
        testJobId = job.id;
        testPrintSuccess = job.status === 'QUEUED' || job.status === 'SUCCESS';
      } catch (err) {
        testPrintSuccess = false;
      }
    }

    return {
      runId,
      templateCode: template.templateCode,
      paperProfileId: paper.id,
      samplePayload: input.samplePayload,
      renderedPayload: rendered.renderedPrintPayload,
      renderedPreview: preview.renderedPreview,
      warnings: [...validation.warnings, ...rendered.warnings],
      allFieldsResolved: missingFields.length === 0,
      missingFields,
      resolvedFields,
      templateValid: validation.valid,
      templateWarnings: validation.warnings,
      renderTimeMs,
      performedAt: new Date(),
      testJobId,
      testPrintSuccess,
    };
  }

  /** Run a batch of scenarios against the same template. */
  async runBatch(
    templateCode: string,
    scenarios: Array<{
      label?: string;
      samplePayload: Record<string, unknown>;
      testPrint?: { printerCode: string };
    }>,
    paperProfileId?: string,
  ): Promise<SandboxBatchResult> {
    if (!scenarios.length) throw new ValidationError('at least one scenario required');
    if (scenarios.length > 50) throw new ValidationError('max 50 scenarios per batch');

    const batchId = generateId();
    const runs: SandboxRunResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.run({
        templateCode,
        paperProfileId,
        samplePayload: scenario.samplePayload,
        testPrint: scenario.testPrint,
      });
      runs.push(result);
    }

    const passed = runs.filter((r) => r.allFieldsResolved && r.templateValid);
    const failed = runs.filter((r) => !r.allFieldsResolved || !r.templateValid);
    const totalRenderTimeMs = runs.reduce((sum, r) => sum + r.renderTimeMs, 0);

    return {
      batchId,
      templateCode,
      runs,
      summary: {
        total: runs.length,
        passed: passed.length,
        failed: failed.length,
        totalRenderTimeMs,
      },
      performedAt: new Date(),
    };
  }

  private async resolvePaper(
    template: PrintTemplate,
    paperProfileId?: string,
  ): Promise<PaperProfile> {
    const paperId = paperProfileId ?? template.paperProfileId;
    if (!paperId) throw new ValidationError('paperProfileId is required');
    const paper = await this.papers.findById(paperId);
    if (!paper) throw new NotFoundError('PaperProfile', paperId);
    return paper;
  }
}
