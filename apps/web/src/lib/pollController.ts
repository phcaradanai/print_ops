/**
 * Framework-free polling core (FE-01.1).
 *
 * The dashboard polls three surfaces (`JobQueue` every 1.5s, `JobDetail` every
 * 1s ×3 endpoints, `Dashboard` on demand). Each one hand-rolled its own
 * `setInterval` + `let active = true`, and all of them shared the same three
 * defects: a slow response let the next tick start a second overlapping
 * request, polling continued at full rate while the window was hidden, and a
 * failed refresh left the previous data on screen with nothing saying when it
 * was last true.
 *
 * This controller owns exactly that: scheduling, overlap suppression,
 * visibility, and the success/failure bookkeeping. It owns **no React state**
 * and touches the DOM only through injected seams, so the behaviour is testable
 * in the repo's node test environment with `vi.useFakeTimers()`.
 */

export interface PollSnapshot<T> {
  /** Last successfully loaded value. Retained across failures on purpose. */
  data: T | undefined;
  /** Failure of the most recent attempt; cleared by the next success. */
  error: unknown;
  /** First load, nothing to show yet. */
  loading: boolean;
  /** A request is in flight while previous data is already on screen. */
  refreshing: boolean;
  /** `Date.now()` of the last success, or null if never succeeded. */
  lastSuccessAt: number | null;
  /** True when `data` is older than the last attempt, i.e. visibly stale. */
  stale: boolean;
  /** Polling is suspended because the document is hidden. */
  paused: boolean;
}

export interface PollControllerOptions<T> {
  fetcher: (signal?: AbortSignal) => Promise<T>;
  /** Milliseconds between attempts. `0` disables polling (one-shot + manual refresh). */
  intervalMs?: number;
  onSnapshot: (snapshot: PollSnapshot<T>) => void;
  /** Seam: defaults to `document.visibilityState !== 'hidden'`. */
  isVisible?: () => boolean;
  /** Seam: defaults to a `visibilitychange` listener. Returns an unsubscribe. */
  subscribeVisibility?: (onChange: () => void) => () => void;
  /** Seam: defaults to `Date.now`. */
  now?: () => number;
}

export interface PollController {
  /** Runs an immediate attempt and, when `intervalMs > 0`, starts the loop. */
  start: () => void;
  /** Stops the loop; late responses from in-flight attempts are ignored. */
  stop: () => void;
  /** Manual attempt (retry button). Ignored while one is already in flight. */
  refresh: () => void;
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeVisibility: (() => void) | null = null;
  /** Bumped by `stop()` so a response that lands afterwards is discarded. */
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
    if (stopped || intervalMs <= 0) return;
    timer = setTimeout(() => {
      timer = null;
      if (!isVisible()) {
        // Hidden: do not spend a request, but keep the loop alive so the tab
        // resumes on its own even if `visibilitychange` never fires.
        emit({ paused: true });
        schedule();
        return;
      }
      void attempt();
    }, intervalMs);
  }

  async function attempt(): Promise<void> {
    // Overlap suppression: a tick that arrives while the previous request is
    // still open is dropped, never queued. Queuing would turn a slow API into
    // an ever-growing pile of identical in-flight requests.
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
      // Data is deliberately retained: a frozen table beats a blank screen
      // during a blip. `stale` is what stops it from reading as live.
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
        // Becoming visible again: refresh immediately instead of waiting out
        // the remainder of an interval the operator cannot see ticking.
        emit({ paused: false });
        clearTimer();
        void attempt();
      });
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
  };
}
