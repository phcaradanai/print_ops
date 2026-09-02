import type {
  PrintTemplateRepositoryPort,
  PaperProfileRepositoryPort,
  TemplateRendererPort,
  SandboxRunResult,
  SandboxRunInput,
  SandboxBatchResult,
  PrintTemplate,
  PaperProfile,
  JobStatus,
} from '@printerops/domain';
import { paperProfileForCell, resolvePaperProfileGeometry, snapshotPaperProfileGeometry } from '@printerops/domain';
import { generateId, NotFoundError, ValidationError } from '@printerops/shared';
import { composeDatamaxDplRows } from '../infra/template/datamax-dpl-renderer.js';
import { CreatePrintJobService } from './create-print-job.service.js';
import type { ExecuteJobService } from './execute-job.service.js';

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

function composeMultipageHtml(renderedPages: string[], paper: PaperProfile): string {
  const printableWidthMm = Math.max(
    0.1,
    paper.widthMm - paper.marginLeftMm - paper.marginRightMm,
  );
  const printableHeightMm = Math.max(
    0.1,
    paper.heightMm - paper.marginTopMm - paper.marginBottomMm,
  );

  return renderedPages.map((renderedPage, index) => {
    const breakStyle = index < renderedPages.length - 1
      ? 'break-after:page;page-break-after:always;'
      : '';
    return '<section data-printops-page="' + (index + 1) + '" style="position:relative;display:block;width:' + printableWidthMm + 'mm;height:' + printableHeightMm + 'mm;margin:0;padding:0;overflow:hidden;box-sizing:border-box;break-inside:avoid;page-break-inside:avoid;' + breakStyle + '">' + renderedPage + '</section>';
  }).join('');
}

export class SandboxService {
  constructor(
    private templates: PrintTemplateRepositoryPort,
    private papers: PaperProfileRepositoryPort,
    private renderer: TemplateRendererPort,
    /** Optional — only needed when sending real test prints */
    private createJob?: CreatePrintJobService,
    /** Execute job synchronously for real test-print results */
    private executeJob?: ExecuteJobService,
  ) {}

  /** Run a single sandbox rehearsal against a template. */
  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const t0 = Date.now();

    const template = await this.templates.findByCode(input.templateCode);
    if (!template) throw new NotFoundError('PrintTemplate', input.templateCode);

    const paper = await this.resolvePaper(template, input.paperProfileId);
    const renderPaper = paperProfileForCell(paper);

    // Validate template structure
    const validation = await this.renderer.validateTemplate(template);

