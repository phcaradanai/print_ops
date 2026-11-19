import type {
  RunnerRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  Runner,
  RegisterRunnerInput,
} from '@printerops/domain';
import { generateId, generateTraceId, generateCorrelationId } from '@printerops/shared';
import { ConflictError } from '@printerops/shared';
import { isRunnerTerminated } from './runner-lifecycle.service.js';

export class RegisterRunnerService {
  constructor(
    private runners: RunnerRepositoryPort,
    private audit: AuditRepositoryPort,
    private events: EventBusPort
  ) {}

  async execute(input: RegisterRunnerInput): Promise<Runner> {
    // The runner *name* is the logical identity. A desktop runner restarts
    // whenever the app restarts, and the Go runner's hostname is the container
    // id in Docker, so a hostname match alone left one runner record (and one
    // copy of every discovered printer) behind on every restart and redeploy.
    // Two machines must therefore use different PRINTOPS_RUNNER_NAME values.
    const sameName = (await this.runners.findAll()).filter((runner) => runner.name === input.name);
    const existing = sameName
      .sort((left, right) => heartbeatTime(right) - heartbeatTime(left))[0];
    if (existing) {
      // An operator terminated this runner on purpose. Letting a still-running
      // process re-register itself would silently undo that, so the tombstone has to
      // be removed first (delete it from the Runners page) before it can come back.
      if (isRunnerTerminated(existing)) {
        throw new ConflictError(
          `Runner '${existing.name}' on '${existing.hostname}' was terminated by an operator. `
          + 'Delete the terminated runner record before registering it again.',
        );
      }
      const runner = await this.runners.update(existing.id, {
        hostname: input.hostname,
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

/** Newest activity wins when several records carry the same runner name. */
function heartbeatTime(runner: Runner): number {
  const stamp = runner.lastHeartbeatAt instanceof Date
    ? runner.lastHeartbeatAt.getTime()
    : new Date(runner.lastHeartbeatAt ?? 0).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}
