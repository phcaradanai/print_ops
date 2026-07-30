import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollController, type PollSnapshot } from '../lib/pollController.js';

let snapshots: PollSnapshot<string[]>[];

beforeEach(() => {
  snapshots = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('polling suspension', () => {
  it('stops recurring requests without discarding the retained snapshot', async () => {
    const fetcher = vi.fn().mockResolvedValue(['job-1']);
    const controller = createPollController({
      fetcher,
      intervalMs: 100,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      isVisible: () => true,
      subscribeVisibility: () => () => undefined,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)?.data).toEqual(['job-1']);

    controller.setPollingEnabled(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)?.data).toEqual(['job-1']);

    controller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)?.data).toEqual(['job-1']);

    controller.stop();
  });

  it('resumes immediately when automatic polling is re-enabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(['job-1']);
    const controller = createPollController({
      fetcher,
      intervalMs: 1000,
      pollingEnabled: false,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      isVisible: () => true,
      subscribeVisibility: () => () => undefined,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1); // initial load

    controller.setPollingEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);

    controller.stop();
  });
});
