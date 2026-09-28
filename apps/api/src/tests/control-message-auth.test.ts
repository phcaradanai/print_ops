import { describe, expect, it } from 'vitest';
import {
  hashDeviceToken,
  signControlMessage,
  signControlMessageWithToken,
  verifyControlMessage,
  verifyControlMessageWithToken,
} from '../services/control-message-auth.js';

describe('device-bound control message signatures', () => {
  it('verifies a signed payload after the same JSON transport round trip', () => {
    const token = 'devtok_native_acceptance_secret';
    const payload = {
      command_id: 'cmd_001',
      device_id: 'dev_001',
      target_version: '0.1.29',
      expires_at: '2026-09-25T12:00:00.000Z',
    };
    const signed = signControlMessageWithToken(token, payload);
    const transported = JSON.parse(JSON.stringify(signed)) as typeof signed;

    expect(verifyControlMessageWithToken(token, transported.payload, transported.signature)).toBe(true);
    expect(verifyControlMessage(hashDeviceToken(token), transported.payload, transported.signature)).toBe(true);
  });

  it('rejects a changed payload, another device token, or a malformed signature', () => {
    const token = 'devtok_native_acceptance_secret';
    const payload = { deviceId: 'dev_001', state: 'COMPLETED' };
    const signed = signControlMessageWithToken(token, payload);

    expect(verifyControlMessageWithToken(token, { ...payload, deviceId: 'dev_002' }, signed.signature)).toBe(false);
    expect(verifyControlMessageWithToken('devtok_other_device', payload, signed.signature)).toBe(false);
    expect(verifyControlMessageWithToken(token, payload, 'not-a-signature')).toBe(false);
  });

  it('refuses to sign with an invalid stored token hash', () => {
    expect(() => signControlMessage('hash123', { command_id: 'cmd_001' }))
      .toThrow('device token hash must be a SHA-256 hex digest');
  });
});
