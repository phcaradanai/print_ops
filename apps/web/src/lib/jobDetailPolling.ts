const TERMINAL_PRINT_STATUSES = new Set([
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'UNVERIFIED',
  'CANCELLED',
]);

const TERMINAL_DELIVERY_STATUSES = new Set(['DELIVERED', 'FAILED']);

export interface JobDetailPollingInput {
  printStatus?: string;
  callbackEnabled?: boolean;
  expectedDeliveryCount?: number;
  deliveryStatuses: string[];
}

/**
 * Decide whether the live Job Detail resources still need automatic polling.
 * Manual refresh remains available after this returns false.
 */
export function shouldPollJobDetail(input: JobDetailPollingInput): boolean {
  if (!input.printStatus || !TERMINAL_PRINT_STATUSES.has(input.printStatus)) return true;
  if (input.callbackEnabled !== true) return false;

  const expected = Math.max(0, input.expectedDeliveryCount ?? 0);
  if (input.deliveryStatuses.length === 0) return true;
  if (expected > input.deliveryStatuses.length) return true;

  return input.deliveryStatuses.some((status) => !TERMINAL_DELIVERY_STATUSES.has(status));
}
