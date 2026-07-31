import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const KEY_LENGTH = 64;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export type PasswordValidation = { valid: true } | { valid: false; error: string };

function derive(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export function validatePassword(password: string): PasswordValidation {
  if (password.length < 12) return { valid: false, error: 'Password must be at least 12 characters' };
  if (password.length > 128) return { valid: false, error: 'Password must be at most 128 characters' };
  if (!/[a-z]/.test(password)) return { valid: false, error: 'Password must include a lowercase letter' };
  if (!/[A-Z]/.test(password)) return { valid: false, error: 'Password must include an uppercase letter' };
  if (!/[0-9]/.test(password)) return { valid: false, error: 'Password must include a number' };
  if (!/[^A-Za-z0-9]/.test(password)) return { valid: false, error: 'Password must include a symbol' };
  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  const validation = validatePassword(password);
  if (!validation.valid) throw new Error(validation.error);
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_LENGTH);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string | undefined): Promise<boolean> {
  if (!encoded) return false;
  const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw] = encoded.split('$');
  if (algorithm !== 'scrypt' || !nRaw || !rRaw || !pRaw || !saltRaw || !hashRaw) return false;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
  try {
    const expected = Buffer.from(hashRaw, 'base64url');
    const derived = await derive(password, Buffer.from(saltRaw, 'base64url'), expected.length);
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}
