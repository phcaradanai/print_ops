import { describe, expect, it } from 'vitest';
import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { InMemoryPrintTemplateRepository } from '../infra/repos/in-memory-template.repo.js';
import { InMemoryPaperProfileRepository } from '../infra/repos/in-memory-paper-profile.repo.js';
import { InMemoryPrinterPaperCalibrationRepository } from '../infra/repos/in-memory-printer-paper-calibration.repo.js';
import { SimpleTemplateRenderer } from '../infra/template/simple-template-renderer.js';
import { AcceptExternalJobService } from '../services/accept-external-job.service.js';

// Regression: rendered-template jobs (POST /api/v1/print-jobs with a template)
// never looked up the saved printer calibration, so offsets had no effect.
describe('rendered template jobs carry the saved printer calibration', () => {
  it('snapshots the printer/profile/DPI calibration onto the job', async () => {
    const printers = new InMemoryPrinterRepository();
    const jobs = new InMemoryJobRepository();
    const templates = new InMemoryPrintTemplateRepository();
    const papers = new InMemoryPaperProfileRepository();
    const calibrations = new InMemoryPrinterPaperCalibrationRepository();
    const printer = await printers.create({
      code: 'P1', name: 'Label', protocol: 'fake', connectionUri: 'fake://p1',
      isActive: true, allowedTemplates: [], maxCopiesPerJob: 5, metadata: {},
    });
    const paper = await papers.create({
      code: 'L1', name: 'Label', widthMm: 60, heightMm: 50,
      marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
      dpi: 203, orientation: 'landscape', unit: 'mm',
    });
    await templates.create({
      templateCode: 'T1', name: 'T1', engine: 'HTML', content: '<div>{{name}}</div>',
      paperProfileId: paper.id, status: 'PUBLISHED', createdBy: 'test',
    });
    await calibrations.create({ printerId: printer.id, paperProfileId: paper.id, dpi: 203, xOffsetDots: -12, yOffsetDots: 8 });

    const service = new AcceptExternalJobService(
      jobs, printers, new InMemoryJobQueue(), new InMemoryTraceRepository(),
      new InMemoryAuditRepository(), new InMemoryEventBus(),
      templates, papers, new SimpleTemplateRenderer(), undefined, undefined, calibrations,
    );
    const result = await service.execute({
      request_id: 'r1', source_system: 'his', printer_code: 'P1', template_code: 'T1',
      payload: { name: 'x' },
    } as Parameters<typeof service.execute>[0], 'test');

    const job = await jobs.findById(result.print_job_id);
    expect(job?.metadata?.['printerCalibration']).toMatchObject({
      printerId: printer.id, paperProfileId: paper.id, dpi: 203, xOffsetDots: -12, yOffsetDots: 8,
    });
  });
});
