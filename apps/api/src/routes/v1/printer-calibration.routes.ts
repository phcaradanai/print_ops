import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  AuditRepositoryPort,
  AuditAction,
  PaperProfile,
  PaperProfileRepositoryPort,
  PrinterPaperCalibrationRepositoryPort,
  PrinterRepositoryPort,
} from '@printerops/domain';
import { resolvePaperProfileGeometry, snapshotPaperProfileGeometry } from '@printerops/domain';
import { actor, requirePermission } from './permission-guard.js';
import type { CreatePrintJobService } from '../../services/create-print-job.service.js';
import type { ExecuteJobService } from '../../services/execute-job.service.js';

type RouteDeps = {
  calibrations: PrinterPaperCalibrationRepositoryPort;
  printers: PrinterRepositoryPort;
  papers: PaperProfileRepositoryPort;
  audit: AuditRepositoryPort;
  createJob?: CreatePrintJobService;
  executeJob?: ExecuteJobService;
};

function recordBody(request: FastifyRequest): Record<string, unknown> {
  return request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

function requiredId(value: unknown, field: string): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integerOffset(value: unknown, field: string): string | undefined {
  if (!Number.isInteger(value) || Math.abs(value as number) > 10000) {
    return field + ' must be a signed whole number from -10000 to 10000';
  }
  return undefined;
}

async function resolvePrinter(
  body: Record<string, unknown>,
  printers: PrinterRepositoryPort,
): Promise<import('@printerops/domain').Printer | undefined> {
  const id = requiredId(body['printerId'], 'printerId');
  const code = requiredId(body['printerCode'], 'printerCode');
  return id ? printers.findById(id) : code ? printers.findByCode(code) : undefined;
}

async function resolvePaper(
  body: Record<string, unknown>,
  papers: PaperProfileRepositoryPort,
): Promise<PaperProfile | undefined> {
  const id = requiredId(body['paperProfileId'], 'paperProfileId');
  return id ? papers.findById(id) : undefined;
}

function calibrationPattern(profile: PaperProfile): string {
  const geometry = resolvePaperProfileGeometry(profile);
  const pageHeightMm = Math.max(
    profile.heightMm,
    geometry.layout.rowPitchMm + profile.marginTopMm + profile.marginBottomMm,
  );
  const cells = geometry.cells.map((cell) => {
    const label = 'C' + (cell.column + 1);
    return '<div data-printops-calibration-cell="' + label + '" style="' +
      'position:absolute;left:' + cell.xMm + 'mm;top:' + profile.marginTopMm + 'mm;' +
      'width:' + geometry.layout.cellWidthMm + 'mm;height:' + geometry.layout.cellHeightMm + 'mm;' +
      'border:0.2mm solid #000;box-sizing:border-box;overflow:hidden;">' +
      '<div style="font:1.5mm Arial,sans-serif;text-align:center;line-height:3mm;">' + label + '</div>' +
      '<div style="position:absolute;left:50%;top:3mm;width:0.3mm;height:calc(100% - 3mm);background:#000;"></div>' +
      '<div style="position:absolute;left:0;top:50%;width:100%;height:0.3mm;background:#000;"></div>' +
      '</div>';
  }).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@page{margin:0;}html,body{margin:0;padding:0;overflow:hidden;}' +
    '</style></head><body><div data-printops-calibration-pattern="true" style="' +
    'position:relative;width:' + profile.widthMm + 'mm;height:' + pageHeightMm + 'mm;' +
    'margin:0;padding:0;overflow:hidden;box-sizing:border-box;">' + cells + '</div></body></html>';
}

async function audit(
  deps: RouteDeps,
  request: FastifyRequest,
  action: AuditAction,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await deps.audit.create({
    traceId: 'calibration',
    action,
    actorId: actor(request),
    resourceType: 'printer_calibration',
    resourceId,
    metadata,
  });
}

export async function printerCalibrationRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get(
    '/printer-calibrations',
    { onRequest: [requirePermission('paper-profile:read')] },
    async (request) => {
      const query = request.query as {
        printerId?: string;
        paperProfileId?: string;
        dpi?: string;
      };
      const calibrations = await deps.calibrations.findAll({
        printerId: requiredId(query.printerId, 'printerId'),
        paperProfileId: requiredId(query.paperProfileId, 'paperProfileId'),
      });
      if (query.dpi === undefined) return calibrations;
      const dpi = Number(query.dpi);
      if (!Number.isInteger(dpi) || dpi <= 0) return [];
      return calibrations.filter((value) => value.dpi === dpi);
    },
  );

  app.get(
    '/printer-calibrations/:id',
    { onRequest: [requirePermission('paper-profile:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const calibration = await deps.calibrations.findById(id);
      if (!calibration) return reply.status(404).send({ error: 'Printer calibration not found' });
      return calibration;
    },
  );

  app.post(
    '/printer-calibrations',
    { onRequest: [requirePermission('printer:update')] },
    async (request, reply) => {
      const body = recordBody(request);
      const printerId = requiredId(body['printerId'], 'printerId');
      const paperProfileId = requiredId(body['paperProfileId'], 'paperProfileId');
      const dpi = body['dpi'];
      const xOffsetDots = body['xOffsetDots'];
      const yOffsetDots = body['yOffsetDots'];
      if (!printerId || !paperProfileId || !Number.isInteger(dpi) || (dpi as number) <= 0) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'printerId, paperProfileId, and positive integer dpi are required',
        });
      }
      const xIssue = integerOffset(xOffsetDots, 'xOffsetDots');
      const yIssue = integerOffset(yOffsetDots, 'yOffsetDots');
      if (xIssue || yIssue) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: xIssue ?? yIssue });
      }
      const printer = await deps.printers.findById(printerId);
      if (!printer) return reply.status(404).send({ error: 'Printer not found' });
      const paper = await deps.papers.findById(paperProfileId);
      if (!paper) return reply.status(404).send({ error: 'Paper profile not found' });
      if (paper.dpi !== dpi) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'dpi must match the selected paper profile DPI (' + paper.dpi + ')',
        });
      }
      const existing = await deps.calibrations.findByKey(printer.id, paper.id, dpi as number);
      if (existing) {
        return reply.status(409).send({
          error: 'CALIBRATION_EXISTS',
          message: 'A calibration already exists for this printer, paper profile, and DPI',
          calibration: existing,
        });
      }
      try {
        const created = await deps.calibrations.create({
          printerId: printer.id,
          paperProfileId: paper.id,
          dpi: dpi as number,
          xOffsetDots: xOffsetDots as number,
          yOffsetDots: yOffsetDots as number,
        });
        await audit(deps, request, 'printer_calibration.created', created.id, {
          printerId: printer.id,
          paperProfileId: paper.id,
          dpi,
          xOffsetDots,
          yOffsetDots,
        });
        return reply.status(201).send(created);
      } catch (error) {
        return reply.status(409).send({
          error: 'CALIBRATION_EXISTS',
          message: error instanceof Error ? error.message : 'Calibration could not be created',
        });
      }
    },
  );

  app.put(
    '/printer-calibrations/:id',
    { onRequest: [requirePermission('printer:update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const current = await deps.calibrations.findById(id);
      if (!current) return reply.status(404).send({ error: 'Printer calibration not found' });
      const body = recordBody(request);
      if ('printerId' in body || 'paperProfileId' in body || 'dpi' in body) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'printerId, paperProfileId, and dpi are immutable calibration key fields',
        });
      }
      const xOffsetDots = body['xOffsetDots'];
      const yOffsetDots = body['yOffsetDots'];
      const xIssue = integerOffset(xOffsetDots, 'xOffsetDots');
      const yIssue = integerOffset(yOffsetDots, 'yOffsetDots');
      if (xIssue || yIssue) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: xIssue ?? yIssue });
      }
      const updated = await deps.calibrations.update(id, {
        xOffsetDots: xOffsetDots as number,
        yOffsetDots: yOffsetDots as number,
      });
      await audit(deps, request, 'printer_calibration.updated', id, {
        xOffsetDots,
        yOffsetDots,
      });
      return updated;
    },
  );

  app.delete(
    '/printer-calibrations/:id',
    { onRequest: [requirePermission('printer:update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const current = await deps.calibrations.findById(id);
      if (!current) return reply.status(404).send({ error: 'Printer calibration not found' });
      await deps.calibrations.delete(id);
      await audit(deps, request, 'printer_calibration.deleted', id, {
        printerId: current.printerId,
        paperProfileId: current.paperProfileId,
        dpi: current.dpi,
      });
      return { deleted: true, id };
    },
  );

  app.post(
    '/printer-calibrations/test-print',
    { onRequest: [requirePermission('sandbox:send-test-print')] },
    async (request, reply) => {
      if (!deps.createJob || !deps.executeJob) {
        return reply.status(503).send({
          error: 'CALIBRATION_TEST_UNAVAILABLE',
          message: 'The in-process print executor is not configured',
        });
      }
      const body = recordBody(request);
      const printer = await resolvePrinter(body, deps.printers);
      if (!printer) return reply.status(404).send({ error: 'Printer not found' });
      const paper = await resolvePaper(body, deps.papers);
      if (!paper) return reply.status(404).send({ error: 'Paper profile not found' });
      const geometry = resolvePaperProfileGeometry(paper);
      const pageHeightMm = Math.max(
        paper.heightMm,
        geometry.layout.rowPitchMm + paper.marginTopMm + paper.marginBottomMm,
      );
      const job = await deps.createJob.execute({
        printerId: '',
        printerCode: printer.code,
        paperProfileId: paper.id,
        renderedPrintPayload: calibrationPattern(paper),
        createdBy: actor(request),
        mimeType: 'text/html',
        copies: 1,
        duplex: false,
        colorMode: 'monochrome',
        metadata: {
          calibrationPattern: true,
          pageHeightMm,
          paperProfile: {
            paperProfileId: paper.id,
            widthMm: paper.widthMm,
            heightMm: paper.heightMm,
            gapMm: paper.gapMm ?? 0,
            marginTopMm: paper.marginTopMm,
            marginRightMm: paper.marginRightMm,
            marginBottomMm: paper.marginBottomMm,
            marginLeftMm: paper.marginLeftMm,
            orientation: paper.orientation,
            dpi: paper.dpi,
            geometry: snapshotPaperProfileGeometry(paper),
          },
        },
      }, actor(request));
      const executed = await deps.executeJob.execute(job.id, actor(request));
      await audit(deps, request, 'printer_calibration.test_print', job.id, {
        printerId: printer.id,
        paperProfileId: paper.id,
        status: executed.status,
      });
      return reply.status(201).send({
        jobId: executed.id,
        status: executed.status,
        printerCode: printer.code,
        paperProfileId: paper.id,
      });
    },
  );
}
