import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from '../lib/singleFlight.js';

/**
 * Duplicate-mutation guard used by `useApiAction`.
 *
 * The failure this prevents is physical: a second `POST /print-jobs` or a second
 * reprint means a second label leaves the printer. `pending` state alone cannot
 * stop it, because a caller can invoke `run()` again before React re-renders.
 *
 * These tests exercise the real shipped module — `useApiAction.run` IS
 * `createSingleFlight(...).run`, so every case below is the hook's behaviour and
 * not a model of it. The hook itself cannot be rendered here: Vitest runs in the
 * `node` environment with no DOM.
 */

/** A promise plus its resolvers, so a test can hold an action open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('single-flight mutation guard', () => {
  it('shares one in-flight action between two immediate calls', async () => {
    const gate = deferred<string>();
    const action = vi.fn(() => gate.promise);
    const flight = createSingleFlight(action);

    const first = flight.run();
    const second = flight.run();

    // Same Promise object: the second caller did not start anything.
    expect(second).toBe(first);
    expect(action).toHaveBeenCalledTimes(1);
    expect(flight.isInFlight()).toBe(true);

    gate.resolve('job-1');
    // Both callers observe the one result.
    await expect(first).resolves.toBe('job-1');
    await expect(second).resolves.toBe('job-1');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('calls the underlying function exactly once for a burst of calls', async () => {
    const gate = deferred<number>();
    const action = vi.fn(() => gate.promise);
    const flight = createSingleFlight(action);

    // A double-click, an Enter keypress and a stray programmatic call.
    const calls = [flight.run(), flight.run(), flight.run(), flight.run()];

    gate.resolve(7);
    const results = await Promise.all(calls);

    expect(action).toHaveBeenCalledTimes(1);
    expect(results).toEqual([7, 7, 7, 7]);
  });

  it('releases the guard when the action succeeds', async () => {
    const action = vi.fn(async () => 'ok');
    const flight = createSingleFlight(action);

    await flight.run();

    expect(flight.isInFlight()).toBe(false);
    await flight.run();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('releases the guard when the action fails, so a retry is possible', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce('ok');
    const flight = createSingleFlight(action);

    await expect(flight.run()).rejects.toThrow('network down');
    expect(flight.isInFlight()).toBe(false);

    // The whole point of releasing on failure: the operator can try again.
    await expect(flight.run()).resolves.toBe('ok');
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('lets a later legitimate action execute with its own arguments', async () => {
    const action = vi.fn(async (runnerId: string) => runnerId);
    const flight = createSingleFlight(action);

    await expect(flight.run('runner-a')).resolves.toBe('runner-a');
    await expect(flight.run('runner-b')).resolves.toBe('runner-b');

    expect(action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenNthCalledWith(1, 'runner-a');
    expect(action).toHaveBeenNthCalledWith(2, 'runner-b');
  });

  it('cannot be released by a presentation-only reset', async () => {
    const gate = deferred<string>();
    const action = vi.fn(() => gate.promise);
    const flight = createSingleFlight(action);

    // Everything `useApiAction.reset()` is able to touch: presentation state
    // and the error ref. The single-flight slot is not reachable from it, and
    // `pending` is derived from `isInFlight()` rather than cleared outright.
    const view = { error: null as unknown, result: undefined as unknown, pending: false };
    const reset = () => {
      view.error = null;
      view.result = undefined;
      view.pending = flight.isInFlight();
    };

    const first = flight.run();
    expect(flight.isInFlight()).toBe(true);

    // Dismissing the error banner while a mutation is open must not enable a
    // duplicate request — and must not claim the action finished.
    reset();
    expect(view.pending).toBe(true);
    expect(flight.isInFlight()).toBe(true);
    expect(flight.run()).toBe(first);
    expect(action).toHaveBeenCalledTimes(1);

    gate.resolve('ok');
    await first;
    reset();
    expect(view.pending).toBe(false);
    expect(flight.isInFlight()).toBe(false);
  });

  it('does not let a late settle free a newer run\'s slot', async () => {
    const firstGate = deferred<string>();
    const secondGate = deferred<string>();
    const action = vi
      .fn()
      .mockImplementationOnce(() => firstGate.promise)
      .mockImplementationOnce(() => secondGate.promise);
    const flight = createSingleFlight(action);

    const first = flight.run();
    firstGate.resolve('first');
    await first;

    const second = flight.run();
    expect(flight.isInFlight()).toBe(true);

    // The first run has already settled; it must not clear the slot the second
    // run now owns.
    expect(flight.run()).toBe(second);
    expect(action).toHaveBeenCalledTimes(2);

    secondGate.resolve('second');
    await second;
    expect(flight.isInFlight()).toBe(false);
  });
});
