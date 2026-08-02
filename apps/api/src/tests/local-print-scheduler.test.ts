import { describe, expect, it } from 'vitest';
import type { Job } from '@printerops/domain';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import {
  LocalPrintScheduler,
  type LocalPrintSchedulerTiming,
} from '../services/local-print-scheduler.js';

const logger = { info: () => {}, error: () => {} };

async function queuedJob(repo: InMemoryJobRepository, id: string, printerId: string): Promise<Job> {
  const job = await repo.create({
    id,
    traceId: `trace-${id}`,
    correlationId: `corr-${id}`,
    printerId,
    createdBy: 'test',
    mimeType: 'text/plain',
    copies: 1,
    duplex: false,
    colorMode: 'monochrome',
    metadata: {},
  });
  return repo.update(job.id, { status: 'QUEUED', queuedAt: new Date() });
}

async function enqueue(queue: InMemoryJobQueue, job: Job): Promise<void> {
  await queue.enqueue({
    jobId: job.id,
    printerId: job.printerId,
    traceId: job.traceId,
    correlationId: job.correlationId,
    priority: job.priority,
    enqueuedAt: job.queuedAt!,
  });
}

describe('LocalPrintScheduler', () => {
  it('runs same-printer jobs sequentially in queue order with no poll interval between them', async () => {
    const jobs = new InMemoryJobRepository();
    const queue = new InMemoryJobQueue();
    const a = await queuedJob(jobs, 'a', 'printer-1');
    const b = await queuedJob(jobs, 'b', 'printer-1');
    const c = await queuedJob(jobs, 'c', 'printer-1');
    await enqueue(queue, a);
    await enqueue(queue, b);
    await enqueue(queue, c);

    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const timings: LocalPrintSchedulerTiming[] = [];
    const executor = {
      async execute(jobId: string): Promise<Job> {
        order.push(`start:${jobId}`);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        order.push(`end:${jobId}`);
        return jobs.update(jobId, { status: 'SUCCESS' });
      },
    };
    const scheduler = new LocalPrintScheduler({ jobs, queue, executor, logger, onTiming: (item) => timings.push(item) });

    expect(await scheduler.drainAvailable()).toBe(3);
    await scheduler.settled();

    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
    expect(maxActive).toBe(1);
    expect(timings).toHaveLength(3);
    // The former one-job-per-500ms timer imposed about 500ms here. Chained
    // dispatch should only pay local promise scheduling overhead.
    expect(timings.slice(1).every((item) => (item.idleGapBetweenJobsMs ?? 999) < 50)).toBe(true);
  });

  it('runs different printers concurrently while retaining one worker per printer', async () => {
    const jobs = new InMemoryJobRepository();
    const queue = new InMemoryJobQueue();
    const a = await queuedJob(jobs, 'a', 'printer-1');
    const b = await queuedJob(jobs, 'b', 'printer-2');
    await enqueue(queue, a);
    await enqueue(queue, b);

    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signalBothStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => { signalBothStarted = resolve; });
    const executor = {
      async execute(jobId: string): Promise<Job> {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (active === 2) signalBothStarted();
        await gate;
        active -= 1;
        return jobs.update(jobId, { status: 'SUCCESS' });
      },
    };
    const scheduler = new LocalPrintScheduler({ jobs, queue, executor, logger });
    await scheduler.drainAvailable();
    const completed = scheduler.settled();

    await bothStarted;
    expect(maxActive).toBe(2);
    release();
    await completed;
  });
});
