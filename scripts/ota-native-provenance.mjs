import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('cannot canonicalize a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error(`cannot canonicalize ${typeof value}`);
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function privateKeyFromText(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error('OTA acceptance signing key is empty');
  try {
    return createPrivateKey(trimmed);
  } catch (pemError) {
    try {
      return createPrivateKey({
        key: Buffer.from(trimmed, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
    } catch {
      throw new Error(`OTA acceptance signing key is not a PKCS#8 Ed25519 key: ${pemError.message}`);
    }
  }
}

export function publicKeyObject(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error('OTA public key is empty');
  if (trimmed.includes('BEGIN PUBLIC KEY')) return createPublicKey(trimmed);
  const raw = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (raw.length !== 32) throw new Error('OTA public key must contain 32 Ed25519 bytes');
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

export function publicKeyHex(key) {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  const der = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }));
  if (der.length !== ED25519_SPKI_PREFIX.length + 32
    || !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('acceptance signing key is not Ed25519');
  }
  return der.subarray(ED25519_SPKI_PREFIX.length).toString('hex');
}

function signatureBytes(value, label) {
  const trimmed = String(value ?? '').trim();
  const bytes = /^[0-9a-f]{128}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (bytes.length !== 64) throw new Error(`${label} must contain a 64-byte Ed25519 signature`);
  return bytes;
}

function requiredRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function loadManifest(path) {
  if (!existsSync(path)) throw new Error(`manifest is missing: ${path}`);
  const root = JSON.parse(readFileSync(path, 'utf8'));
  if (root?.envelope_version !== 1) throw new Error('manifest envelope_version must be 1');
  return {
    envelope: root,
    payload: requiredRecord(root.manifest, 'manifest.manifest'),
  };
}

export function createSignedManifest({
  artifactPath,
  version,
  schemaVersion,
  minSupportedVersion,
  privateKey,
  releaseDate = new Date().toISOString(),
  notes = 'PrintOps native Windows OTA acceptance artifact',
}) {
  if (!SEMVER.test(version)) throw new Error(`invalid acceptance release version: ${version}`);
  if (!SEMVER.test(minSupportedVersion)) throw new Error(`invalid acceptance minimum version: ${minSupportedVersion}`);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0) {
    throw new Error('acceptance schema version must be a non-negative integer');
  }
  if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
    throw new Error(`NSIS artifact is missing: ${artifactPath}`);
  }

  const artifactBytes = statSync(artifactPath).size;
  const artifactSha256 = sha256File(artifactPath);
  const artifactSignature = sign(null, Buffer.from(artifactSha256, 'hex'), privateKey).toString('base64');
  const payload = {
    schema_version: 1,
    release: {
      version,
      channel: 'stable',
      release_date: releaseDate,
      notes,
    },
    artifacts: {
      desktop: {
        'windows-x64': {
          url: basename(artifactPath),
          sha256: artifactSha256,
          signature: artifactSignature,
          size: artifactBytes,
          format: 'nsis-installer',
        },
      },
    },
    compatibility: {
      min_supported_version: minSupportedVersion,
      schema_version: schemaVersion,
    },
    rollout: {
      staged: false,
      rollout_percentage: 100,
    },
  };
  const manifestSignature = sign(
    null,
    Buffer.from(canonicalJson(payload), 'utf8'),
    privateKey,
  ).toString('base64');
  return {
    envelope_version: 1,
    manifest: payload,
    signature: manifestSignature,
  };
}

export function verifyManifestArtifact({
  manifestPath,
  artifactPath,
  publicKeyPath,
  expectedVersion,
  expectedSchemaVersion,
}) {
  if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
    throw new Error(`NSIS artifact is missing: ${artifactPath}`);
  }
  if (!existsSync(publicKeyPath) || !statSync(publicKeyPath).isFile()) {
    throw new Error(`OTA public key is missing: ${publicKeyPath}`);
  }

  const { envelope, payload } = loadManifest(manifestPath);
  const release = requiredRecord(payload.release, 'manifest.release');
  const compatibility = requiredRecord(payload.compatibility, 'manifest.compatibility');
  const artifacts = requiredRecord(payload.artifacts, 'manifest.artifacts');
  const desktop = requiredRecord(artifacts.desktop, 'manifest.artifacts.desktop');
  const entry = requiredRecord(desktop['windows-x64'], 'manifest desktop windows-x64 artifact');
  const publicKey = publicKeyObject(readFileSync(publicKeyPath, 'utf8'));

  if (release.channel !== 'stable') throw new Error(`native acceptance requires stable channel, got ${release.channel}`);
  if (!SEMVER.test(release.version)) throw new Error(`manifest release version is not semver: ${release.version}`);
  if (expectedVersion !== undefined && release.version !== expectedVersion) {
    throw new Error(`manifest release version ${release.version} does not match expected ${expectedVersion}`);
  }
  if (!SEMVER.test(compatibility.min_supported_version)) {
    throw new Error('manifest minimum supported version is not semver');
  }
  if (compatibility.schema_version !== expectedSchemaVersion) {
    throw new Error(`manifest schema ${compatibility.schema_version} does not match expected ${expectedSchemaVersion}`);
  }
  if (entry.format !== 'nsis-installer') throw new Error(`manifest artifact format is ${entry.format}, not nsis-installer`);
  if (entry.url !== basename(artifactPath)) {
    throw new Error(`manifest URL ${entry.url} does not match installer ${basename(artifactPath)}`);
  }

  const artifactBytes = statSync(artifactPath).size;
  const artifactSha256 = sha256File(artifactPath);
  if (entry.size !== artifactBytes) throw new Error(`manifest artifact size ${entry.size} does not match ${artifactBytes}`);
  if (entry.sha256 !== artifactSha256) throw new Error('manifest artifact SHA-256 does not match the installer');
  if (!verify(null, Buffer.from(artifactSha256, 'hex'), publicKey, signatureBytes(entry.signature, 'artifact signature'))) {
    throw new Error('artifact Ed25519 signature is invalid');
  }
  if (!verify(
    null,
    Buffer.from(canonicalJson(payload), 'utf8'),
    publicKey,
    signatureBytes(envelope.signature, 'manifest signature'),
  )) {
    throw new Error('release manifest Ed25519 signature is invalid');
  }

  const manifestArtifactPath = resolve(dirname(manifestPath), entry.url);
  if (manifestArtifactPath !== resolve(artifactPath)) {
    throw new Error('manifest artifact URL resolves outside the manifest directory or to a different file');
  }

  return {
    manifestPath: resolve(manifestPath),
    artifactPath: resolve(artifactPath),
    version: release.version,
    schemaVersion: compatibility.schema_version,
    bytes: artifactBytes,
    sha256: artifactSha256,
    artifactSignature: entry.signature,
    manifestSignature: envelope.signature,
    publicKey: publicKeyHex(publicKey),
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const required = ['manifest', 'artifact', 'public-key', 'expected-version', 'expected-schema'];
    for (const key of required) {
      if (!args[key]) throw new Error(`--${key} is required`);
    }
    const result = verifyManifestArtifact({
      manifestPath: args.manifest,
      artifactPath: args.artifact,
      publicKeyPath: args['public-key'],
      expectedVersion: args['expected-version'],
      expectedSchemaVersion: Number(args['expected-schema']),
    });
    console.log(`[PASS] native provenance ${result.version} schema ${result.schemaVersion}: ${result.sha256}`);
  } catch (error) {
    console.error(`[FAIL] native provenance: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