    // Compile and render
    await this.renderer.compileTemplate(template);
    const rendered = await this.renderer.renderPrintPayload(
      template,
      input.samplePayload,
      renderPaper,
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
    let testPrintStatus: JobStatus | undefined;
    let testPrintError: string | undefined;

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
            mimeType:
              template.engine === 'HTML' ? 'text/html' :
              template.engine === 'RAW_TEXT' ? 'text/plain' :
              template.engine === 'PDF_LIKE_PREVIEW' ? 'application/pdf' :
              `application/${template.engine.toLowerCase()}`,
            copies: 1,
            duplex: false,
            colorMode: 'auto',
            metadata: {
              sandbox: true,
              runId,
              paperProfile: {
                paperProfileId: paper.id,
                widthMm: paper.widthMm,
                gapMm: paper.gapMm ?? 0,
                heightMm: paper.heightMm,
                marginTopMm: paper.marginTopMm,
                marginRightMm: paper.marginRightMm,
                marginBottomMm: paper.marginBottomMm,
                marginLeftMm: paper.marginLeftMm,
                orientation: paper.orientation,
                dpi: paper.dpi,
                geometry: snapshotPaperProfileGeometry(paper),
              },
            },
          },
          'sandbox',
        );
        testJobId = job.id;

        // Execute the job synchronously through the real printer adapter
        // instead of just checking QUEUED status
        if (this.executeJob) {
          const executedJob = await this.executeJob.execute(job.id, 'sandbox');
          testPrintStatus = executedJob.status;
          testPrintSuccess = executedJob.status === 'SUCCESS';
          testPrintError = executedJob.errorMessage;
        } else {
          // Fallback: no executor available, can only check queue status
          testPrintStatus = job.status;
          testPrintSuccess = false;
          testPrintError = 'Runner not available — job queued but not executed';
        }
      } catch (err) {
        testPrintSuccess = false;
        testPrintError = err instanceof Error ? err.message : String(err);
        testPrintStatus = 'FAILED';
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
      testPrintStatus,
      testPrintError,
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
    const template = await this.templates.findByCode(templateCode);
    if (!template) throw new NotFoundError('PrintTemplate', templateCode);
    const requestedPrinters = scenarios.map((scenario) => scenario.testPrint?.printerCode);
    const consolidatedPrinterCode = requestedPrinters[0];
    const consolidateTestPrint =
      (template.engine === 'HTML' || template.engine === 'DPL') &&
      consolidatedPrinterCode != null &&
      requestedPrinters.every((printerCode) => printerCode === consolidatedPrinterCode);

    for (const scenario of scenarios) {
      const result = await this.run({
        templateCode,
        paperProfileId,
        samplePayload: scenario.samplePayload,
        testPrint: consolidateTestPrint ? undefined : scenario.testPrint,
      });
      runs.push(result);
    }

    const passed = runs.filter((r) => r.allFieldsResolved && r.templateValid);
    const failed = runs.filter((r) => !r.allFieldsResolved || !r.templateValid);
    const totalRenderTimeMs = runs.reduce((sum, r) => sum + r.renderTimeMs, 0);

    // A same-printer HTML batch must be one spool document. Submitting every
    // scenario as an independent Windows job makes a label driver re-acquire
    // top-of-form between jobs and can consume a blank label between run
    // numbers. One paginated document keeps 000001..00000N on adjacent stock.
    if (consolidateTestPrint) {
      try {
        if (!this.createJob) {
          throw new Error('CreatePrintJobService not provided for test-print');
        }
        const paper = await this.resolvePaper(template, paperProfileId);
        const geometry = resolvePaperProfileGeometry(paper);
        const pageHeightMm = geometry.layout.columns > 1
          ? Math.max(paper.heightMm, geometry.layout.rowPitchMm + paper.marginTopMm + paper.marginBottomMm)
          : paper.heightMm;
        const nativeDpl = template.engine === 'DPL';
        const renderedPrintPayload = nativeDpl
          ? composeDatamaxDplRows(runs.map((run) => run.renderedPayload), paper)
          : geometry.layout.columns > 1
            ? composeGridHtml(runs.map((run) => run.renderedPayload), paper)
            : composeMultipageHtml(runs.map((run) => run.renderedPayload), paper);
        const job = await this.createJob.execute(
          {
            printerId: '',
            printerCode: consolidatedPrinterCode,
            templateCode: template.templateCode,
            resolvedTemplateCode: template.templateCode,
            paperProfileId: paper.id,
            renderedPrintPayload,
            createdBy: 'sandbox',
            mimeType: nativeDpl ? 'application/dpl' : 'text/html',
            copies: 1,
            duplex: false,
            colorMode: 'auto',
            metadata: {
              sandbox: true,
              batchId,
              runIds: runs.map((run) => run.runId),
              itemCount: runs.length,
              pageHeightMm,
              pageCount: geometry.layout.columns > 1 ? Math.ceil(runs.length / geometry.layout.columns) : runs.length,
              paperProfile: {
                paperProfileId: paper.id,
                widthMm: paper.widthMm,
                gapMm: paper.gapMm ?? 0,
                heightMm: paper.heightMm,
                marginTopMm: paper.marginTopMm,
                marginRightMm: paper.marginRightMm,
                marginBottomMm: paper.marginBottomMm,
                marginLeftMm: paper.marginLeftMm,
                orientation: paper.orientation,
                dpi: paper.dpi,
                geometry: snapshotPaperProfileGeometry(paper),
              },
            },
          },
          'sandbox',
        );

        const executedJob = this.executeJob
          ? await this.executeJob.execute(job.id, 'sandbox')
          : job;
        const status = executedJob.status;
        const success = this.executeJob != null && status === 'SUCCESS';
        const error = this.executeJob
          ? executedJob.errorMessage
          : 'Runner not available - job queued but not executed';
        for (const run of runs) {
          run.testJobId = job.id;
          run.testPrintStatus = status;
          run.testPrintSuccess = success;
          run.testPrintError = error;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const run of runs) {
          run.testPrintSuccess = false;
          run.testPrintStatus = 'FAILED';
          run.testPrintError = message;
        }
      }
    }

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

/** Place one rendered template instance in each physical cell of a row. */
function composeGridHtml(renderedPages: string[], paper: PaperProfile): string {
  const geometry = resolvePaperProfileGeometry(paper);
  const columns = geometry.layout.columns;
  if (columns <= 1) return composeMultipageHtml(renderedPages, paper);
  const pageHeightMm = Math.max(
    paper.heightMm,
    geometry.layout.rowPitchMm + paper.marginTopMm + paper.marginBottomMm,
  );
  const rowCount = Math.ceil(renderedPages.length / columns);

  return Array.from({ length: rowCount }, (_, row) => {
    const rowPages = renderedPages.slice(row * columns, (row + 1) * columns);
    const cells = rowPages.map((renderedPage, column) => {
      const cell = geometry.cells[column]!;
      const style = [
        'position:absolute',
        `left:${cell.xMm}mm`,
        `top:${paper.marginTopMm}mm`,
        `width:${geometry.layout.cellWidthMm}mm`,
        `height:${geometry.layout.cellHeightMm}mm`,
        'overflow:hidden',
        'box-sizing:border-box',
        'break-inside:avoid',
        'page-break-inside:avoid',
      ].join(';') + ';';
      return `<div data-printops-cell-column="${column + 1}" style="${style}">${renderedPage}</div>`;
    });
    const breakStyle = row < rowCount - 1
      ? 'break-after:page;page-break-after:always;'
      : '';
    return `<section data-printops-row="${row + 1}" style="position:relative;display:block;width:${paper.widthMm}mm;height:${pageHeightMm}mm;margin:0;padding:0;overflow:hidden;box-sizing:border-box;break-inside:avoid;page-break-inside:avoid;${breakStyle}">${cells.join('')}</section>`;
  }).join('');
}
