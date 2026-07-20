import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';

describe('InMemoryJobQueue', () => {
  let queue: InMemoryJobQueue;

  beforeEach(() => {
    queue = new InMemoryJobQueue();
  });

  it('enqueues and dequeues in priority order', async () => {
    await queue.enqueue({
      jobId: 'job-1', printerId: 'p1', traceId: 't1', correlationId: 'c1',
      priority: 50, enqueuedAt: new Date(),
    });
    await queue.enqueue({
      jobId: 'job-2', printerId: 'p1', traceId: 't2', correlationId: 'c2',
      priority: 100, enqueuedAt: new Date(),
    });
    await queue.enqueue({
      jobId: 'job-3', printerId: 'p1', traceId: 't3', correlationId: 'c3',
      priority: 75, enqueuedAt: new Date(),
    });

    expect(await queue.size()).toBe(3);

    // Highest priority first (100)
    const first = await queue.dequeue();
    expect(first!.jobId).toBe('job-2');

    // Next highest (75)
    const second = await queue.dequeue();
    expect(second!.jobId).toBe('job-3');

    // Last (50)
    const third = await queue.dequeue();
    expect(third!.jobId).toBe('job-1');

    expect(await queue.size()).toBe(0);
  });

  it('ack removes from inflight', async () => {
    await queue.enqueue({
      jobId: 'j1', printerId: 'p1', traceId: 't1', correlationId: 'c1',
      priority: 50, enqueuedAt: new Date(),
    });

    const msg = await queue.dequeue();
    expect(msg).toBeDefined();

    await queue.ack('j1');
    const metrics = await queue.getMetrics();
    expect(metrics.inflight).toBe(0);
  });

  it('nack requeues the message', async () => {
    await queue.enqueue({
      jobId: 'j1', printerId: 'p1', traceId: 't1', correlationId: 'c1',
      priority: 50, enqueuedAt: new Date(),
    });

    await queue.dequeue();
    await queue.nack('j1');

    expect(await queue.size()).toBe(1);
    const metrics = await queue.getMetrics();
    expect(metrics.size).toBe(1);
    expect(metrics.inflight).toBe(0);
  });

  it('getMetrics returns correct values', async () => {
    await queue.enqueue({
      jobId: 'j1', printerId: 'p1', traceId: 't1', correlationId: 'c1',
      priority: 100, enqueuedAt: new Date('2024-01-01'),
    });
    await queue.enqueue({
      jobId: 'j2', printerId: 'p1', traceId: 't2', correlationId: 'c2',
      priority: 50, enqueuedAt: new Date('2024-01-02'),
    });

    const metrics = await queue.getMetrics();
    expect(metrics.size).toBe(2);
    expect(metrics.inflight).toBe(0);
    expect(metrics.oldestPriority).toBe(100);
    expect(metrics.avgWaitMs).toBeGreaterThanOrEqual(0);
  });

  it('getMetrics with empty queue returns nulls', async () => {
    const metrics = await queue.getMetrics();
    expect(metrics.size).toBe(0);
    expect(metrics.inflight).toBe(0);
    expect(metrics.oldestEnqueuedAt).toBeNull();
    expect(metrics.oldestPriority).toBeNull();
  });

  it('dequeue returns undefined when empty', async () => {
    const msg = await queue.dequeue();
    expect(msg).toBeUndefined();
  });

  it('nack of unknown jobId is no-op', async () => {
    await queue.nack('nonexistent');
    expect(await queue.size()).toBe(0);
  });
});
