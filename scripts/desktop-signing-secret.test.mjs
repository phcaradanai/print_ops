import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, sign, verify } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveDesktopSigningSecret } from './desktop-signing-secret.mjs';

const require = createRequire(import.meta.url);
const { deriveOtaSigningKeys, publicKeysMatch } = require('./ota-signing.cjs');
const WINDOWS_ONLY = process.platform !== 'win32';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'printops-desktop-signing-'));
  const root = join(base, 'workspace');
  const localAppData = join(base, 'local-appdata');
  mkdirSync(root);
  mkdirSync(localAppData);
  return { base, root, localAppData };
}

function cleanup(value) {
  rmSync(value.base, { recursive: true, force: true });
}

function testEnvironment(localAppData, secret) {
  const env = { ...process.env, LOCALAPPDATA: localAppData };
  delete env.PRINTOPS_OTA_SECRET;
  if (typeof secret === 'string') env.PRINTOPS_OTA_SECRET = secret;
  return env;
}

function storePath(localAppData) {
  return join(localAppData, 'PrintOps', 'build', 'ota-signing-secret.dpapi');
}

function pinPublicKey(root, publicKeyPem) {
  const resourceDir = join(root, 'apps', 'desktop', 'src-tauri', 'resources');
  mkdirSync(resourceDir, { recursive: true });
  writeFileSync(join(resourceDir, 'ota-public-key.txt'), `${publicKeyPem}\n`);
}

function newSecret() {
  return randomBytes(32).toString('hex');
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (
    path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
  );
}

test('first Windows resolution persists an encrypted secret and later reads verify the same Ed25519 key', {
  skip: WINDOWS_ONLY,
}, () => {
  const dirs = fixture();
  const secretEnv = testEnvironment(dirs.localAppData);
  try {
    const firstSecret = resolveDesktopSigningSecret({ root: dirs.root, env: secretEnv });
    const firstKeys = deriveOtaSigningKeys(firstSecret);
    const location = storePath(dirs.localAppData);
    const storeContent = readFileSync(location, 'utf8');

    assert.equal(existsSync(location), true, 'first resolution must persist a DPAPI store');
    assert.equal(isInside(dirs.root, location), false, 'the encrypted store must be outside the workspace');
    assert.equal(firstSecret.length === 64, true, 'generated secret must encode 32 random bytes');
    assert.equal(storeContent.includes(firstSecret), false, 'the store must not contain the plaintext secret');

    const secondSecret = resolveDesktopSigningSecret({ root: dirs.root, env: secretEnv });
    const secondKeys = deriveOtaSigningKeys(secondSecret);
    const message = Buffer.from('desktop signing-secret persistence regression');
    const signature = sign(null, message, firstKeys.privateKey);

    assert.equal(firstSecret === secondSecret, true, 'stored secret must be stable across reads');
    assert.equal(publicKeysMatch(firstKeys.publicKeyPem, secondKeys.publicKeyPem), true);
    assert.equal(verify(null, message, secondKeys.publicKey, signature), true);
  } finally {
    cleanup(dirs);
  }
});

test('process secret override validates against the pin without touching the local store', () => {
  const dirs = fixture();
  const secret = newSecret();
  const publicKey = deriveOtaSigningKeys(secret).publicKeyPem;
  const blockedLocalAppData = join(dirs.base, 'local-appdata-is-a-file');
  writeFileSync(blockedLocalAppData, 'untouched');
  pinPublicKey(dirs.root, publicKey);
  try {
    const resolved = resolveDesktopSigningSecret({
      root: dirs.root,
      env: testEnvironment(blockedLocalAppData, secret),
    });

    assert.equal(resolved === secret, true, 'process override must be returned unchanged');
    assert.equal(publicKeysMatch(deriveOtaSigningKeys(resolved).publicKeyPem, publicKey), true);
    assert.equal(readFileSync(blockedLocalAppData, 'utf8') === 'untouched', true);

    const mismatchingSecret = newSecret();
    assert.throws(
      () => resolveDesktopSigningSecret({
        root: dirs.root,
        env: testEnvironment(blockedLocalAppData, mismatchingSecret),
      }),
      /changes the pinned OTA key/,
    );
    assert.equal(readFileSync(blockedLocalAppData, 'utf8') === 'untouched', true);
  } finally {
    cleanup(dirs);
  }
});

test('a missing secret cannot bootstrap a replacement for an already pinned identity', () => {
  const dirs = fixture();
  pinPublicKey(dirs.root, deriveOtaSigningKeys(newSecret()).publicKeyPem);
  const location = storePath(dirs.localAppData);
  try {
    assert.throws(
      () => resolveDesktopSigningSecret({ root: dirs.root, env: testEnvironment(dirs.localAppData) }),
      process.platform === 'win32'
        ? /pinned OTA public key exists.*PRINTOPS_OTA_SECRET/
        : /requires Windows current-user DPAPI/,
    );
    assert.equal(existsSync(location), false, 'a missing pinned secret must not create a replacement store');
  } finally {
    cleanup(dirs);
  }
});

