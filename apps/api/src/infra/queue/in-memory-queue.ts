import type { JobQueuePort, JobQueueMessage } from '@printerops/domain';

export class InMemoryJobQueue implements JobQueuePort {
  private queue: JobQueueMessage[] = [];
  private inflight = new Map<string, JobQueueMessage>();

  async enqueue(message: JobQueueMessage): Promise<void> {
    const index = this.queue.findIndex((m) => m.priority < message.priority);
    if (index === -1) {
      this.queue.push(message);
    } else {
      this.queue.splice(index, 0, message);
    }
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
}
