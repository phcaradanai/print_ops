import type {
  RunnerRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  Runner,
  RegisterRunnerInput,
} from '@printerops/domain';
import { generateId, generateTraceId, generateCorrelationId } from '@printerops/shared';

export class RegisterRunnerService {
  constructor(
    private runners: RunnerRepositoryPort,
    private audit: AuditRepositoryPort,
    private events: EventBusPort
  ) {}

  async execute(input: RegisterRunnerInput): Promise<Runner> {
    const runner = await this.runners.create({ ...input, id: generateId() });
    const traceId = generateTraceId();

    await this.audit.create({
      traceId,
      action: 'runner.registered',
      resourceType: 'runner',
      resourceId: runner.id,
      after: runner as unknown as Record<string, unknown>,
      metadata: {},
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'RunnerRegistered',
      traceId,
      correlationId: generateCorrelationId(),
      occurredAt: new Date(),
      runnerId: runner.id,
      runnerName: runner.name,
    });

    return runner;
  }
}
