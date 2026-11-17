import { describe, expect, it } from 'vitest';
import {
  canRemoveRunner,
  isRunnerTerminated,
  usableRunnerCount,
} from '../lib/runnerLifecycle.js';

const active = { id: 'runner-a', metadata: {} };
const other = { id: 'runner-b', metadata: {} };
const terminated = { id: 'runner-c', metadata: { terminated: true } };

describe('runner lifecycle helpers', () => {
  it('reads the tombstone flag defensively', () => {
    expect(isRunnerTerminated(terminated)).toBe(true);
    expect(isRunnerTerminated(active)).toBe(false);
    expect(isRunnerTerminated({ id: 'x' })).toBe(false);
    expect(isRunnerTerminated({ id: 'x', metadata: null })).toBe(false);
    expect(isRunnerTerminated(null)).toBe(false);
    expect(isRunnerTerminated(undefined)).toBe(false);
    // Only the boolean flag counts; a string "true" is not what the API writes.
    expect(isRunnerTerminated({ id: 'x', metadata: { terminated: 'true' } })).toBe(false);
  });

  it('counts only runners that can still claim work', () => {
    expect(usableRunnerCount([])).toBe(0);
    expect(usableRunnerCount([active])).toBe(1);
    expect(usableRunnerCount([active, other, terminated])).toBe(2);
    expect(usableRunnerCount([terminated])).toBe(0);
  });

  it('never offers removing the last usable runner', () => {
    expect(canRemoveRunner([active], active)).toBe(false);
    expect(canRemoveRunner([active, terminated], active)).toBe(false);
    expect(canRemoveRunner([active, other], active)).toBe(true);
  });

  it('always allows deleting a terminated tombstone, so a host can register again', () => {
    expect(canRemoveRunner([terminated], terminated)).toBe(true);
    expect(canRemoveRunner([active, terminated], terminated)).toBe(true);
  });
});
