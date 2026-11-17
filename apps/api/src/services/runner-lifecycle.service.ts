import type {
  AuditRepositoryPort,
  EventBusPort,
  Runner,
  RunnerRepositoryPort,
} from '@printerops/domain';
import { ConflictError, NotFoundError, generateCorrelationId, generateId, generateTraceId } from '@printerops/shared';

/** Metadata flags a terminated runner carries; both repositories persist `metadata`. */
export const RUNNER_TERMINATED_FLAG = 'terminated';
export const RUNNER_TERMINATED_AT = 'terminatedAt';
export const RUNNER_TERMINATED_BY = 'terminatedBy';

/** A runner that may still claim work: registered and not terminated. */
export function isRunnerTerminated(runner: Pick<Runner, 'metadata'>): boolean {
  return runner.metadata?.[RUNNER_TERMINATED_FLAG] === true;
}

/**
 * Terminates and deletes runner registrations.
 *
 * The gateway must always keep at least one runner able to take work, otherwise
 * queued jobs have no consumer and the queue silently stops draining. "Terminate"
 * leaves the record in place as a tombstone that refuses heartbeats, registration
 * and job claims, so a live process cannot quietly re-register itself; "delete"
 * removes the record outright. Both refuse to remove the last usable runner.
 */
export class RunnerLifecycleService {
  constructor(
    private readonly runners: RunnerRepositoryPort,
    private readonly audit: AuditRepositoryPort,
    private readonly events: EventBusPort,
  ) {}

  /** Stops a runner from taking work while keeping its record for the operator. */
  async terminate(runnerId: string, actor: string): Promise<Runner> {
    const runner = await this.requireRunner(runnerId);
    if (isRunnerTerminated(runner)) return runner;
    await this.assertAnotherRunnerRemains(runner, 'terminate');

    const terminatedAt = new Date().toISOString();
    const updated = await this.runners.update(runnerId, {
      status: 'offline',
      metadata: {
        ...(runner.metadata ?? {}),
        [RUNNER_TERMINATED_FLAG]: true,
        [RUNNER_TERMINATED_AT]: terminatedAt,
        [RUNNER_TERMINATED_BY]: actor,
      },
    });

    const traceId = generateTraceId();
    await this.audit.create({
      traceId,
      action: 'runner.terminated',
      resourceType: 'runner',
      resourceId: runner.id,
      before: runner as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      metadata: { actor },
    });
    this.events.publish({
      eventId: generateId(),
      eventType: 'RunnerTerminated',
      traceId,
      correlationId: generateCorrelationId(),
      occurredAt: new Date(),
      runnerId: runner.id,
      runnerName: runner.name,
    });
    return updated;
  }

  /** Removes a runner registration. A terminated runner can always be removed. */
  async remove(runnerId: string, actor: string): Promise<void> {
    const runner = await this.requireRunner(runnerId);
    if (!isRunnerTerminated(runner)) {
      await this.assertAnotherRunnerRemains(runner, 'delete');
    }

    await this.runners.delete(runnerId);

    const traceId = generateTraceId();
    await this.audit.create({
      traceId,
      action: 'runner.deleted',
      resourceType: 'runner',
      resourceId: runner.id,
      before: runner as unknown as Record<string, unknown>,
      metadata: { actor },
    });
    this.events.publish({
      eventId: generateId(),
      eventType: 'RunnerDeleted',
      traceId,
      correlationId: generateCorrelationId(),
      occurredAt: new Date(),
      runnerId: runner.id,
      runnerName: runner.name,
    });
  }

  private async requireRunner(runnerId: string): Promise<Runner> {
    const runner = await this.runners.findById(runnerId);
    if (!runner) throw new NotFoundError('Runner', runnerId);
    return runner;
  }

  /**
   * Refuses an action that would leave no runner able to claim work. Counts every
   * record that is not terminated (not just the deduplicated cards the UI shows), so
   * legacy duplicate rows still count as a usable receiver.
   */
  private async assertAnotherRunnerRemains(runner: Runner, action: 'terminate' | 'delete'): Promise<void> {
    const all = await this.runners.findAll();
    const usable = all.filter((candidate) => !isRunnerTerminated(candidate));
    if (usable.length <= 1 && usable.some((candidate) => candidate.id === runner.id)) {
      throw new ConflictError(
        `Cannot ${action} runner '${runner.name}': at least one runner must remain to receive print jobs. `
        + 'Register or start another runner first.',
      );
    }
  }
}
