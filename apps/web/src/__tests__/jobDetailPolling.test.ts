import { describe, expect, it } from 'vitest';
import { shouldPollJobDetail } from '../lib/jobDetailPolling.js';

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
