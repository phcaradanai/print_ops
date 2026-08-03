import type { EventBusPort, Job, PrintJobTerminal, TerminalPrintStatus } from '@printerops/domain';
import { isTerminalPrintStatus } from '@printerops/domain';
import { generateId } from '@printerops/shared';

/**
 * Single emitter for `PrintJobTerminal`.
 *
 * A job can reach a terminal state from three places — the in-process executor
 * (`ExecuteJobService`, desktop / local worker), the Go runner's result endpoint
 * (`POST /runners/:id/jobs/:jobId/result`), and an operator cancel
 * (`CancelJobService`). Emitting from only one of them is the trap: the E2E
 * matrix would pass under PRINTOPS_LOCAL_WORKER while the real Go-runner
 * deployment silently never fired a single result callback. Every site calls
 * this function so the event is shaped identically.
 *
 * Call it ONLY after the terminal state has been durably persisted — the
 * subscriber reads the job back to resolve its callback intent, and would
 * otherwise race the write.
 */
export function emitPrintJobTerminal(
  events: EventBusPort,
  job: Job,
  args: {
    status: string;
    runnerId?: string;
    printerCode?: string;
    errorCode?: string;
    errorMessage?: string;
    finishedAt?: Date;
    traceId?: string;
  },
): void {
  // Defensive: a non-terminal status here would mean a caller wired the emit
  // into the wrong branch, and a "result" callback announcing QUEUED is exactly
  // the defect this whole path replaces.
  if (!isTerminalPrintStatus(args.status)) return;

  const occurredAt = args.finishedAt ?? new Date();
  const event: PrintJobTerminal = {
    eventId: generateId(),
    eventType: 'PrintJobTerminal',
    traceId: args.traceId ?? job.traceId,
    correlationId: job.correlationId,
    occurredAt,
    jobId: job.id,
    status: args.status as TerminalPrintStatus,
    requestId: job.requestId,
    sourceSystem: job.sourceSystem,
    printerCode: args.printerCode ?? job.printerCode,
    printerId: job.printerId,
    runnerId: args.runnerId ?? job.runnerId,
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    finishedAt: occurredAt,
  };
  events.publish(event);
}
