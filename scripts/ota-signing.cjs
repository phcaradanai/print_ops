'use strict';

const {
  createPrivateKey,
  createPublicKey,
  scryptSync,
  timingSafeEqual,
} = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const OTA_ENV_KEYS = new Set([
  'PRINTOPS_OTA_REQUIRE_SIGNATURE',
  'PRINTOPS_OTA_MIN_SUPPORTED_VERSION',
  'PRINTOPS_DB_SCHEMA_VERSION',
  'PRINTOPS_OTA_CHANNEL',
  'PRINTOPS_OTA_ROLLOUT_PERCENTAGE',
  'PRINTOPS_OTA_RELEASE_NOTES',
]);
const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_RAW_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const KDF_SALT = Buffer.from('printops-ota-ed25519-signing-v1', 'utf8');
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function parseEnvValue(name, rawValue) {
  const value = rawValue.trim();
  if (!value) return '';

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    if (value[value.length - 1] !== quote) {
      throw new Error(`.env value for ${name} must be a single-line quoted value`);
    }
    const body = value.slice(1, -1);
    return quote === '"'
      ? body.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : body;
  }

  return value.replace(/\s+#.*$/, '').trim();
}

function assertNoLocalOtaSigningSecret(root, sourceText) {
  const envPath = join(root, '.env');
  if (sourceText === undefined && !existsSync(envPath)) return;
  const text = sourceText ?? readFileSync(envPath, 'utf8');
  if (text.split(/\r?\n/).some((line) => /^\s*(?:#\s*)?(?:export\s+)?PRINTOPS_OTA_SECRET\s*=/i.test(line))) {
    throw new Error(
      'PRINTOPS_OTA_SECRET must come from the process environment or a CI secret store; do not store it in the workspace .env file',
    );
  }
}

function readLocalOtaEnv(root) {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return {};

  const values = {};
  const text = readFileSync(envPath, 'utf8');
  assertNoLocalOtaSigningSecret(root, text);
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || !OTA_ENV_KEYS.has(match[1])) continue;
    values[match[1]] = parseEnvValue(match[1], match[2]);
  }
  return values;
}

function loadOtaBuildEnv(root, processEnv = process.env) {
  const fileEnv = readLocalOtaEnv(root);
  const resolved = {};
  const secret = processEnv.PRINTOPS_OTA_SECRET;
  if (typeof secret === 'string' && secret.trim() !== '') {
    resolved.PRINTOPS_OTA_SECRET = secret.trim();
  }
  for (const name of OTA_ENV_KEYS) {
    const value = processEnv[name];
    if (typeof value === 'string' && value.trim() !== '') {
      resolved[name] = value.trim();
    } else if (Object.hasOwn(fileEnv, name)) {
      resolved[name] = fileEnv[name];
    }
  }
  return resolved;
}

function deriveOtaSigningKeys(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret.trim(), 'utf8') < 32) {
    throw new Error('PRINTOPS_OTA_SECRET must be at least 32 bytes; use a high-entropy secret');
  }
  const normalizedSecret = secret.trim();
  if (Buffer.byteLength(normalizedSecret, 'utf8') > 1024) {
    throw new Error('PRINTOPS_OTA_SECRET must not exceed 1024 bytes');
  }

  const seed = scryptSync(normalizedSecret, KDF_SALT, 32, SCRYPT_OPTIONS);
  const privateDer = Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]);
  seed.fill(0);

  let privateKey;
  try {
    privateKey = createPrivateKey({ key: privateDer, format: 'der', type: 'pkcs8' });
  } finally {
    privateDer.fill(0);
  }

  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function publicKeyBytes(value) {
  const trimmed = String(value).trim();
  let publicKey;
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    publicKey = createPublicKey(trimmed);
  } else {
    const raw = /^[0-9a-f]{64}$/i.test(trimmed)
      ? Buffer.from(trimmed, 'hex')
      : Buffer.from(trimmed, 'base64');
    if (raw.length !== 32) {
      throw new Error('OTA public key must be Ed25519 PEM or 32 raw bytes in hex/base64');
    }
    publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_RAW_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('OTA public key must use Ed25519');
  }

  const der = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }));
  return Buffer.from(der.subarray(der.length - 32));
}

function publicKeysMatch(left, right) {
  const leftBytes = publicKeyBytes(left);
  const rightBytes = publicKeyBytes(right);
  return timingSafeEqual(leftBytes, rightBytes);
}

function resolveOtaPublicKey({
  previousPublicKey = '',
  derivedPublicKey,
  acceptanceBuild = false,
  acceptancePublicKeyFile,
}) {
  if (acceptanceBuild) {
    if (!acceptancePublicKeyFile || !existsSync(acceptancePublicKeyFile)) {
      throw new Error('OTA native acceptance public key is missing');
    }
    const acceptancePublicKey = readFileSync(acceptancePublicKeyFile, 'utf8').trim();
    publicKeyBytes(acceptancePublicKey);
    return acceptancePublicKey;
  }

  if (derivedPublicKey) {
    const candidate = String(derivedPublicKey).trim();
    publicKeyBytes(candidate);
    if (previousPublicKey && previousPublicKey !== 'unconfigured' &&
        !publicKeysMatch(previousPublicKey, candidate)) {
      throw new Error(
        'PRINTOPS_OTA_SECRET changes the pinned OTA key; preserve the existing secret or perform an explicit key rotation',
      );
    }
    return candidate;
  }

  if (previousPublicKey && previousPublicKey !== 'unconfigured') {
    publicKeyBytes(previousPublicKey);
    return previousPublicKey;
  }
  return 'unconfigured';
}

function resetOtaResourceDirectory(resourceDir) {
  const publicKeyPath = join(resourceDir, 'ota-public-key.txt');
  const previousPublicKey = existsSync(publicKeyPath)
    ? readFileSync(publicKeyPath, 'utf8').trim()
    : '';
  rmSync(resourceDir, { recursive: true, force: true });
  mkdirSync(resourceDir, { recursive: true });
  if (previousPublicKey) {
    writeFileSync(publicKeyPath, `${previousPublicKey}\n`);
  }
  return { publicKeyPath, previousPublicKey };
}

function withoutOtaSigningSecret(source = process.env) {
  const environment = { ...source };
  delete environment.PRINTOPS_OTA_SECRET;
  return environment;
}

module.exports = {
  assertNoLocalOtaSigningSecret,
  deriveOtaSigningKeys,
  loadOtaBuildEnv,
  publicKeyBytes,
  publicKeysMatch,
  resetOtaResourceDirectory,
  resolveOtaPublicKey,
  withoutOtaSigningSecret,
};
