import type { JobQueuePort, JobQueueMessage, QueueMetrics } from '@printerops/domain';

export class InMemoryJobQueue implements JobQueuePort {
  private queue: JobQueueMessage[] = [];
  private inflight = new Map<string, JobQueueMessage>();
  private enqueueTimes = new Map<string, number>();

  async enqueue(message: JobQueueMessage): Promise<void> {
    const index = this.queue.findIndex((m) => m.priority < message.priority);
    if (index === -1) {
      this.queue.push(message);
    } else {
      this.queue.splice(index, 0, message);
    }
    this.enqueueTimes.set(message.jobId, Date.now());
  }

  async dequeue(): Promise<JobQueueMessage | undefined> {
    const message = this.queue.shift();
    if (message) {
      this.inflight.set(message.jobId, message);
    }
    return message;
  }

  async ack(jobId: string): Promise<void> {
    this.inflight.delete(jobId);
    this.enqueueTimes.delete(jobId);
  }

  async nack(jobId: string): Promise<void> {
    const message = this.inflight.get(jobId);
    if (message) {
      this.inflight.delete(jobId);
      this.queue.push(message);
    }
  }

  async size(): Promise<number> {
    return this.queue.length;
  }

  async getMetrics(): Promise<QueueMetrics> {
    const now = Date.now();
    const oldest = this.queue.length > 0 ? this.queue[0]! : null;
    let avgWaitMs: number | null = null;

    if (this.queue.length > 0) {
      let totalWait = 0;
      let count = 0;
      for (const msg of this.queue) {
        const enqTime = this.enqueueTimes.get(msg.jobId);
        if (enqTime) {
          totalWait += now - enqTime;
          count++;
        }
      }
      avgWaitMs = count > 0 ? Math.round(totalWait / count) : 0;
    }

    return {
      size: this.queue.length,
      inflight: this.inflight.size,
      oldestEnqueuedAt: oldest?.enqueuedAt ?? null,
      oldestPriority: oldest?.priority ?? null,
      avgWaitMs,
    };
  }
}
