/**
 * Mutation counterpart to {@link useApiResource} (FE-01.1).
 *
 * Every page reimplemented the same four lines around a POST: a `pending`
 * flag, a try/catch that replaced the server's reason with a fixed sentence,
 * and a `finally` that had to remember to clear the flag. This centralises it
 * and keeps the thrown `ApiError` intact so `Alert` / `ErrorBanner` can show
 * status, code and trace id.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiAction<Args extends unknown[], Result> {
  /** Runs the action. Resolves to the result, or `undefined` if it failed. */
  run: (...args: Args) => Promise<Result | undefined>;
  pending: boolean;
  /**
   * Thrown value of the last failed run; cleared when a run starts.
   *
   * RENDER-TIME ONLY. Inside an async handler, `action` is the object from the
   * render that created the handler, so this field still holds the PREVIOUS
   * value immediately after `await run()` — reading it there prints the
   * fallback on the first failure and the previous error on the second. Use
   * {@link getError} in handlers.
   */
  error: unknown;
  /**
   * The error of the run that just finished, readable synchronously after
   * `await run()`. Backed by a ref, so it does not lag a render behind.
   */
  getError: () => unknown;
  /** Result of the last successful run. */
  result: Result | undefined;
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

  // Held in a ref so `run` stays referentially stable even when the caller
  // passes an inline arrow — a changing `run` would invalidate every memo and
  // effect that depends on it.
  const actionRef = useRef(action);
  actionRef.current = action;

  // Mirrors `error` without waiting for a re-render, so a handler can read the
  // failure it just awaited. React state alone cannot serve that caller: the
  // closure predates the update.
  const errorRef = useRef<unknown>(null);

  const run = useCallback(async (...args: Args): Promise<Result | undefined> => {
    setPending(true);
    setError(null);
    errorRef.current = null;
    try {
      const value = await actionRef.current(...args);
      if (mounted.current) {
        setResult(value);
        setPending(false);
      }
      return value;
    } catch (err: unknown) {
      // Recorded even when unmounted: the caller may still be awaiting `run`.
      errorRef.current = err;
      if (mounted.current) {
        setError(err);
        setPending(false);
      }
      return undefined;
    }
  }, []);

  const getError = useCallback(() => errorRef.current, []);

  const reset = useCallback(() => {
    setError(null);
    errorRef.current = null;
    setResult(undefined);
    setPending(false);
  }, []);

  return { run, pending, error, getError, result, reset };
}
