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

const JOB_MIRROR_CREDENTIAL_LABEL = 'printops.job-mirror.v1';

/**
 * Credential a control plane presents to read this device's job mirror.
 *
 * The control plane only ever stores the SHA-256 of a device token, and the station
 * only ever holds the token itself, so neither can send the other's secret. Both can
 * derive the same value from the hash instead, which is what lets a control plane pull
 * from *any* enrolled station without a configured shared secret and without knowing
 * which stations exist in advance.
 */
export function deriveJobMirrorCredential(tokenHash: string, deviceId: string): string {
  if (!tokenHashPattern.test(tokenHash)) throw new Error('device token hash must be a SHA-256 hex digest');
  if (!deviceId.trim()) throw new Error('device id is required to derive the job mirror credential');
  return createHmac('sha256', Buffer.from(tokenHash, 'hex'))
    .update(`${JOB_MIRROR_CREDENTIAL_LABEL}.${deviceId.trim()}`)
    .digest('hex');
}

export function deriveJobMirrorCredentialFromToken(token: string, deviceId: string): string {
  return deriveJobMirrorCredential(hashDeviceToken(token), deviceId);
}
