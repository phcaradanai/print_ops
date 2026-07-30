/**
 * Mutation counterpart to {@link useApiResource}.
 *
 * Besides centralising pending/result/error state, the hook is a safety boundary:
 * while one mutation is in flight, every additional `run()` call receives the
 * same promise and the underlying action is invoked only once. A disabled button
 * is useful feedback, but it is not sufficient protection against two handlers,
 * keyboard activation, or calls that happen before React re-renders.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiAction<Args extends unknown[], Result> {
  /** Runs the action. Concurrent calls share the current in-flight Promise. */
  run: (...args: Args) => Promise<Result | undefined>;
  pending: boolean;
  /**
   * Thrown value of the last failed run; cleared when a run starts.
   * Use {@link getError} immediately after awaiting `run()` inside a handler.
   */
  error: unknown;
  /** Synchronous view of the last run's error. */
  getError: () => unknown;
  /** Result of the last successful run. */
  result: Result | undefined;
  /** Clears visible result/error state without cancelling an in-flight action. */
  reset: () => void;
}

export function useApiAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
): ApiAction<Args, Result> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | undefined>(undefined);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const actionRef = useRef(action);
  actionRef.current = action;

  const errorRef = useRef<unknown>(null);
  const inFlightRef = useRef<Promise<Result | undefined> | null>(null);

  const run = useCallback((...args: Args): Promise<Result | undefined> => {
    const existing = inFlightRef.current;
    if (existing) return existing;

    let current!: Promise<Result | undefined>;
    current = (async () => {
      if (mounted.current) {
        setPending(true);
        setError(null);
      }
      errorRef.current = null;

      try {
        const value = await actionRef.current(...args);
        if (mounted.current) {
          setResult(value);
          setError(null);
        }
        return value;
      } catch (err: unknown) {
        // Recorded even when unmounted: the original caller may still await run.
        errorRef.current = err;
        if (mounted.current) setError(err);
        return undefined;
      } finally {
        if (inFlightRef.current === current) inFlightRef.current = null;
        if (mounted.current) setPending(false);
      }
    })();

    inFlightRef.current = current;
    return current;
  }, []);

  const getError = useCallback(() => errorRef.current, []);

  const reset = useCallback(() => {
    setError(null);
    errorRef.current = null;
    setResult(undefined);
    // Reset is a presentation action, not cancellation. Keep the busy state
    // truthful until the existing mutation actually settles.
    setPending(inFlightRef.current !== null);
  }, []);

  return { run, pending, error, getError, result, reset };
}
