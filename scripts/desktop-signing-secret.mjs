import { spawnSync } from 'node:child_process';
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  deriveOtaSigningKeys,
  resolveOtaPublicKey,
  withoutOtaSigningSecret,
} from './ota-signing.cjs';

const STORE_HEADER = 'PRINTOPS-DPAPI-CURRENT-USER-V1\n';
const MAX_STORE_BYTES = 64 * 1024;
const DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$inputBytes = $null
$outputBytes = $null
$failed = $false
try {
  Add-Type -AssemblyName System.Security -ErrorAction Stop | Out-Null
  $encodedInput = [Console]::In.ReadToEnd().Trim()
  $inputBytes = [Convert]::FromBase64String($encodedInput)
  __DPAPI_OPERATION__
  [Console]::Out.Write([Convert]::ToBase64String($outputBytes))
} catch {
  [Console]::Error.WriteLine('DPAPI operation failed.')
  $failed = $true
} finally {
  if ($inputBytes -ne $null) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
  if ($outputBytes -ne $null) { [Array]::Clear($outputBytes, 0, $outputBytes.Length) }
  $encodedInput = $null
}
if ($failed) { exit 1 }
`;

function canonicalBase64Bytes(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('The local desktop signing-secret store is malformed; it was not replaced.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    bytes.fill(0);
    throw new Error('The local desktop signing-secret store is malformed; it was not replaced.');
  }
  return bytes;
}

function runDpapi(operation, inputBytes, env) {
  if (process.platform !== 'win32') {
    throw new Error(
      'Automatic desktop signing-secret storage requires Windows current-user DPAPI; set PRINTOPS_OTA_SECRET explicitly on non-Windows hosts.',
    );
  }

  const method = operation === 'protect' ? 'Protect' : 'Unprotect';
  const operationStatement = `$outputBytes = [System.Security.Cryptography.ProtectedData]::${method}(` +
    '$inputBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)';
  const script = DPAPI_SCRIPT.replace('__DPAPI_OPERATION__', operationStatement);
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: withoutOtaSigningSecret(env),
      input: inputBytes.toString('base64'),
      encoding: 'ascii',
      maxBuffer: 256 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    const action = operation === 'protect' ? 'protect' : 'decrypt';
    throw new Error(`Windows DPAPI could not ${action} the desktop signing secret.`);
  }

  const encodedOutput = typeof result.stdout === 'string' ? result.stdout : '';
  try {
    const outputBytes = canonicalBase64Bytes(encodedOutput);
    outputBytes.fill(0);
  } catch {
    throw new Error('Windows DPAPI returned an invalid desktop signing-secret result.');
  }
  return encodedOutput;
}

function readPinnedPublicKey(root) {
  const keyPath = resolve(root, 'apps', 'desktop', 'src-tauri', 'resources', 'ota-public-key.txt');
  let value;
  try {
    value = readFileSync(keyPath, 'utf8').trim();
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw new Error('Could not read the pinned OTA public key; desktop signing was not changed.');
  }
  return value;
}

function validateAgainstPinnedKey(secret, previousPublicKey, source) {
  let signingKeys;
  try {
    signingKeys = deriveOtaSigningKeys(secret);
  } catch {
    throw new Error('The desktop signing secret is invalid or could not derive its Ed25519 key.');
  }

  try {
    resolveOtaPublicKey({
      previousPublicKey,
      derivedPublicKey: signingKeys.publicKeyPem,
    });
  } catch (error) {
    if (error?.message?.includes('changes the pinned OTA key')) {
      if (source === 'environment') {
        throw new Error(
          'PRINTOPS_OTA_SECRET changes the pinned OTA key; preserve the existing secret or perform an explicit key rotation.',
        );
      }
      throw new Error(
        'The saved desktop signing secret does not match the pinned OTA public key; the store was not replaced.',
      );
    }
    throw new Error('The pinned OTA public key is invalid; desktop signing was not changed.');
  }
  return secret;
}

function storePathFromEnvironment(env) {
  const localAppData = env.LOCALAPPDATA;
  if (typeof localAppData !== 'string' || localAppData.length === 0 || !isAbsolute(localAppData)) {
    throw new Error('LOCALAPPDATA must be an absolute path to use the local desktop signing-secret store.');
  }
  return join(localAppData, 'PrintOps', 'build', 'ota-signing-secret.dpapi');
}

function readStoredCiphertext(storePath) {
  let stat;
  try {
    stat = statSync(storePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Could not access the local desktop signing-secret store; it was not changed.');
  }
  if (!stat.isFile() || stat.size > MAX_STORE_BYTES) {
    throw new Error('The local desktop signing-secret store is malformed; it was not replaced.');
  }

  let content;
  try {
    content = readFileSync(storePath, 'utf8');
  } catch {
    throw new Error('Could not read the local desktop signing-secret store; it was not changed.');
  }
  const match = new RegExp(`^${STORE_HEADER}([A-Za-z0-9+/]+={0,2})\\n$`).exec(content);
  if (!match) {
    throw new Error('The local desktop signing-secret store is malformed; it was not replaced.');
  }
  canonicalBase64Bytes(match[1]).fill(0);
  return match[1];
}

function decodeStoredSecret(ciphertext, env) {
  const ciphertextBytes = canonicalBase64Bytes(ciphertext);
  if (process.platform !== 'win32') {
    ciphertextBytes.fill(0);
    throw new Error(
      'Automatic desktop signing-secret storage requires Windows current-user DPAPI; set PRINTOPS_OTA_SECRET explicitly on non-Windows hosts.',
    );
  }
  let encodedSecret;
  try {
    encodedSecret = runDpapi('unprotect', ciphertextBytes, env);
  } catch {
    throw new Error(
      'The saved desktop signing secret could not be decrypted by this Windows account. DPAPI stores are bound to the creating Windows user; restore an encrypted backup under that account. The store was not replaced.',
    );
  } finally {
    ciphertextBytes.fill(0);
  }

  const secretBytes = canonicalBase64Bytes(encodedSecret);
  try {
    const secret = new TextDecoder('utf-8', { fatal: true }).decode(secretBytes).trim();
    if (!secret) {
      throw new Error('empty');
    }
    return secret;
  } catch {
    throw new Error(
      'The saved desktop signing secret is malformed. Restore an encrypted backup under the Windows account that created it; the store was not replaced.',
    );
  } finally {
    secretBytes.fill(0);
  }
}

function protectSecret(secret, env) {
  const secretBytes = Buffer.from(secret, 'utf8');
  try {
    return runDpapi('protect', secretBytes, env);
  } catch {
    throw new Error('Windows DPAPI could not protect the desktop signing secret; no store was replaced.');
  } finally {
    secretBytes.fill(0);
  }
}

function writeStoreExclusively(storePath, ciphertext) {
  const directory = dirname(storePath);
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    throw new Error('Could not create the local desktop signing-secret directory; no store was replaced.');
  }

  const temporaryPath = join(directory, `.${basename(storePath)}.${randomUUID()}.tmp`);
  const content = Buffer.from(`${STORE_HEADER}${ciphertext}\n`, 'ascii');
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      linkSync(temporaryPath, storePath);
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    }
  } catch {
    throw new Error('Could not safely create the local desktop signing-secret store; an existing store was not replaced.');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
    try { unlinkSync(temporaryPath); } catch {}
    content.fill(0);
  }
}

/**
 * Resolve the desktop signing secret from an explicit process/CI override or
 * the current Windows user's DPAPI-protected local store.
 */
export function resolveDesktopSigningSecret({ root, env = process.env } = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('A repository root is required to resolve the desktop signing secret.');
  }
  const previousPublicKey = readPinnedPublicKey(root);
  const environmentSecret = env.PRINTOPS_OTA_SECRET;
  if (typeof environmentSecret === 'string' && environmentSecret.trim() !== '') {
    return validateAgainstPinnedKey(environmentSecret.trim(), previousPublicKey, 'environment');
  }

  if (process.platform !== 'win32') {
    throw new Error(
      'Automatic desktop signing-secret storage requires Windows current-user DPAPI; set PRINTOPS_OTA_SECRET explicitly on non-Windows hosts.',
    );
  }
  const storePath = storePathFromEnvironment(env);
  const ciphertext = readStoredCiphertext(storePath);
  if (ciphertext !== null) {
    const secret = decodeStoredSecret(ciphertext, env);
    return validateAgainstPinnedKey(secret, previousPublicKey, 'store');
  }

  if (previousPublicKey && previousPublicKey !== 'unconfigured') {
    throw new Error(
      'A pinned OTA public key exists but the local desktop signing secret is missing; provide the original PRINTOPS_OTA_SECRET explicitly. The key was not regenerated.',
    );
  }

  const generatedSecret = randomBytes(32).toString('hex');
  validateAgainstPinnedKey(generatedSecret, previousPublicKey, 'store');
  const protectedCiphertext = protectSecret(generatedSecret, env);
  if (writeStoreExclusively(storePath, protectedCiphertext)) {
    return generatedSecret;
  }

  const winningCiphertext = readStoredCiphertext(storePath);
  if (winningCiphertext === null) {
    throw new Error('A competing desktop signing-secret store could not be read; no store was replaced.');
  }
  const winningSecret = decodeStoredSecret(winningCiphertext, env);
  return validateAgainstPinnedKey(winningSecret, previousPublicKey, 'store');
}