test('a malformed local store is rejected and left unchanged', () => {
  const dirs = fixture();
  const location = storePath(dirs.localAppData);
  mkdirSync(dirname(location), { recursive: true });
  writeFileSync(location, 'not-a-valid-dpapi-store\n');
  const original = readFileSync(location);
  try {
    assert.throws(
      () => resolveDesktopSigningSecret({ root: dirs.root, env: testEnvironment(dirs.localAppData) }),
      process.platform === 'win32' ? /store is malformed/ : /requires Windows current-user DPAPI/,
    );
    assert.equal(readFileSync(location).equals(original), true, 'corrupt store bytes must not be replaced');
  } finally {
    cleanup(dirs);
  }
});

test('non-Windows hosts fail explicitly instead of creating an insecure local secret', {
  skip: process.platform === 'win32',
}, () => {
  const dirs = fixture();
  const location = storePath(dirs.localAppData);
  const env = testEnvironment(dirs.localAppData);
  delete env.LOCALAPPDATA;
  try {
    assert.throws(
      () => resolveDesktopSigningSecret({ root: dirs.root, env }),
      /requires Windows current-user DPAPI/,
    );
    assert.equal(existsSync(location), false, 'non-Windows hosts must not create a plaintext or substitute store');
  } finally {
    cleanup(dirs);
  }
});

test('a corrupted DPAPI payload is rejected without replacing its store', {
  skip: WINDOWS_ONLY,
}, () => {
  const dirs = fixture();
  const location = storePath(dirs.localAppData);
  mkdirSync(dirname(location), { recursive: true });
  writeFileSync(location, `PRINTOPS-DPAPI-CURRENT-USER-V1\n${Buffer.from('invalid DPAPI payload').toString('base64')}\n`);
  const original = readFileSync(location);
  try {
    assert.throws(
      () => resolveDesktopSigningSecret({ root: dirs.root, env: testEnvironment(dirs.localAppData) }),
      /could not be decrypted by this Windows account/,
    );
    assert.equal(readFileSync(location).equals(original), true, 'undecryptable store bytes must not be replaced');
  } finally {
    cleanup(dirs);
  }
});

test('a stored secret that disagrees with the pinned key is rejected without replacement', {
  skip: WINDOWS_ONLY,
}, () => {
  const dirs = fixture();
  const env = testEnvironment(dirs.localAppData);
  try {
    resolveDesktopSigningSecret({ root: dirs.root, env });
    const location = storePath(dirs.localAppData);
    const original = readFileSync(location);
    pinPublicKey(dirs.root, deriveOtaSigningKeys(newSecret()).publicKeyPem);

    assert.throws(
      () => resolveDesktopSigningSecret({ root: dirs.root, env }),
      /does not match the pinned OTA public key/,
    );
    assert.equal(readFileSync(location).equals(original), true, 'mismatching store bytes must not be replaced');
  } finally {
    cleanup(dirs);
  }
});

test('competing first resolutions converge on the exclusively created DPAPI store', {
  skip: WINDOWS_ONLY,
  timeout: 120_000,
}, async () => {
  const dirs = fixture();
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const resolverUrl = pathToFileURL(join(projectRoot, 'scripts', 'desktop-signing-secret.mjs')).href;
  const signingUrl = pathToFileURL(join(projectRoot, 'scripts', 'ota-signing.cjs')).href;
  const childScript = [
    `import { resolveDesktopSigningSecret } from ${JSON.stringify(resolverUrl)};`,
    `import signing from ${JSON.stringify(signingUrl)};`,
    "import { createHash } from 'node:crypto';",
    'const env = { ...process.env, LOCALAPPDATA: process.argv[1] };',
    'delete env.PRINTOPS_OTA_SECRET;',
    'const secret = resolveDesktopSigningSecret({ root: process.argv[2], env });',
    "const der = signing.deriveOtaSigningKeys(secret).publicKey.export({ type: 'spki', format: 'der' });",
    "console.log(createHash('sha256').update(der).digest('hex'));",
  ].join('\n');
  const childEnv = { ...process.env };
  delete childEnv.PRINTOPS_OTA_SECRET;

  function resolveInChild() {
    return new Promise((finish) => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', childScript, dirs.localAppData, dirs.root],
        { env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let output = '';
      child.stdout.setEncoding('ascii');
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.once('error', () => finish({ code: null, fingerprint: '' }));
      child.once('close', (code) => finish({ code, fingerprint: output.trim() }));
    });
  }

  try {
    const results = await Promise.all([resolveInChild(), resolveInChild()]);
    assert.equal(
      results.every(({ code, fingerprint }) => code === 0 && /^[0-9a-f]{64}$/.test(fingerprint)),
      true,
      'both first resolvers must complete without exposing secret material',
    );
    assert.equal(new Set(results.map(({ fingerprint }) => fingerprint)).size === 1, true);
    assert.equal(existsSync(storePath(dirs.localAppData)), true);

    const winner = resolveDesktopSigningSecret({ root: dirs.root, env: testEnvironment(dirs.localAppData) });
    const winnerKey = deriveOtaSigningKeys(winner).publicKey.export({ type: 'spki', format: 'der' });
    const winnerFingerprint = createHash('sha256').update(winnerKey).digest('hex');
    assert.equal(winnerFingerprint === results[0].fingerprint, true);
  } finally {
    cleanup(dirs);
  }
});
