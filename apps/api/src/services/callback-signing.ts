import { createHmac, timingSafeEqual } from 'node:crypto';

export const CALLBACK_SIGNATURE_VERSION = 'v1';

export function callbackSigningSecret(ref: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = `PRINTOPS_CALLBACK_SECRET_${ref.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`;
  const secret = env[key];
  if (!secret) throw new Error(`callback signing secret reference '${ref}' is not configured`);
  return secret;
}

export function signCallback(rawBody: string, timestamp: string, secret: string): string {
  return `${CALLBACK_SIGNATURE_VERSION}=${createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex')}`;
}

export function verifyCallbackSignature(input: {
  rawBody: string;
  timestamp: string;
  signature?: string;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!input.signature) return false;
  const timestampMs = Number(input.timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) return false;
  const toleranceMs = (input.toleranceSeconds ?? 300) * 1000;
  if (Math.abs((input.now ?? Date.now()) - timestampMs) > toleranceMs) return false;
  const expected = Buffer.from(signCallback(input.rawBody, input.timestamp, input.secret));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
