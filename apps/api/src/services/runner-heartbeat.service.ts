import type { RunnerRepositoryPort, EventBusPort, Runner } from '@printerops/domain';
import { generateId, generateTraceId, generateCorrelationId, NotFoundError } from '@printerops/shared';

export class RunnerHeartbeatService {
  constructor(
    private runners: RunnerRepositoryPort,
    private events: EventBusPort
  ) {}

  async execute(runnerId: string): Promise<Runner> {
    const runner = await this.runners.findById(runnerId);
    if (!runner) throw new NotFoundError('Runner', runnerId);

    const updated = await this.runners.update(runnerId, {
      lastHeartbeatAt: new Date(),
      status: 'online',
    });

    const traceId = generateTraceId();
    this.events.publish({
      eventId: generateId(),
      eventType: 'RunnerHeartbeatReceived',
      traceId,
      correlationId: generateCorrelationId(),
      occurredAt: new Date(),
      runnerId,
    });

    return updated;
  }
}
