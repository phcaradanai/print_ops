import type { RunnerRepositoryPort, EventBusPort, Runner } from '@printerops/domain';
import { generateId, generateTraceId, generateCorrelationId, NotFoundError, ConflictError } from '@printerops/shared';
import { isRunnerTerminated } from './runner-lifecycle.service.js';

export class RunnerHeartbeatService {
  constructor(
    private runners: RunnerRepositoryPort,
    private events: EventBusPort
  ) {}

  async execute(runnerId: string): Promise<Runner> {
    const runner = await this.runners.findById(runnerId);
    if (!runner) throw new NotFoundError('Runner', runnerId);
    // A terminated runner must not be able to flip itself back to `online`.
    if (isRunnerTerminated(runner)) {
      throw new ConflictError(`Runner '${runner.name}' was terminated and can no longer heartbeat.`);
    }

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
