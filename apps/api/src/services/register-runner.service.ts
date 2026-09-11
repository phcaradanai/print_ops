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
    // A desktop runner is restarted whenever the desktop app restarts. It is
    // still the same logical runner when its name and hostname are unchanged;
    // creating a fresh UUID here on every launch used to leave one card per
    // restart in Diagnostics and split discovery data across those cards.
    const existing = (await this.runners.findAll()).find(
      (runner) => runner.name === input.name && runner.hostname === input.hostname,
    );
    if (existing) {
      const runner = await this.runners.update(existing.id, {
        ipAddress: input.ipAddress,
        status: 'online',
        supportedProtocols: input.supportedProtocols,
        lastHeartbeatAt: new Date(),
        metadata: input.metadata,
      });
      const traceId = generateTraceId();

      await this.audit.create({
        traceId,
        action: 'runner.reconnected',
        resourceType: 'runner',
        resourceId: runner.id,
        after: runner as unknown as Record<string, unknown>,
        metadata: {},
      });

      return runner;
    }

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
