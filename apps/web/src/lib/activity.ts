/**
 * App-wide "something is happening" signal for the top activity bar.
 *
 * Framework-free so `api/client.ts` and `lib/pollController.ts` can report
 * into it without React. Only user-visible work is tracked: first loads,
 * manual refreshes, and every mutating request. Background polling ticks are
 * deliberately NOT tracked, otherwise the bar would pulse every few seconds
 * on the dashboard and stop meaning anything.
 */

export type ActivityKind = 'load' | 'mutate';
export type ActivityOutcome = 'success' | 'error';

export interface ActivitySnapshot {
  /** Number of tracked operations still in flight. */
  active: number;
  /** True while at least one mutation is in flight (bar uses a stronger tone). */
  mutating: boolean;
  /** Outcome of the most recently finished mutation, for the completion flash. */
  lastOutcome: ActivityOutcome | null;
  /** Increments on every finished mutation so repeated outcomes re-trigger. */
  outcomeSeq: number;
}

type Listener = () => void;

let loads = 0;
let mutations = 0;
let snapshot: ActivitySnapshot = { active: 0, mutating: false, lastOutcome: null, outcomeSeq: 0 };
const listeners = new Set<Listener>();

function publish(patch: Partial<ActivitySnapshot> = {}): void {
  snapshot = {
    ...snapshot,
    ...patch,
    active: loads + mutations,
    mutating: mutations > 0,
  };
  for (const listener of [...listeners]) listener();
}

/**
 * Marks the start of a tracked operation. Call the returned function exactly
 * once when it settles; extra calls are ignored so a `finally` plus an early
 * return cannot drive the counter negative.
 */
export function beginActivity(kind: ActivityKind): (outcome?: ActivityOutcome) => void {
  if (kind === 'mutate') mutations += 1;
  else loads += 1;
  publish();

  let done = false;
  return (outcome = 'success') => {
    if (done) return;
    done = true;
    if (kind === 'mutate') {
      mutations = Math.max(0, mutations - 1);
      publish({ lastOutcome: outcome, outcomeSeq: snapshot.outcomeSeq + 1 });
    } else {
      loads = Math.max(0, loads - 1);
      publish();
    }
  };
}

/** Tracks a promise for its whole lifetime and passes it through unchanged. */
export function trackActivity<T>(kind: ActivityKind, work: Promise<T>): Promise<T> {
  const end = beginActivity(kind);
  work.then(() => end('success'), () => end('error'));
  return work;
}

export function subscribeActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActivitySnapshot(): ActivitySnapshot {
  return snapshot;
}
