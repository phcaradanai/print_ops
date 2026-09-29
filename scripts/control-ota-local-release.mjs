import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  createSignedManifest,
  privateKeyFromText,
  verifyManifestArtifact,
} from './ota-native-provenance.mjs';

const [installerArg, version, schemaArg, keyArg, publicKeyArg, outputArg] = process.argv.slice(2);
if (!installerArg || !version || !schemaArg || !keyArg || !publicKeyArg || !outputArg) {
  throw new Error('Usage: node scripts/control-ota-local-release.mjs <installer> <version> <schema> <private-key> <public-key> <output-dir>');
}

const installer = resolve(installerArg);
const outputDir = resolve(outputArg);
const schemaVersion = Number(schemaArg);
mkdirSync(outputDir, { recursive: true });
const artifact = join(outputDir, basename(installer));
copyFileSync(installer, artifact);
const manifest = createSignedManifest({
  artifactPath: artifact,
  version,
  schemaVersion,
  minSupportedVersion: '0.1.28',
  privateKey: privateKeyFromText(readFileSync(resolve(keyArg), 'utf8')),
  notes: `PrintOps ${version} local Windows OTA release`,
});
const manifestPath = join(outputDir, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
verifyManifestArtifact({
  manifestPath,
  artifactPath: artifact,
  publicKeyPath: resolve(publicKeyArg),
  expectedVersion: version,
  expectedSchemaVersion: schemaVersion,
});
console.log(`Signed OTA release verified: ${version}`);
