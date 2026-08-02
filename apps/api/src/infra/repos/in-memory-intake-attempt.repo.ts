import type {
  IntakeAttempt,
  CreateIntakeAttemptInput,
  IntakeAttemptRepositoryPort,
  ListOptions,
  IntakeOutcome,
  IntakeSource,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

/** Bounded ring buffer: keeps only the most recent entries so a burst of
 * rejected messages can never grow this beyond a fixed memory footprint. */
const MAX_ENTRIES = 500;

export class InMemoryIntakeAttemptRepository implements IntakeAttemptRepositoryPort {
  private store: IntakeAttempt[] = [];

  async record(input: CreateIntakeAttemptInput): Promise<IntakeAttempt> {
    const attempt: IntakeAttempt = { ...input, id: generateId(), occurredAt: new Date() };
    this.store.push(attempt);
    if (this.store.length > MAX_ENTRIES) {
      this.store.splice(0, this.store.length - MAX_ENTRIES);
    }
    return attempt;
  }

  async findAll(
    opts?: ListOptions & { outcome?: IntakeOutcome; source?: IntakeSource },
  ): Promise<IntakeAttempt[]> {
    // Newest first: that's what a sysadmin scanning for "what just failed" wants.
    let results = [...this.store].reverse();
    if (opts?.outcome) results = results.filter((a) => a.outcome === opts.outcome);
    if (opts?.source) results = results.filter((a) => a.source === opts.source);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }
}
