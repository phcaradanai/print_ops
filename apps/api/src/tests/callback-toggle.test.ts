/**
 * The `callbackOnPrintResult` contract, stated once.
 *
 * Before this, the flag was persisted and shown in the Webhooks UI but read by
 * no dispatch code: the terminal callback fired unconditionally, and the
 * acceptance callback fired only when a caller resent a request_id it had
 * already used. Neither half of docs/architecture/result-callbacks.md §1 was
 * what the code did.
 */

import { describe, it, expect } from 'vitest';
import type { WebhookEndpoint } from '@printerops/domain';
import {
  buildCallbackIntent,
  wantsAcceptanceCallback,
  wantsTerminalCallback,
} from '../services/callback-intent.service.js';

function endpoint(over: Partial<WebhookEndpoint>): WebhookEndpoint {
  return {
    id: 'ep-1', endpointCode: 'dev-intake', name: 'Dev', sourceSystem: 'sys',
    authMode: 'NONE', enabled: true, routePolicyId: 'rp-1',
    callbackTransport: 'HTTP', callbackUrl: 'https://receiver.example/cb',
    callbackOnPrintResult: false, ...over,
  } as WebhookEndpoint;
}

describe('callbackOnPrintResult decides which callback fires', () => {
  it('off: acceptance fires, terminal does not', () => {
    const ep = endpoint({ callbackOnPrintResult: false });
    expect(wantsAcceptanceCallback(ep, false)).toBe(true);
    expect(wantsTerminalCallback(ep)).toBe(false);
    expect(buildCallbackIntent(ep, {}).enabled).toBe(false);
  });

  it('unset behaves as off — the backward-compatible default', () => {
    const ep = endpoint({ callbackOnPrintResult: undefined });
    expect(wantsAcceptanceCallback(ep, false)).toBe(true);
    expect(wantsTerminalCallback(ep)).toBe(false);
  });

  it('on: terminal fires, acceptance does not', () => {
    const ep = endpoint({ callbackOnPrintResult: true });
    expect(wantsAcceptanceCallback(ep, false)).toBe(false);
    expect(wantsTerminalCallback(ep)).toBe(true);
    expect(buildCallbackIntent(ep, {}).enabled).toBe(true);
  });

  it('a duplicate always gets the acceptance notification, whatever the toggle says', () => {
    // It creates no new print, so it can never reach a terminal state. Staying
    // silent would leave the caller with nothing at all.
    expect(wantsAcceptanceCallback(endpoint({ callbackOnPrintResult: true }), true)).toBe(true);
    expect(wantsAcceptanceCallback(endpoint({ callbackOnPrintResult: false }), true)).toBe(true);
  });

  it('transport NONE means no callback of either kind', () => {
    const ep = endpoint({ callbackTransport: 'NONE', callbackOnPrintResult: false });
    expect(wantsAcceptanceCallback(ep, false)).toBe(false);
    expect(wantsAcceptanceCallback(ep, true)).toBe(false);
    expect(buildCallbackIntent(ep, {}).enabled).toBe(false);
  });

  it('records the destination and the reason on an acceptance-mode intent', () => {
    // Job Detail must be able to say WHY no result was delivered, and where it
    // would have gone — a blank is indistinguishable from a bug.
    const intent = buildCallbackIntent(endpoint({ callbackOnPrintResult: false }), {});
    expect(intent.enabled).toBe(false);
    expect(intent.httpUrl).toBe('https://receiver.example/cb');
    expect(intent.disabledReason).toContain('callbackOnPrintResult is off');
  });

  it('reports an unresolvable destination separately from the toggle', () => {
    const intent = buildCallbackIntent(
      endpoint({ callbackOnPrintResult: true, callbackUrl: '$.reply_url' }),
      {},
    );
    expect(intent.enabled).toBe(false);
    expect(intent.disabledReason).toContain('no destination could be resolved');
  });
});
