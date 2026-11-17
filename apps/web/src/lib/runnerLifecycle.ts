/**
 * Runner lifecycle rules shared by the Runners page.
 *
 * The gateway must always keep at least one runner able to claim work: with none,
 * queued jobs have no consumer and the queue stops draining without any error. The
 * page therefore offers Terminate/Delete per row, but never for the last usable
 * runner. The API enforces the same rule authoritatively (it counts raw records,
 * including legacy duplicates, while this list is deduplicated per host+name), so
 * this helper can only ever be more conservative than the server.
 */

export interface RunnerLifecycleLike {
  id: string;
  metadata?: Record<string, unknown> | null;
}

/** Marked by `RunnerLifecycleService.terminate()`; the record is kept as a tombstone. */
export const RUNNER_TERMINATED_FLAG = 'terminated';

export function isRunnerTerminated(runner: RunnerLifecycleLike | null | undefined): boolean {
  if (!runner || typeof runner !== 'object') return false;
  const metadata = runner.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  return metadata[RUNNER_TERMINATED_FLAG] === true;
}

/** Runners that can still claim a job: registered and not terminated. */
export function usableRunnerCount(runners: readonly RunnerLifecycleLike[]): number {
  return runners.filter((runner) => !isRunnerTerminated(runner)).length;
}

/**
 * Whether the row may be removed (terminate or delete).
 *
 * A terminated tombstone can always be deleted — it is already not a receiver, and
 * removing it is how an operator lets that host register again.
 */
export function canRemoveRunner(
  runners: readonly RunnerLifecycleLike[],
  runner: RunnerLifecycleLike,
): boolean {
  if (!runner) return false;
  if (isRunnerTerminated(runner)) return true;
  return usableRunnerCount(runners) > 1;
}
