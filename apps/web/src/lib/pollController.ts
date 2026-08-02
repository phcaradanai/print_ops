/**
 * Framework-free polling core.
 *
 * Owns scheduling, overlap suppression, visibility handling and stale-data
 * bookkeeping. Automatic polling can be suspended independently from the
 * resource itself, so terminal Job Detail views keep their data and manual
 * refresh capability without continuing three requests per second forever.
 */

export interface PollSnapshot<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
  lastSuccessAt: number | null;
  stale: boolean;
  /** Polling is suspended because the document is hidden. */
  paused: boolean;
}

export interface PollControllerOptions<T> {
  fetcher: (signal?: AbortSignal) => Promise<T>;
  /** Milliseconds between attempts. `0` disables automatic polling. */
  intervalMs?: number;
  /** Initial automatic-polling state. The first load still runs on start. */
  pollingEnabled?: boolean;
  onSnapshot: (snapshot: PollSnapshot<T>) => void;
  isVisible?: () => boolean;
  subscribeVisibility?: (onChange: () => void) => () => void;
  now?: () => number;
}

export interface PollController {
  /** Runs an immediate first attempt and then schedules polling when enabled. */
  start: () => void;
  /** Stops the controller; late responses are ignored. */
  stop: () => void;
  /** Manual attempt. Works even when automatic polling is disabled. */
  refresh: () => void;
  /** Toggle automatic polling without discarding retained data. */
  setPollingEnabled: (enabled: boolean) => void;
}

function defaultIsVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

function defaultSubscribeVisibility(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

export function createPollController<T>(options: PollControllerOptions<T>): PollController {
  const {
    fetcher,
    intervalMs = 0,
    pollingEnabled: initialPollingEnabled = true,
    onSnapshot,
    isVisible = defaultIsVisible,
    subscribeVisibility = defaultSubscribeVisibility,
    now = Date.now,
  } = options;

  let snapshot: PollSnapshot<T> = {
    data: undefined,
    error: null,
    loading: true,
    refreshing: false,
    lastSuccessAt: null,
    stale: false,
    paused: false,
  };

  let stopped = false;
  let inFlight = false;
  let pollingEnabled = initialPollingEnabled;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeVisibility: (() => void) | null = null;
  let generation = 0;

  function emit(patch: Partial<PollSnapshot<T>>): void {
    snapshot = { ...snapshot, ...patch };
    onSnapshot(snapshot);
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    clearTimer();
    if (stopped || !pollingEnabled || intervalMs <= 0) return;
    timer = setTimeout(() => {
      timer = null;
      if (!isVisible()) {
        emit({ paused: true });
        schedule();
        return;
      }
      void attempt();
    }, intervalMs);
  }

  async function attempt(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    const runGeneration = generation;
    const hasData = snapshot.data !== undefined;
    emit({
      paused: false,
      loading: !hasData,
      refreshing: hasData,
    });

    try {
      const data = await fetcher();
      if (stopped || runGeneration !== generation) return;
      emit({
        data,
        error: null,
        loading: false,
        refreshing: false,
        lastSuccessAt: now(),
        stale: false,
      });
    } catch (error: unknown) {
      if (stopped || runGeneration !== generation) return;
      emit({
        error,
        loading: false,
        refreshing: false,
        stale: snapshot.data !== undefined,
      });
    } finally {
      if (runGeneration === generation) inFlight = false;
      if (!stopped) schedule();
    }
  }

  return {
    start(): void {
      if (unsubscribeVisibility) return;
      stopped = false;
      unsubscribeVisibility = subscribeVisibility(() => {
        if (stopped || !isVisible()) {
          if (!stopped) emit({ paused: true });
          return;
        }

        emit({ paused: false });
        if (!pollingEnabled) return;
        clearTimer();
        void attempt();
      });
      // Initial load is independent from the recurring-polling switch.
      void attempt();
    },

    stop(): void {
      stopped = true;
      generation += 1;
      inFlight = false;
      clearTimer();
      unsubscribeVisibility?.();
      unsubscribeVisibility = null;
    },

    refresh(): void {
      if (stopped) return;
      clearTimer();
      void attempt();
    },

    setPollingEnabled(enabled: boolean): void {
      if (pollingEnabled === enabled) return;
      pollingEnabled = enabled;
      clearTimer();
      if (stopped || !enabled) return;
      if (!isVisible()) {
        emit({ paused: true });
        return;
      }
      void attempt();
    },
  };
}
