import type { Job, JobQueueMessage, JobQueuePort, JobRepositoryPort } from '@printerops/domain';

export interface LocalPrintSchedulerTiming {
  jobId: string;
  printerId: string;
  queuedAt: Date;
  startedAt: Date;
  finishedAt: Date;
  queueWaitMs: number;
  executionMs: number;
  idleGapBetweenJobsMs: number | null;
}

interface LocalPrintExecutor {
  execute(jobId: string, runnerId: string): Promise<Job>;
}

interface SchedulerLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/**
 * Drains the local queue into one sequential promise chain per printer.
 *
 * Jobs for the same printer preserve dequeue order and never overlap. Jobs for
 * different printers use independent chains and can execute concurrently. A
 * completed job hands directly to the next job on its chain; the poll interval
 * is paid only while the entire queue is idle, not between every print.
 */
export class LocalPrintScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  private readonly workers = new Map<string, Promise<void>>();
  private readonly lastFinishedAt = new Map<string, Date>();

  constructor(
    private readonly deps: {
      jobs: JobRepositoryPort;
      queue: JobQueuePort;
      executor: LocalPrintExecutor;
      logger: SchedulerLogger;
      runnerId?: string;
      now?: () => Date;
      onTiming?: (timing: LocalPrintSchedulerTiming) => void;
    },
  ) {}

  start(intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.drainAvailable(); }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Dequeue every currently available message and assign it to its printer. */
  async drainAvailable(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let scheduled = 0;
    try {
      for (;;) {
        const message = await this.deps.queue.dequeue();
        if (!message) break;
        this.schedule(message);
        scheduled += 1;
      }
    } finally {
      this.draining = false;
    }
    return scheduled;
  }

  /** Wait for all work scheduled so far, including chains extended meanwhile. */
  async settled(): Promise<void> {
    for (let guard = 0; guard < 100 && this.workers.size > 0; guard += 1) {
      await Promise.all([...this.workers.values()]);
    }
  }

  private schedule(message: JobQueueMessage): void {
    const previous = this.workers.get(message.printerId) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => this.execute(message))
      .catch((err: unknown) => {
        const text = err instanceof Error ? err.message : String(err);
        // A direct Sandbox execution may win the conditional claim. That race
        // is safe and must not look like a local-worker outage.
        if (!text.includes('already claimed') && !text.includes('cannot be executed again')) {
          this.deps.logger.error({ err, jobId: message.jobId, printerId: message.printerId }, 'local print worker failed');
        }
      })
      .finally(() => {
        if (this.workers.get(message.printerId) === task) {
          this.workers.delete(message.printerId);
        }
      });
    this.workers.set(message.printerId, task);
  }

  private async execute(message: JobQueueMessage): Promise<void> {
    const queuedJob = await this.deps.jobs.findById(message.jobId);
    if (!queuedJob || queuedJob.status !== 'QUEUED') {
      await this.deps.queue.ack(message.jobId);
      return;
    }

    const now = this.deps.now ?? (() => new Date());
    const startedAt = now();
    const previousFinishedAt = this.lastFinishedAt.get(message.printerId);
    await this.deps.executor.execute(message.jobId, this.deps.runnerId ?? 'desktop-local-worker');
    const finishedAt = now();
    this.lastFinishedAt.set(message.printerId, finishedAt);

    const timing: LocalPrintSchedulerTiming = {
      jobId: message.jobId,
      printerId: message.printerId,
      queuedAt: message.enqueuedAt,
      startedAt,
      finishedAt,
      queueWaitMs: Math.max(0, startedAt.getTime() - message.enqueuedAt.getTime()),
      executionMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      idleGapBetweenJobsMs: previousFinishedAt
        ? Math.max(0, startedAt.getTime() - previousFinishedAt.getTime())
        : null,
    };
    this.deps.onTiming?.(timing);
    this.deps.logger.info({
      jobId: timing.jobId,
      printerId: timing.printerId,
      queue_wait_ms: timing.queueWaitMs,
      printer_execution_ms: timing.executionMs,
      idle_gap_between_jobs_ms: timing.idleGapBetweenJobsMs,
    }, 'local print job timing');
  }
}
