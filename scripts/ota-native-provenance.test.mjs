import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  createSignedManifest,
  publicKeyHex,
  verifyManifestArtifact,
} from './ota-native-provenance.mjs';

test('native provenance signs and verifies the exact NSIS bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'printops-ota-provenance-'));
  try {
    const { privateKey } = generateKeyPairSync('ed25519');
    const artifactPath = join(directory, 'PrintOps_0.1.28_x64-setup.exe');
    const manifestPath = join(directory, 'ota-manifest.json');
    const publicKeyPath = join(directory, 'public-key.txt');
    writeFileSync(artifactPath, Buffer.from('deterministic native acceptance bytes'));
    writeFileSync(publicKeyPath, `${publicKeyHex(privateKey)}\n`);
    writeFileSync(manifestPath, JSON.stringify(createSignedManifest({
      artifactPath,
      version: '0.1.28',
      schemaVersion: 7,
      minSupportedVersion: '0.1.27',
      privateKey,
    })));

    const result = verifyManifestArtifact({
      manifestPath,
      artifactPath,
      publicKeyPath,
      expectedVersion: '0.1.28',
      expectedSchemaVersion: 7,
    });
    assert.equal(result.sha256.length, 64);
    assert.equal(result.bytes, readFileSync(artifactPath).byteLength);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native provenance rejects a changed installer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'printops-ota-provenance-'));
  try {
    const { privateKey } = generateKeyPairSync('ed25519');
    const artifactPath = join(directory, 'PrintOps_0.1.28_x64-setup.exe');
    const manifestPath = join(directory, 'ota-manifest.json');
    const publicKeyPath = join(directory, 'public-key.txt');
    writeFileSync(artifactPath, Buffer.from('original bytes'));
    writeFileSync(publicKeyPath, `${publicKeyHex(privateKey)}\n`);
    writeFileSync(manifestPath, JSON.stringify(createSignedManifest({
      artifactPath,
      version: '0.1.28',
      schemaVersion: 7,
      minSupportedVersion: '0.1.27',
      privateKey,
    })));
    writeFileSync(artifactPath, Buffer.from('tampered bytes'));

    assert.throws(
      () => verifyManifestArtifact({
        manifestPath,
        artifactPath,
        publicKeyPath,
        expectedVersion: '0.1.28',
        expectedSchemaVersion: 7,
      }),
      /SHA-256 does not match|artifact Ed25519 signature is invalid/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
