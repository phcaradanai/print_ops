import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage } from '../api/errors.js';

/**
 * Regression guard for the stale-error read (FE-01.2).
 *
 * `useApiAction` exposes the failure two ways and they are NOT interchangeable:
 *
 *   action.error       — React state. Correct in JSX, one render behind inside
 *                        the async handler that just awaited `run()`.
 *   action.getError()  — ref-backed. Correct immediately after `await run()`.
 *
 * Reading `action.error` in a handler printed `errorMessage(null)` — the
 * generic fallback — on the first failure, and the PREVIOUS failure's message
 * on the second: a plausible-looking wrong reason, which is exactly the class
 * of defect this milestone removes.
 *
 * The hook cannot be rendered here (node environment, no jsdom), so this test
 * pins the state-vs-ref semantics on the same shapes the hook uses.
 */

/**
 * Mirrors the hook's internals. `stateError` only becomes visible when
 * `rerender()` is called — that is precisely what a React state update does,
 * and precisely what has NOT happened yet inside the handler that awaited
 * `run()`. The ref needs no re-render.
 */
function actionSnapshot() {
  let stateError: unknown = null; // what `action.error` holds in the closure
  let pendingStateError: unknown = null;
  const ref = { current: null as unknown };

  return {
    /** The value a handler closed over, i.e. before the next render. */
    get closedOverError() {
      return stateError;
    },
    /** Applies the scheduled state update, as React would on re-render. */
    rerender() {
      stateError = pendingStateError;
    },
    getError: () => ref.current,
    async run(fail: unknown | null): Promise<boolean | undefined> {
      ref.current = null;
      pendingStateError = null;
      if (fail) {
        ref.current = fail;
        pendingStateError = fail;
        return undefined;
      }
      return true;
    },
  };
}

describe('useApiAction error propagation', () => {
  it('getError() carries the failure that run() just caught', async () => {
    const action = actionSnapshot();
    const failure = new ApiError({
      status: 403,
      path: '/printers/p1/test-print',
      message: 'Missing permission: printer:control',
    });

    const result = await action.run(failure);
    expect(result).toBeUndefined();
    expect(action.getError()).toBe(failure);
    expect(errorMessage(action.getError())).toBe('Missing permission: printer:control');
  });

  it('the closed-over state field is still empty at that moment — the bug this replaces', async () => {
    const action = actionSnapshot();
    await action.run(new ApiError({ status: 500, path: '/jobs', message: 'boom' }));

    expect(action.closedOverError).toBeNull();
    // Which is why the operator used to read a generic sentence instead of the
    // server's reason.
    expect(errorMessage(action.closedOverError, 'Unexpected error')).toBe('Unexpected error');

    // Only after the component re-renders does the state field catch up — too
    // late for the message the handler already built.
    action.rerender();
    expect(errorMessage(action.closedOverError)).toBe('boom');
  });

  it('clears the previous failure when a new run starts', async () => {
    const action = actionSnapshot();
    await action.run(new ApiError({ status: 500, path: '/jobs', message: 'first' }));
    expect(errorMessage(action.getError())).toBe('first');

    await action.run(null);
    expect(action.getError()).toBeNull();
  });
});
