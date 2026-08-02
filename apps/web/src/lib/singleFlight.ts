/**
 * Shares one in-flight Promise between concurrent callers.
 *
 * A disabled button is useful feedback, not protection: two handlers on the same
 * element, keyboard activation, or a second call issued before React re-renders
 * all still reach the underlying mutation. In a print gateway the duplicate is a
 * second physical page, so the guard has to be synchronous and independent from
 * render timing.
 *
 * Framework-free on purpose — `useApiAction` delegates its dedupe/release to
 * this, which is what makes the behaviour deterministically testable in the
 * `node` test environment.
 */

export interface SingleFlight<Args extends unknown[], Result> {
  /** Concurrent calls receive the Promise of the run already in progress. */
  run: (...args: Args) => Promise<Result>;
  /** True from the synchronous call until the underlying Promise settles. */
  isInFlight: () => boolean;
}

export function createSingleFlight<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
): SingleFlight<Args, Result> {
  let inFlight: Promise<Result> | null = null;

  function run(...args: Args): Promise<Result> {
    const existing = inFlight;
    if (existing) return existing;

    let current!: Promise<Result>;
    current = (async () => {
      try {
        return await fn(...args);
      } finally {
        // Released on both the success and the failure path: a failed mutation
        // must be retryable. Only the run that owns the slot may clear it, so a
        // late settle cannot free a newer run's slot.
        if (inFlight === current) inFlight = null;
      }
    })();

    inFlight = current;
    return current;
  }

  return { run, isInFlight: () => inFlight !== null };
}
