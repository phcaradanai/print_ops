/**
 * Thin progress line pinned to the top of the window.
 *
 * Shows for every user-visible operation reported to `lib/activity.ts`:
 * first page loads, manual refreshes and all mutations, in the PrintOps app
 * and in Web Control alike. Background polling is never reported, so the bar
 * only moves when the operator did something (or a page is opening).
 *
 * - waits 150 ms before appearing, so fast requests do not flicker;
 * - creeps toward ~85 % while work is in flight (it cannot know the real
 *   fraction), then fills to 100 % and fades;
 * - a finished mutation flashes green (success) or red (failed), even when it
 *   was too fast for the creeping bar to appear.
 *
 * Purely visual (aria-hidden): buttons carry aria-busy and LoadingState is a
 * role="status" region, so assistive tech already hears the same state.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getActivitySnapshot, subscribeActivity } from '../lib/activity.js';
import './ActivityBar.css';

type Phase = 'idle' | 'running' | 'finishing';
type Tone = 'load' | 'mutate' | 'success' | 'error';

const SHOW_DELAY_MS = 150;
const FINISH_MS = 650;

export function ActivityBar() {
  const activity = useSyncExternalStore(subscribeActivity, getActivitySnapshot, getActivitySnapshot);
  const [phase, setPhase] = useState<Phase>('idle');
  const [tone, setTone] = useState<Tone>('load');
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeq = useRef(activity.outcomeSeq);

  // Start / stop the creeping bar.
  useEffect(() => {
    if (activity.active > 0) {
      if (finishTimer.current) {
        clearTimeout(finishTimer.current);
        finishTimer.current = null;
      }
      setTone(activity.mutating ? 'mutate' : 'load');
      if (phase !== 'running' && !showTimer.current) {
        showTimer.current = setTimeout(() => {
          showTimer.current = null;
          setPhase('running');
        }, SHOW_DELAY_MS);
      }
      return;
    }
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (phase === 'running') finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.active, activity.mutating]);

  // Outcome flash for every finished mutation.
  useEffect(() => {
    if (activity.outcomeSeq === lastSeq.current) return;
    lastSeq.current = activity.outcomeSeq;
    if (activity.lastOutcome) setTone(activity.lastOutcome);
    if (activity.active === 0) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.outcomeSeq]);

  useEffect(() => () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (finishTimer.current) clearTimeout(finishTimer.current);
  }, []);

  function finish() {
    setPhase('finishing');
    if (finishTimer.current) clearTimeout(finishTimer.current);
    finishTimer.current = setTimeout(() => {
      finishTimer.current = null;
      setPhase('idle');
    }, FINISH_MS);
  }

  return (
    <div
      className="activity-bar"
      data-phase={phase}
      data-tone={tone}
      aria-hidden="true"
    >
      <div className="activity-bar__fill" />
    </div>
  );
}
