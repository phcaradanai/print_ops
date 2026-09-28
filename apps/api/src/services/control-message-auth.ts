import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedControlMessage<T> {
  payload: T;
  signature: string;
}

const tokenHashPattern = /^[a-f\d]{64}$/i;
const signaturePattern = /^[a-f\d]{64}$/i;

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export function signControlMessage<T>(tokenHash: string, payload: T): SignedControlMessage<T> {
  if (!tokenHashPattern.test(tokenHash)) throw new Error('device token hash must be a SHA-256 hex digest');
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error('control payload must be JSON serializable');
  const key = Buffer.from(tokenHash, 'hex');
  return {
    payload,
    signature: createHmac('sha256', key).update(serialized).digest('hex'),
  };
}

export function signControlMessageWithToken<T>(token: string, payload: T): SignedControlMessage<T> {
  return signControlMessage(hashDeviceToken(token), payload);
}

export function verifyControlMessage<T>(tokenHash: string, payload: T, signature: string): boolean {
  if (!tokenHashPattern.test(tokenHash) || !signaturePattern.test(signature)) return false;
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) return false;
  const expected = createHmac('sha256', Buffer.from(tokenHash, 'hex')).update(serialized).digest();
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyControlMessageWithToken<T>(token: string, payload: T, signature: string): boolean {
  return verifyControlMessage(hashDeviceToken(token), payload, signature);
}
