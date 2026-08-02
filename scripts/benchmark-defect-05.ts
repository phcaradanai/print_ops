import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Job } from '@printerops/domain';
import { InMemoryJobQueue } from '../apps/api/src/infra/queue/in-memory-queue.js';
import { InMemoryJobRepository } from '../apps/api/src/infra/repos/in-memory-job.repo.js';
import {
  LocalPrintScheduler,
  type LocalPrintSchedulerTiming,
} from '../apps/api/src/services/local-print-scheduler.js';

const POLL_MS = 100;
const PRINT_MS = 20;
const logger = { info: () => {}, error: () => {} };

interface Scenario {
  name: string;
  printers: string[];
}

interface Measurement {
  totalMs: number;
  idleGapBetweenJobsMs: number | null;
  maxConcurrentPrinters: number;
}

async function fixture(printers: string[]) {
  const jobs = new InMemoryJobRepository();
  const queue = new InMemoryJobQueue();
  const created: Job[] = [];
  const queuedAt = new Date();
  for (let index = 0; index < printers.length; index += 1) {
    const id = `benchmark-${index}`;
    const job = await jobs.create({
      id,
      traceId: `trace-${id}`,
      correlationId: `correlation-${id}`,
      printerId: printers[index]!,
      createdBy: 'benchmark',
      mimeType: 'text/plain',
      copies: 1,
      duplex: false,
      colorMode: 'monochrome',
      metadata: {},
    });
    const queued = await jobs.update(job.id, { status: 'QUEUED', queuedAt });
    created.push(queued);
    await queue.enqueue({
      jobId: queued.id,
      printerId: queued.printerId,
      traceId: queued.traceId,
      correlationId: queued.correlationId,
      priority: queued.priority,
      enqueuedAt: queuedAt,
    });
  }
  return { jobs, queue, created };
}

function timedExecutor(jobs: InMemoryJobRepository) {
  let active = 0;
  let maxActive = 0;
  return {
    get maxActive() { return maxActive; },
    async execute(jobId: string): Promise<Job> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, PRINT_MS));
      active -= 1;
      return jobs.update(jobId, { status: 'SUCCESS' });
    },
  };
}

async function legacyOneJobPerTick(printers: string[]): Promise<Measurement> {
  const { jobs, queue, created } = await fixture(printers);
  const executor = timedExecutor(jobs);
  const starts: number[] = [];
  let busy = false;
  let completed = 0;
  const started = performance.now();
  await new Promise<void>((resolveDone) => {
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const message = await queue.dequeue();
        if (!message) return;
        starts.push(performance.now());
        await executor.execute(message.jobId);
        await queue.ack(message.jobId);
        completed += 1;
        if (completed === created.length) {
          clearInterval(timer);
          resolveDone();
        }
      } finally {
        busy = false;
      }
    }, POLL_MS);
  });
  const gaps = starts.slice(1).map((value, index) => Math.max(0, value - starts[index]! - PRINT_MS));
  return {
    totalMs: Math.round(performance.now() - started),
    idleGapBetweenJobsMs: gaps.length ? Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length) : null,
    maxConcurrentPrinters: executor.maxActive,
  };
}

async function perPrinterScheduler(printers: string[]): Promise<Measurement> {
  const { jobs, queue, created } = await fixture(printers);
  const executor = timedExecutor(jobs);
  const timings: LocalPrintSchedulerTiming[] = [];
  const scheduler = new LocalPrintScheduler({ jobs, queue, executor, logger, onTiming: (item) => timings.push(item) });
  const started = performance.now();
  scheduler.start(POLL_MS);
  while ((await Promise.all(created.map((job) => jobs.findById(job.id)))).some((job) => job?.status !== 'SUCCESS')) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  scheduler.stop();
  await scheduler.settled();
  const gaps = timings
    .map((item) => item.idleGapBetweenJobsMs)
    .filter((value): value is number => value != null);
  return {
    totalMs: Math.round(performance.now() - started),
    idleGapBetweenJobsMs: gaps.length ? Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length) : null,
    maxConcurrentPrinters: executor.maxActive,
  };
}

const scenarios: Scenario[] = [
  { name: '1_job', printers: ['printer-a'] },
  { name: '2_jobs_same_printer', printers: ['printer-a', 'printer-a'] },
  { name: '5_jobs_same_printer', printers: ['printer-a', 'printer-a', 'printer-a', 'printer-a', 'printer-a'] },
  { name: '2_jobs_different_printers', printers: ['printer-a', 'printer-b'] },
];

async function main(): Promise<void> {
  const measurements = [];
  for (const scenario of scenarios) {
    const before = await legacyOneJobPerTick(scenario.printers);
    const after = await perPrinterScheduler(scenario.printers);
    measurements.push({
      scenario: scenario.name,
      jobs: scenario.printers.length,
      uniquePrinters: new Set(scenario.printers).size,
      before,
      after,
      improvementPercent: Math.round(((before.totalMs - after.totalMs) / before.totalMs) * 1000) / 10,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    syntheticPrinterExecutionMs: PRINT_MS,
    pollIntervalMs: POLL_MS,
    note: 'Controlled fake-executor benchmark; no physical printer was used.',
    measurements,
  };
  const output = resolve('artifacts/verification/defect-05-performance.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
