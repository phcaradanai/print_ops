import type {
  TraceRepositoryPort,
  JobTrace,
  TraceStep,
  EventBusPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class RecordTraceService {
  constructor(
    private traces: TraceRepositoryPort,
    private events: EventBusPort
  ) {}

  async addStep(jobId: string, step: TraceStep): Promise<JobTrace> {
    const trace = await this.traces.findByJobId(jobId);
    if (!trace) throw new Error(`Trace for job ${jobId} not found`);

    const updated = await this.traces.update(trace.id, {
      steps: [...trace.steps, step],
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'TraceRecorded',
      traceId: trace.traceId,
      correlationId: trace.correlationId,
      occurredAt: new Date(),
      jobId,
    });

    return updated;
  }
}
