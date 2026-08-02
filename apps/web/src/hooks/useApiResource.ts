/**
 * React binding for {@link createPollController}.
 *
 * `setPollingEnabled(false)` stops recurring requests without resetting the
 * retained snapshot. Manual refresh remains available, which is important for
 * terminal Job Detail pages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPollController, type PollController, type PollSnapshot } from '../lib/pollController.js';

export interface ApiResource<T> extends PollSnapshot<T> {
  /** Manual attempt: the retry/refresh button on an error surface. */
  refresh: () => void;
  /** Toggle recurring polling without clearing the current data. */
  setPollingEnabled: (enabled: boolean) => void;
}

export interface UseApiResourceOptions {
  /** Poll period. Omit or `0` for a single load plus manual refresh. */
  intervalMs?: number;
  /** `false` suspends the whole resource (e.g. a missing route param). */
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

  const setPollingEnabled = useCallback((nextEnabled: boolean) => {
    controllerRef.current?.setPollingEnabled(nextEnabled);
  }, []);

  return { ...snapshot, refresh, setPollingEnabled };
}
