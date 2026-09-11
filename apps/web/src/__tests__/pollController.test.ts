import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollController, type PollSnapshot } from '../lib/pollController.js';

/** Deferred promise, so a test can hold a request open across timer ticks. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Minimal visibility seam a test can drive by hand. */
function visibilitySeam(initial = true) {
  let visible = initial;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => visible,
    subscribeVisibility: (onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    set(next: boolean) {
      visible = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

let snapshots: PollSnapshot<unknown>[] = [];
const record = (snapshot: PollSnapshot<unknown>) => {
  snapshots.push(snapshot);
};
const latest = () => snapshots[snapshots.length - 1]!;

beforeEach(() => {
  snapshots = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createPollController — first load', () => {
  it('reports loading, then data and a last-success timestamp', async () => {
    const controller = createPollController({
      fetcher: () => Promise.resolve(['job-1']),
      intervalMs: 1000,
      onSnapshot: record,
      now: () => 1_000_000,
      ...visibilitySeam(),
    });

    controller.start();
    expect(latest().loading).toBe(true);
    expect(latest().refreshing).toBe(false);

    await vi.advanceTimersByTimeAsync(0);
    expect(latest()).toMatchObject({
      data: ['job-1'],
      error: null,
      loading: false,
      stale: false,
      lastSuccessAt: 1_000_000,
    });
    controller.stop();
  });

  it('leaves no infinite loading state when the first load fails', async () => {
    const controller = createPollController({
      fetcher: () => Promise.reject(new Error('down')),
      intervalMs: 1000,
      onSnapshot: record,
      ...visibilitySeam(),
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(latest().loading).toBe(false);
    expect(latest().data).toBeUndefined();
    expect((latest().error as Error).message).toBe('down');
    // Nothing to retain, so nothing is claimed to be stale.
    expect(latest().stale).toBe(false);
    controller.stop();
  });
});

describe('createPollController — overlap suppression', () => {
  it('drops a tick that lands while the previous request is still open', async () => {
    const pending = deferred<string[]>();
    const fetcher = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(['later']);

    const controller = createPollController({
      fetcher,
      intervalMs: 100,
      onSnapshot: record,
      ...visibilitySeam(),
    });

    controller.start();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Five intervals pass while the first request hangs: no second request.
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).toHaveBeenCalledTimes(1);

    pending.resolve(['first']);
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().data).toEqual(['first']);

    // The loop resumes only once the previous attempt settled.
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('ignores a manual refresh while a request is in flight', async () => {
    const pending = deferred<string[]>();
    const fetcher = vi.fn().mockReturnValue(pending.promise);
    const controller = createPollController({
      fetcher,
      intervalMs: 0,
      onSnapshot: record,
      ...visibilitySeam(),
    });

    controller.start();
    controller.refresh();
    controller.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending.resolve([]);
    controller.stop();
  });
});

describe('createPollController — visibility', () => {
  it('spends no requests while the document is hidden', async () => {
    const seam = visibilitySeam();
    const fetcher = vi.fn().mockResolvedValue(['job-1']);
    const controller = createPollController({ fetcher, intervalMs: 100, onSnapshot: record, ...seam });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    seam.set(false);
    await vi.advanceTimersByTimeAsync(1000); // ten intervals, hidden
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(latest().paused).toBe(true);
    controller.stop();
  });

  it('refreshes immediately when the document becomes visible again', async () => {
    const seam = visibilitySeam();
    const fetcher = vi.fn().mockResolvedValue(['job-1']);
    const controller = createPollController({ fetcher, intervalMs: 10_000, onSnapshot: record, ...seam });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    seam.set(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    seam.set(true);
    await vi.advanceTimersByTimeAsync(0);
    // Immediately, without waiting out the remaining interval.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(latest().paused).toBe(false);
    controller.stop();
  });
});

describe('createPollController — failure during refresh', () => {
  it('retains the previous data and marks it stale', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(['job-1'])
      .mockRejectedValueOnce(new Error('API /jobs -> 503'));

    const controller = createPollController({
      fetcher,
      intervalMs: 100,
      onSnapshot: record,
      now: () => 5_000,
      ...visibilitySeam(),
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(latest().data).toEqual(['job-1']); // not blanked
    expect(latest().stale).toBe(true);
    expect(latest().lastSuccessAt).toBe(5_000); // still the last true moment
    expect((latest().error as Error).message).toBe('API /jobs -> 503');
    controller.stop();
  });

  it('clears the error and the stale flag on the next success', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(['job-1'])
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(['job-1', 'job-2']);

    const controller = createPollController({ fetcher, intervalMs: 100, onSnapshot: record, ...visibilitySeam() });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(latest().stale).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(latest().error).toBeNull();
    expect(latest().stale).toBe(false);
    expect(latest().data).toEqual(['job-1', 'job-2']);
    controller.stop();
  });

  it('marks a refresh as refreshing, not loading, once data exists', async () => {
    const second = deferred<string[]>();
    const fetcher = vi.fn().mockResolvedValueOnce(['job-1']).mockReturnValueOnce(second.promise);

    const controller = createPollController({ fetcher, intervalMs: 100, onSnapshot: record, ...visibilitySeam() });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(latest().refreshing).toBe(true);
    expect(latest().loading).toBe(false);
    second.resolve(['job-2']);
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().refreshing).toBe(false);
    controller.stop();
  });
});

describe('createPollController — stop', () => {
  it('stops the loop and discards a response that lands afterwards', async () => {
    const pending = deferred<string[]>();
    const fetcher = vi.fn().mockReturnValue(pending.promise);
    const controller = createPollController({ fetcher, intervalMs: 100, onSnapshot: record, ...visibilitySeam() });

    controller.start();
    controller.stop();
    const countAtStop = snapshots.length;

    pending.resolve(['too late']);
    await vi.advanceTimersByTimeAsync(1000);

    expect(snapshots.length).toBe(countAtStop);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
