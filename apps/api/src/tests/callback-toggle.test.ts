/**
 * The `callbackOnPrintResult` contract, stated once.
 *
 * Before this, the flag was persisted and shown in the Webhooks UI but read by
 * no dispatch code: the terminal callback fired unconditionally, and the
 * acceptance callback fired only when a caller resent a request_id it had
 * already used. Neither half of docs/architecture/result-callbacks.md §1 was
 * what the code did.
 *
 * Current contract: the terminal-result callback fires for EVERY job that has
 * a resolvable callback destination. `callbackOnPrintResult` only decides
 * whether the ACCEPTANCE callback also fires:
 *   - off (default): acceptance + terminal both fire
 *   - on: terminal only (except duplicates, which always get acceptance)
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
  it('off: the terminal result still fires (and the acceptance callback too)', () => {
    const ep = endpoint({ callbackOnPrintResult: false });
    expect(wantsAcceptanceCallback(ep, false)).toBe(true);
    expect(wantsTerminalCallback(ep)).toBe(false);
    // The job has a resolvable destination, so its terminal result MUST be
    // delivered even though the endpoint is in acceptance mode.
    expect(buildCallbackIntent(ep, {}).enabled).toBe(true);
  });

  it('unset behaves as off — the backward-compatible default', () => {
    const ep = endpoint({ callbackOnPrintResult: undefined });
    expect(wantsAcceptanceCallback(ep, false)).toBe(true);
    expect(wantsTerminalCallback(ep)).toBe(false);
    expect(buildCallbackIntent(ep, {}).enabled).toBe(true);
  });

  it('snapshots the payload template into the intent so the terminal callback can shape itself', () => {
    const template = { event_type: '$$.event_type', label: '$.label' };
    const intent = buildCallbackIntent(endpoint({ callbackPayloadTemplate: template }), {});
    expect(intent.payloadTemplate).toEqual(template);
    // A disabled transport still keeps the template if one was configured? No:
    // no destination -> disabled intent, and the template is irrelevant.
    expect(buildCallbackIntent(endpoint({ callbackTransport: 'NONE', callbackPayloadTemplate: template }), {}).payloadTemplate).toBeUndefined();
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

  it('records the destination on an acceptance-mode intent so Job Detail can show it', () => {
    const intent = buildCallbackIntent(endpoint({ callbackOnPrintResult: false }), {});
    expect(intent.enabled).toBe(true);
    expect(intent.httpUrl).toBe('https://receiver.example/cb');
    expect(intent.disabledReason).toBeUndefined();
  });

  it('reports an unresolvable destination as the only reason for a disabled intent', () => {
    const intent = buildCallbackIntent(
      endpoint({ callbackOnPrintResult: true, callbackUrl: '$.reply_url' }),
      {},
    );
    expect(intent.enabled).toBe(false);
    expect(intent.disabledReason).toContain('no destination could be resolved');
  });
});
