import type {
  JobRepositoryPort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  Job,
} from '@printerops/domain';
import { generateId, NotFoundError, ValidationError } from '@printerops/shared';
import { emitPrintJobTerminal } from './emit-terminal-event.js';

const CANCELLABLE_STATUSES = new Set(['ACCEPTED', 'VALIDATED', 'QUEUED', 'DISPATCHED']);

export class CancelJobService {
  constructor(
    private jobs: JobRepositoryPort,
    private traces: TraceRepositoryPort,
    private audit: AuditRepositoryPort,
    private events: EventBusPort
  ) {}

  async execute(jobId: string, cancelledBy: string): Promise<Job> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    if (!CANCELLABLE_STATUSES.has(job.status)) {
      throw new ValidationError(
        `Cannot cancel job in status '${job.status}'. Only ${[...CANCELLABLE_STATUSES].join(', ')} jobs can be cancelled.`
      );
    }

    const cancelledAt = new Date();
    const cancelled = await this.jobs.update(jobId, {
      status: 'CANCELLED',
      finishedAt: cancelledAt,
      completedAt: cancelledAt,
    });

    const trace = await this.traces.findByJobId(jobId);
    if (trace) {
      await this.traces.update(trace.id, {
        status: 'CANCELLED',
        finishedAt: cancelledAt,
        steps: [
          ...trace.steps,
          {
            stepName: 'job_cancelled',
            startedAt: cancelledAt,
            finishedAt: cancelledAt,
            durationMs: 0,
            status: 'skipped',
            outputSummary: `Cancelled by ${cancelledBy}`,
          },
        ],
      });
    }

    await this.audit.create({
      traceId: job.traceId,
      action: 'job.cancelled',
      actorId: cancelledBy,
      resourceType: 'job',
      resourceId: jobId,
      before: job as unknown as Record<string, unknown>,
      after: cancelled as unknown as Record<string, unknown>,
      metadata: { cancelledBy },
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobCancelled',
      traceId: job.traceId,
      correlationId: job.correlationId,
      occurredAt: cancelledAt,
      jobId,
      cancelledBy,
    });

    // CANCELLED is a terminal print outcome: a caller waiting on a result must
    // be told the print will never happen, not left waiting forever.
    emitPrintJobTerminal(this.events, cancelled, {
      status: 'CANCELLED',
      errorCode: 'JOB_CANCELLED',
      errorMessage: `Cancelled by ${cancelledBy}`,
      finishedAt: cancelledAt,
    });

    return cancelled;
  }
}
