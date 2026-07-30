import { describe, expect, it } from 'vitest';
import { shouldPollJobDetail } from '../lib/jobDetailPolling.js';
import { jobDetailPollingInput } from '../pages/JobDetail.js';

describe('shouldPollJobDetail', () => {
  it('continues while the print job is active', () => {
    expect(shouldPollJobDetail({
      printStatus: 'PRINTING',
      callbackEnabled: false,
      deliveryStatuses: [],
    })).toBe(true);
  });

  it('stops after a terminal print when callbacks are disabled', () => {
    expect(shouldPollJobDetail({
      printStatus: 'SUCCESS',
      callbackEnabled: false,
      deliveryStatuses: [],
    })).toBe(false);
  });

  it('continues while an enabled callback has not created its delivery yet', () => {
    expect(shouldPollJobDetail({
      printStatus: 'FAILED',
      callbackEnabled: true,
      expectedDeliveryCount: 1,
      deliveryStatuses: [],
    })).toBe(true);
  });

  it('continues while any callback delivery remains non-terminal', () => {
    expect(shouldPollJobDetail({
      printStatus: 'UNVERIFIED',
      callbackEnabled: true,
      expectedDeliveryCount: 2,
      deliveryStatuses: ['DELIVERED', 'RETRY_SCHEDULED'],
    })).toBe(true);
  });

  it('stops when the print and all expected callback deliveries are terminal', () => {
    expect(shouldPollJobDetail({
      printStatus: 'TIMEOUT',
      callbackEnabled: true,
      expectedDeliveryCount: 2,
      deliveryStatuses: ['DELIVERED', 'FAILED'],
    })).toBe(false);
  });

  it('keeps polling when an expected transport has no delivery record yet', () => {
    expect(shouldPollJobDetail({
      printStatus: 'CANCELLED',
      callbackEnabled: true,
      expectedDeliveryCount: 2,
      deliveryStatuses: ['DELIVERED'],
    })).toBe(true);
  });
});

/**
 * What the Job Detail page actually feeds the policy. The policy above can only
 * be right if the mapping is: `transports` is the intent, `deliveries` is the
 * outcome, and confusing the two is how a job would stop polling before its
 * callback resolved.
 */
describe('jobDetailPollingInput', () => {
  const decide = (
    job: Parameters<typeof jobDetailPollingInput>[0],
    deliveries: Parameters<typeof jobDetailPollingInput>[1] = [],
  ) => shouldPollJobDetail(jobDetailPollingInput(job, deliveries));

  it('treats a job that has not loaded as still live', () => {
    expect(jobDetailPollingInput(null, []).printStatus).toBeUndefined();
    expect(decide(null)).toBe(true);
  });

  it('takes the expected delivery count from the intended transports', () => {
    const input = jobDetailPollingInput(
      { status: 'SUCCESS', metadata: { callbackIntent: { enabled: true, transports: ['HTTP', 'NATS'] } } },
      [{ deliveryStatus: 'DELIVERED' }],
    );
    expect(input.expectedDeliveryCount).toBe(2);
    expect(input.deliveryStatuses).toEqual(['DELIVERED']);
    // One of two transports delivered: the other has not reported yet.
    expect(shouldPollJobDetail(input)).toBe(true);
  });

  it('keeps polling a terminal print whose callback is still retrying', () => {
    expect(decide(
      { status: 'SUCCESS', metadata: { callbackIntent: { enabled: true, transports: ['HTTP'] } } },
      [{ deliveryStatus: 'RETRY_SCHEDULED' }],
    )).toBe(true);
  });

  it('stops a terminal print whose only delivery is terminal', () => {
    expect(decide(
      { status: 'SUCCESS', metadata: { callbackIntent: { enabled: true, transports: ['HTTP'] } } },
      [{ deliveryStatus: 'FAILED' }],
    )).toBe(false);
  });

  it('stops a terminal print with callbacks disabled', () => {
    expect(decide({
      status: 'FAILED',
      metadata: { callbackIntent: { enabled: false, disabledReason: 'no endpoint bound' } },
    })).toBe(false);
  });

  it('stops a terminal print with no callback intent recorded at all', () => {
    // `callbackEnabled` is undefined, which the policy treats as "not enabled".
    expect(decide({ status: 'SUCCESS', metadata: {} })).toBe(false);
    expect(decide({ status: 'SUCCESS' })).toBe(false);
  });

  it('keeps polling an enabled callback that has produced no delivery row yet', () => {
    expect(decide(
      { status: 'SUCCESS', metadata: { callbackIntent: { enabled: true, transports: ['HTTP'] } } },
      [],
    )).toBe(true);
  });
});
