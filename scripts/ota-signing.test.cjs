'use strict';

const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createPublicKey, generateKeyPairSync, sign, verify } = require('node:crypto');
const test = require('node:test');
const {
  deriveOtaSigningKeys,
  loadOtaBuildEnv,
  publicKeysMatch,
  resolveOtaPublicKey,
  resetOtaResourceDirectory,
  withoutOtaSigningSecret,
} = require('./ota-signing.cjs');

const SECRET = 'printops-test-secret-'.repeat(3);

test('one release secret derives a stable Ed25519 signing keypair', () => {
  const first = deriveOtaSigningKeys(SECRET);
  const second = deriveOtaSigningKeys(SECRET);
  const message = Buffer.from('signed PrintOps OTA artifact digest');
  const signature = sign(null, message, first.privateKey);

  assert.equal(first.publicKeyPem, second.publicKeyPem);
  assert.equal(verify(null, message, second.publicKey, signature), true);
  assert.equal(publicKeysMatch(first.publicKeyPem, second.publicKeyPem), true);
});

test('different secrets produce different public verification keys', () => {
  const first = deriveOtaSigningKeys(SECRET);
  const second = deriveOtaSigningKeys(`${SECRET}different`);

  assert.equal(publicKeysMatch(first.publicKeyPem, second.publicKeyPem), false);
  assert.equal(
    verify(null, Buffer.from('payload'), second.publicKey, sign(null, Buffer.from('payload'), first.privateKey)),
    false,
  );
});

test('short OTA secrets are rejected', () => {
  assert.throws(() => deriveOtaSigningKeys('2222'), /at least 32 bytes/);
});

test('workspace .env secrets are rejected; release secrets come from process environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printops-ota-env-'));
  const envPath = join(dir, '.env');
  try {
    writeFileSync(envPath, [
      '# local release settings',
      `PRINTOPS_OTA_SECRET="${SECRET}"`,
      'PRINTOPS_OTA_MIN_SUPPORTED_VERSION=0.1.31',
      'UNRELATED_VALUE=must-not-be-loaded',
      '',
    ].join('\n'));
    assert.throws(() => loadOtaBuildEnv(dir, {}), /do not store it in the workspace \.env file/);
    assert.throws(
      () => loadOtaBuildEnv(dir, { PRINTOPS_OTA_SECRET: `${SECRET}process` }),
      /do not store it in the workspace \.env file/,
    );
    writeFileSync(envPath, `# PRINTOPS_OTA_SECRET="${SECRET}"\n`);
    assert.throws(() => loadOtaBuildEnv(dir, {}), /do not store it in the workspace \.env file/);

    writeFileSync(envPath, [
      '# local release settings',
      'PRINTOPS_OTA_MIN_SUPPORTED_VERSION=0.1.31',
      'UNRELATED_VALUE=must-not-be-loaded',
      '',
    ].join('\n'));
    const fromFile = loadOtaBuildEnv(dir, {});
    const fromProcess = loadOtaBuildEnv(dir, { PRINTOPS_OTA_SECRET: `${SECRET}process` });

    assert.equal(fromFile.PRINTOPS_OTA_SECRET, undefined);
    assert.equal(fromFile.PRINTOPS_OTA_MIN_SUPPORTED_VERSION, '0.1.31');
    assert.equal(fromFile.UNRELATED_VALUE, undefined);
    assert.equal(fromProcess.PRINTOPS_OTA_SECRET, `${SECRET}process`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bundled Ed25519 public key parsing accepts hex and PEM encodings', () => {
  const keys = deriveOtaSigningKeys(SECRET);
  const raw = Buffer.from(keys.publicKey.export({ type: 'spki', format: 'der' })).subarray(-32);

  assert.equal(publicKeysMatch(keys.publicKeyPem, raw.toString('hex')), true);
  assert.equal(publicKeysMatch(keys.publicKeyPem, raw.toString('base64')), true);
  assert.equal(createPublicKey(keys.publicKeyPem).asymmetricKeyType, 'ed25519');
});

test('non-Ed25519 PEM public keys are rejected', () => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  assert.throws(
    () => publicKeysMatch(
      publicKey.export({ type: 'spki', format: 'pem' }),
      deriveOtaSigningKeys(SECRET).publicKeyPem,
    ),
    /must use Ed25519/,
  );
});

test('configured public keys persist locally and reject unintended secret rotation', () => {
  const pinnedKey = deriveOtaSigningKeys(SECRET).publicKeyPem;
  const changedKey = deriveOtaSigningKeys(`${SECRET}changed`).publicKeyPem;

  assert.equal(publicKeysMatch(resolveOtaPublicKey({
    previousPublicKey: pinnedKey,
  }), pinnedKey), true);
  assert.equal(publicKeysMatch(resolveOtaPublicKey({
    previousPublicKey: pinnedKey,
    derivedPublicKey: pinnedKey,
  }), pinnedKey), true);
  assert.throws(
    () => resolveOtaPublicKey({ previousPublicKey: pinnedKey, derivedPublicKey: changedKey }),
    /changes the pinned OTA key/,
  );
  assert.equal(resolveOtaPublicKey({ previousPublicKey: 'unconfigured' }), 'unconfigured');
});

test('build subprocess environment excludes the signing secret without mutating its source', () => {
  const source = { PRINTOPS_OTA_SECRET: SECRET, PATH: 'build-tools' };
  const safe = withoutOtaSigningSecret(source);

  assert.equal(safe.PRINTOPS_OTA_SECRET, undefined);
  assert.equal(safe.PATH, 'build-tools');
  assert.equal(source.PRINTOPS_OTA_SECRET, SECRET);
});

test('resource rebuild preserves the existing OTA trust key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printops-ota-resources-'));
  try {
    const resourceDir = join(dir, 'resources');
    mkdirSync(resourceDir);
    const pinnedKey = deriveOtaSigningKeys(SECRET).publicKeyPem;
    const publicKeyPath = join(resourceDir, 'ota-public-key.txt');
    const oldResourcePath = join(resourceDir, 'obsolete-resource.bin');
    writeFileSync(publicKeyPath, `${pinnedKey}\n`);
    writeFileSync(oldResourcePath, 'old');

    const reset = resetOtaResourceDirectory(resourceDir);

    assert.equal(reset.publicKeyPath, publicKeyPath);
    assert.equal(reset.previousPublicKey, pinnedKey.trim());
    assert.equal(readFileSync(publicKeyPath, 'utf8').trim(), pinnedKey.trim());
    assert.equal(existsSync(oldResourcePath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('native acceptance key override is explicit and bypasses release-key continuity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printops-ota-acceptance-key-'));
  try {
    const acceptanceKey = deriveOtaSigningKeys(`${SECRET}acceptance`).publicKeyPem;
    const keyFile = join(dir, 'acceptance-public-key.pem');
    writeFileSync(keyFile, acceptanceKey);

    assert.equal(publicKeysMatch(resolveOtaPublicKey({
      previousPublicKey: deriveOtaSigningKeys(SECRET).publicKeyPem,
      acceptanceBuild: true,
      acceptancePublicKeyFile: keyFile,
    }), acceptanceKey), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
