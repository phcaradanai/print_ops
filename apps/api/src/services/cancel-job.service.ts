import type {
  JobRepositoryPort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  Job,
} from '@printerops/domain';
import { generateId, NotFoundError, ValidationError } from '@printerops/shared';
import { emitPrintJobTerminal } from './emit-terminal-event.js';

/** Cancellation is GUARANTEED only before dispatch: nothing has been handed to
 *  an executor yet, so a conditional claim can atomically end the job. */
const GUARANTEED_CANCELLABLE = ['ACCEPTED', 'VALIDATED', 'QUEUED'] as const;

/** After dispatch the document may already be in (or through) the spooler.
 *  Cancelling here is BEST-EFFORT (product decision, 2026-08-03): the request
 *  is recorded, but the executor's real verdict wins — a page that printed is
 *  a printed page, whatever the operator wished. */
const BEST_EFFORT_STATUSES = ['DISPATCHED', 'PRINTING'] as const;

export type CancelOutcome = 'CANCELLED' | 'CANCEL_REQUESTED';

export class CancelJobService {
  constructor(
    private jobs: JobRepositoryPort,
    private traces: TraceRepositoryPort,
    private audit: AuditRepositoryPort,
    private events: EventBusPort
  ) {}

  async execute(jobId: string, cancelledBy: string): Promise<{ job: Job; outcome: CancelOutcome }> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    const cancelledAt = new Date();

    if ((GUARANTEED_CANCELLABLE as readonly string[]).includes(job.status)) {
      // Conditional claim, not a plain update: the local worker can move this
      // job QUEUED → DISPATCHED between our read and our write. Losing that
      // race must degrade to the best-effort path, not overwrite a dispatch.
      const cancelled = await this.jobs.claim(jobId, [...GUARANTEED_CANCELLABLE], {
        status: 'CANCELLED',
        finishedAt: cancelledAt,
        completedAt: cancelledAt,
      });
      if (cancelled) {
        await this.recordGuaranteedCancel(cancelled, job, jobId, cancelledBy, cancelledAt);
        return { job: cancelled, outcome: 'CANCELLED' };
      }
    }

    const current = (await this.jobs.findById(jobId)) ?? job;

    if ((BEST_EFFORT_STATUSES as readonly string[]).includes(current.status)) {
      const updated = await this.jobs.update(jobId, {
        metadata: {
          ...current.metadata,
          cancelRequested: { by: cancelledBy, at: cancelledAt.toISOString() },
        },
      });
      await this.audit.create({
        traceId: current.traceId,
        action: 'job.cancel_requested',
        actorId: cancelledBy,
        resourceType: 'job',
        resourceId: jobId,
        metadata: { status: current.status, bestEffort: true },
      });
      return { job: updated, outcome: 'CANCEL_REQUESTED' };
    }

    throw new ValidationError(
      `Cannot cancel job in status '${current.status}'. Cancellation is guaranteed for ` +
        `${GUARANTEED_CANCELLABLE.join(', ')} and best-effort for ${BEST_EFFORT_STATUSES.join(', ')}.`
    );
  }

  private async recordGuaranteedCancel(
    cancelled: Job,
    before: Job,
    jobId: string,
    cancelledBy: string,
    cancelledAt: Date,
  ): Promise<void> {
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
      traceId: before.traceId,
      action: 'job.cancelled',
      actorId: cancelledBy,
      resourceType: 'job',
      resourceId: jobId,
      before: before as unknown as Record<string, unknown>,
      after: cancelled as unknown as Record<string, unknown>,
      metadata: { cancelledBy },
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobCancelled',
      traceId: before.traceId,
      correlationId: before.correlationId,
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
  }
}
