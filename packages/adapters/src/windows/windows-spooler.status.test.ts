import { describe, it, expect } from 'vitest';
import { parseJobFlags, isBlockedStatus, isFinishedStatus } from './windows-spooler.adapter.js';

describe('parseJobFlags', () => {
  it('splits a flags enum into its individual names', () => {
    expect(parseJobFlags('Printing, Retained')).toEqual(new Set(['printing', 'retained']));
  });

  it('yields no known flag for a numeric enum value', () => {
    // ConvertTo-Json emits JobStatus as a number when it is not cast to string.
    expect(parseJobFlags(4224).size).toBe(0);
  });

  it('never reads an unusable value as finished or blocked', () => {
    for (const value of [4224, null, undefined, '']) {
      expect(isFinishedStatus(value)).toBe(false);
      expect(isBlockedStatus(value)).toBe(false);
    }
  });
});

describe('isBlockedStatus', () => {
  it.each([
    'Error',
    'Error, Printing',
    'Error, Retained',
    'Offline',
    'PaperOut, Printing',
    'Paused',
    'Deleting',
    'UserIntervention, Printing',
  ])('treats %s as blocked', (status) => {
    expect(isBlockedStatus(status)).toBe(true);
  });

  it.each(['Printing', 'Retained', 'Printed', 'Spooling'])('does not block on %s', (status) => {
    expect(isBlockedStatus(status)).toBe(false);
  });
});

describe('isFinishedStatus', () => {
  it.each(['Printed', 'Retained', 'Printed, Retained', 'Completed'])(
    'accepts %s as spooler-finished',
    (status) => {
      expect(isFinishedStatus(status)).toBe(true);
    },
  );

  it('rejects Printing, Retained — the job is still going', () => {
    // The exact status that was once reported as "Job completed" for a print
    // that never produced paper.
    expect(isFinishedStatus('Printing, Retained')).toBe(false);
  });

  it('rejects a retained job that also carries an error flag', () => {
    expect(isFinishedStatus('Error, Retained')).toBe(false);
  });

  it.each(['Printing', 'Spooling', 'Restarting', 'Error', 4224])(
    'rejects %s',
    (status) => {
      expect(isFinishedStatus(status)).toBe(false);
    },
  );
});
