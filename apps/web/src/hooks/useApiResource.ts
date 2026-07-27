/**
 * React binding for {@link createPollController} (FE-01.1).
 *
 * One hook covers both shapes the dashboard needs:
 *   - one-shot load with manual retry  → `useApiResource(fetcher)`
 *   - live polling                     → `useApiResource(fetcher, { intervalMs })`
 *
 * All scheduling, overlap suppression and visibility handling live in the
 * controller, which is tested directly with fake timers. This file only maps
 * snapshots onto React state.
 *
 * CONTRACT: `fetcher` must be stable across renders — wrap it in `useCallback`
 * with its real dependencies (a job id, a filter). A new function identity
 * restarts the loop, which is correct when the inputs really changed and a bug
 * when it did not.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPollController, type PollController, type PollSnapshot } from '../lib/pollController.js';

export interface ApiResource<T> extends PollSnapshot<T> {
  /** Manual attempt: the retry button on an error surface. */
  refresh: () => void;
}

export interface UseApiResourceOptions {
  /** Poll period. Omit or `0` for a single load plus manual refresh. */
  intervalMs?: number;
  /** `false` suspends everything (e.g. a route param is missing). */
  enabled?: boolean;
}

const IDLE: PollSnapshot<never> = {
  data: undefined,
  error: null,
  loading: true,
  refreshing: false,
  lastSuccessAt: null,
  stale: false,
  paused: false,
};

export function useApiResource<T>(
  fetcher: () => Promise<T>,
  options: UseApiResourceOptions = {},
): ApiResource<T> {
  const { intervalMs = 0, enabled = true } = options;
  const [snapshot, setSnapshot] = useState<PollSnapshot<T>>(IDLE as PollSnapshot<T>);
  const controllerRef = useRef<PollController | null>(null);

  useEffect(() => {
    if (!enabled) {
      controllerRef.current = null;
      setSnapshot({ ...(IDLE as PollSnapshot<T>), loading: false });
      return;
    }

    const controller = createPollController<T>({
      fetcher,
      intervalMs,
      onSnapshot: setSnapshot,
    });
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, [fetcher, intervalMs, enabled]);

  const refresh = useCallback(() => {
    controllerRef.current?.refresh();
  }, []);

  return { ...snapshot, refresh };
}
