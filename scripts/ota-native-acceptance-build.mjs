import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSignedManifest,
  privateKeyFromText,
  publicKeyHex,
  sha256File,
  verifyManifestArtifact,
} from './ota-native-provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = join(root, 'apps', 'desktop');
const resourceRoot = join(root, 'apps', 'desktop', 'src-tauri', 'resources');
const apiDir = join(root, 'apps', 'api');
const apiDist = join(apiDir, 'dist');
const outputRoot = resolve(process.env.PRINTOPS_OTA_NATIVE_OUTPUT_DIR ?? join(root, 'artifacts', 'ota-native'));
const workRoot = join(outputRoot, 'work');
const resourcesRoot = join(workRoot, 'resources');
const aVersion = process.env.PRINTOPS_OTA_NATIVE_A_VERSION?.trim() || '0.1.27';
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const bVersion = process.env.PRINTOPS_OTA_NATIVE_B_VERSION?.trim() || packageVersion;
const aSchema = Number(process.env.PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION ?? '6');
const bSchema = Number(process.env.PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION ?? '7');
const signingKeyText = process.env.PRINTOPS_OTA_NATIVE_SIGNING_KEY;
const acceptanceBuildEnvName = 'PRINTOPS_OTA_NATIVE_ACCEPTANCE_BUILD';

const baseResourceEntries = [
  'resources/server.exe',
  'resources/static',
  'resources/sql-wasm.wasm',
  'resources/printops-runner.exe',
  'resources/printops-updater.exe',
  'resources/ota-public-key.txt',
  'resources/print-helper',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function commandName(name) {
  return process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name;
}

function run(command, args, options = {}) {
  console.log(`[NATIVE BUILD] ${command} ${args.join(' ')}`);
  return execFileSync(commandName(command), args, {
    cwd: root,
    stdio: 'inherit',
    ...(process.platform === 'win32' && commandName(command).toLowerCase().endsWith('.cmd') ? { shell: true } : {}),
    ...options,
  });
}

function runFrom(directory, command, args, options = {}) {
  console.log(`[NATIVE BUILD] ${command} ${args.join(' ')}`);
  return execFileSync(commandName(command), args, {
    cwd: directory,
    stdio: 'inherit',
    ...(process.platform === 'win32' && commandName(command).toLowerCase().endsWith('.cmd') ? { shell: true } : {}),
    ...options,
  });
}

function gitOutput(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function cleanBuildEnv(extra = {}) {
  const environment = { ...process.env, ...extra };
  delete environment.PRINTOPS_OTA_NATIVE_SIGNING_KEY;
  return environment;
}

function resetOutput() {
  mkdirSync(outputRoot, { recursive: true });
  for (const name of ['a', 'b', 'broken-b', 'work', 'evidence', 'public-key.txt', 'provenance.json', 'native-e2e.env']) {
    rmSync(join(outputRoot, name), { recursive: true, force: true });
  }
  mkdirSync(workRoot, { recursive: true });
  mkdirSync(resourcesRoot, { recursive: true });
}

function writeAcceptancePublicKey(privateKey) {
  const publicKey = publicKeyHex(privateKey);
  const publicKeyPath = join(outputRoot, 'public-key.txt');
  writeFileSync(publicKeyPath, `${publicKey}\n`, { encoding: 'utf8', flag: 'wx' });
  return { publicKey, publicKeyPath };
}

function buildBaseResources(publicKeyPath) {
  const environment = cleanBuildEnv({
    [acceptanceBuildEnvName]: '1',
    PRINTOPS_OTA_PUBLIC_KEY_FILE: publicKeyPath,
    PRINTOPS_OTA_REQUIRE_SIGNATURE: 'true',
  });
  run('npm', ['run', 'build:resources'], { env: environment });
  for (const required of [
    'server.exe',
    'printops-runner.exe',
    'printops-updater.exe',
    'sql-wasm.wasm',
    'ota-public-key.txt',
    'static/index.html',
    'print-helper/printops-html-print.exe',
  ]) {
    assert(existsSync(join(resourceRoot, required)), `generated resource is missing: ${required}`);
  }
  assert(readFileSync(join(resourceRoot, 'ota-public-key.txt'), 'utf8').trim() ===
    readFileSync(publicKeyPath, 'utf8').trim(), 'bundled OTA public key does not match acceptance key');
}

function createAcceptanceApiServer() {
  const aDist = join(workRoot, 'api-a-dist');
  cpSync(apiDist, aDist, { recursive: true });
  const schemaPath = join(aDist, 'infra', 'db', 'sqlite.schema.js');
  assert(existsSync(schemaPath), `compiled schema module is missing: ${schemaPath}`);
  let source = readFileSync(schemaPath, 'utf8');
  const originalConstant = 'export const CURRENT_SCHEMA_VERSION = 7;';
  const originalMigrationGuard = /if \(fromVersion < 7\)\s+migrateVersionSixToSeven\(db\);/;
  const originalMigrationEntry = 'export function runSchemaMigration(db) {';
  const originalSameVersionReturn = /if \(fromVersion === CURRENT_SCHEMA_VERSION\)\r?\n[ \t]+return;/;
  const originalMigrationCommit = "        db.run(`PRAGMA user_version=\${CURRENT_SCHEMA_VERSION}`);\n        db.run('COMMIT');";
  assert(source.includes(originalConstant), 'compiled schema constant shape changed; refusing an unsafe A build');
  assert(originalMigrationGuard.test(source), 'compiled schema migration guard shape changed; refusing an unsafe A build');
  assert(source.includes(originalMigrationEntry), 'compiled schema migration entry shape changed; refusing an unsafe A build');
  assert(originalSameVersionReturn.test(source), 'compiled schema same-version return shape changed; refusing an unsafe A build');
  assert(source.includes(originalMigrationCommit), 'compiled schema migration commit shape changed; refusing an unsafe A build');
  source = source.replace(originalConstant, `export const CURRENT_SCHEMA_VERSION = ${aSchema};`);
  source = source.replace(originalMigrationGuard, 'if (CURRENT_SCHEMA_VERSION >= 7 && fromVersion < 7)\n            migrateVersionSixToSeven(db);');
  const acceptanceOtaStateShim = `function ensureAcceptanceOtaState(db) {
    // Acceptance-only baseline: current OTA services need their state table
    // even while A deliberately remains at physical schema ${aSchema}.
    db.run(\`
    CREATE TABLE IF NOT EXISTS ota_update_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL DEFAULT 'IDLE',
      target_version TEXT,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
    )
  \`);
    db.run(\`
    INSERT OR IGNORE INTO ota_update_state (id, state, updated_at)
    VALUES (1, 'IDLE', datetime('now'))
  \`);
}

`;
  source = source.replace(originalMigrationEntry, `${acceptanceOtaStateShim}${originalMigrationEntry}`);
  source = source.replace(originalSameVersionReturn, `if (fromVersion === CURRENT_SCHEMA_VERSION) {
        ensureAcceptanceOtaState(db);
        return;
    }`);
  source = source.replace(originalMigrationCommit, `${originalMigrationCommit}\n        ensureAcceptanceOtaState(db);`);
  writeFileSync(schemaPath, source);

  const bundlePath = join(aDist, 'server.bundle.cjs');
  const esbuild = join(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
  const pkg = join(root, 'node_modules', 'pkg', 'lib-es5', 'bin.js');
  const serverPath = join(workRoot, 'server-a.exe');
  assert(existsSync(esbuild), `esbuild is missing: ${esbuild}`);
  assert(existsSync(pkg), `pkg is missing: ${pkg}`);
  runFrom(root, process.execPath, [esbuild,
    join(aDist, 'server.js'),
    '--bundle',
    '--platform=node',
    '--target=node20',
    `--outfile=${bundlePath}`,
    '--format=cjs',
  ], { env: cleanBuildEnv({ [acceptanceBuildEnvName]: '1' }) });
  runFrom(apiDir, process.execPath, [pkg, bundlePath, '--targets', 'node18-win-x64', '--output', serverPath], {
    env: cleanBuildEnv({ [acceptanceBuildEnvName]: '1' }),
  });
  assert(existsSync(serverPath) && statSync(serverPath).size > 0, 'acceptance A server.exe was not produced');
  return {
    serverPath,
    aDist,
    overlay: 'compiled sqlite schema target 6; acceptance-only ota_update_state baseline shim; v6-to-v7 content history/ownership migration disabled below schema 7',
  };
}

function buildBrokenProxy() {
  const source = join(root, 'scripts', 'ota-native-broken-server-proxy.go');
  const output = join(workRoot, 'broken-server.exe');
  runFrom(root, 'go', ['build', '-trimpath', '-o', output, source], { env: cleanBuildEnv({ [acceptanceBuildEnvName]: '1' }) });
  assert(existsSync(output) && statSync(output).size > 0, 'acceptance broken-B proxy was not produced');
  return output;
}

function cloneResources(name) {
  const destination = join(resourcesRoot, name);
  cpSync(resourceRoot, destination, { recursive: true });
  return destination;
}

function prepareVariantResources(aServerPath, brokenProxyPath) {
  const aResources = cloneResources('a');
  copyFileSync(aServerPath, join(aResources, 'server.exe'));

  const bResources = cloneResources('b');

  const brokenResources = cloneResources('broken-b');
  renameSync(join(brokenResources, 'server.exe'), join(brokenResources, 'server-real.exe'));
  copyFileSync(brokenProxyPath, join(brokenResources, 'server.exe'));
  return { aResources, bResources, brokenResources };
}

function stageResources(source) {
  rmSync(resourceRoot, { recursive: true, force: true });
  cpSync(source, resourceRoot, { recursive: true });
}

function tauriConfig(version, includeRealServer) {
  return JSON.stringify({
    version,
    build: { beforeBuildCommand: '' },
    bundle: {
      resources: includeRealServer
        ? [...baseResourceEntries, 'resources/server-real.exe']
        : baseResourceEntries,
    },
  });
}

function findFreshNsisInstaller(startedAt, version) {
  const nsisDir = join(root, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  const expected = join(nsisDir, `PrintOps_${version}_x64-setup.exe`);
  if (existsSync(expected) && statSync(expected).mtimeMs >= startedAt - 2_000) return expected;
  const candidates = existsSync(nsisDir)
    ? readdirSync(nsisDir)
      .filter((name) => /\.exe$/i.test(name))
      .map((name) => join(nsisDir, name))
      .filter((path) => statSync(path).mtimeMs >= startedAt - 2_000)
    : [];
  assert(candidates.length === 1, `expected one fresh NSIS installer for ${version}; found ${candidates.map(basename).join(', ') || 'none'}`);
  return candidates[0];
}

function buildInstaller({ name, version, schemaVersion, resources, includeRealServer }) {
  stageResources(resources);
  const startedAt = Date.now();
  const tauri = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  assert(existsSync(tauri), `Tauri CLI is missing: ${tauri}`);
  runFrom(desktopDir, process.execPath, [tauri,
    'build',
    '--bundles',
    'nsis',
    '--ci',
    '--no-sign',
    '--ignore-version-mismatches',
    '--config',
    tauriConfig(version, includeRealServer),
  ], {
    env: cleanBuildEnv({
      [acceptanceBuildEnvName]: '1',
      PRINTOPS_BUILD_VERSION: version,
      PRINTOPS_BUILD_DB_SCHEMA_VERSION: String(schemaVersion),
      PRINTOPS_OTA_REQUIRE_SIGNATURE: 'true',
    }),
  });
  const builtInstaller = findFreshNsisInstaller(startedAt, version);
  const variantDir = join(outputRoot, name);
  mkdirSync(variantDir, { recursive: true });
  const destination = join(variantDir, basename(builtInstaller));
  copyFileSync(builtInstaller, destination);
  assert(statSync(destination).size > 0, `${name} NSIS installer is empty`);
  return destination;
}

function writeManifest(name, artifactPath, version, schemaVersion, privateKey) {
  const variantDir = dirname(artifactPath);
  const manifestPath = join(variantDir, 'ota-manifest.json');
  const manifest = createSignedManifest({
    artifactPath,
    version,
    schemaVersion,
    minSupportedVersion: aVersion,
    privateKey,
    notes: `PrintOps native acceptance ${name}; source ${gitOutput(['rev-parse', 'HEAD'])}`,
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function writeNativeEnvironment({ publicKeyPath, aArtifact, aManifest, bArtifact, bManifest, brokenArtifact, brokenManifest }) {
  const values = {
    PRINTOPS_OTA_NATIVE_E2E: '1',
    PRINTOPS_OTA_NATIVE_A_INSTALLER: resolve(aArtifact),
    PRINTOPS_OTA_NATIVE_A_MANIFEST: resolve(aManifest),
    PRINTOPS_OTA_NATIVE_B_MANIFEST: resolve(bManifest),
    PRINTOPS_OTA_NATIVE_B_INSTALLER: resolve(bArtifact),
    PRINTOPS_OTA_NATIVE_A_VERSION: aVersion,
    PRINTOPS_OTA_NATIVE_B_VERSION: bVersion,
    PRINTOPS_OTA_NATIVE_A_SCHEMA_VERSION: String(aSchema),
    PRINTOPS_OTA_NATIVE_B_SCHEMA_VERSION: String(bSchema),
    PRINTOPS_OTA_NATIVE_BROKEN_MANIFEST: resolve(brokenManifest),
    PRINTOPS_OTA_NATIVE_BROKEN_INSTALLER: resolve(brokenArtifact),
    PRINTOPS_OTA_NATIVE_BROKEN_VERSION: bVersion,
    PRINTOPS_OTA_NATIVE_PUBLIC_KEY_FILE: resolve(publicKeyPath),
  };
  const envPath = join(outputRoot, 'native-e2e.env');
  writeFileSync(envPath, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
  return envPath;
}

function writeEvidence({ publicKey, publicKeyPath, artifacts, sourceCommit }) {
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      commit: sourceCommit,
      trackedWorktreeClean: gitOutput(['status', '--porcelain', '--untracked-files=no']) === '',
      branch: gitOutput(['branch', '--show-current']),
    },
    acceptanceProfile: {
      A: {
        version: aVersion,
        schemaVersion: aSchema,
        source: 'current production commit with generated compiled API acceptance overlay',
        overlay: 'CURRENT_SCHEMA_VERSION=6, acceptance-only isolated data-root override, ota_update_state baseline shim, and v6-to-v7 migration guard disabled below schema 7',
      },
      B: {
        version: bVersion,
        schemaVersion: bSchema,
        source: 'current production commit and unmodified production API bundle',
      },
      brokenB: {
        version: bVersion,
        schemaVersion: bSchema,
        source: 'current production B resources plus scripts/ota-native-broken-server-proxy.go',
        failure: 'proxy forwards normal traffic and returns HTTP 503 for OTA readiness after upstream health is live',
      },
    },
    signing: {
      algorithm: 'Ed25519 over canonical manifest JSON and SHA-256 artifact digest',
      publicKey,
      publicKeySha256: sha256File(publicKeyPath),
      privateKeyPersisted: false,
    },
    artifacts,
  };
  writeFileSync(join(outputRoot, 'provenance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
}

function main() {
  assert(process.platform === 'win32', 'native Windows OTA acceptance artifacts must be built on Windows');
  assert(signingKeyText, 'PRINTOPS_OTA_NATIVE_SIGNING_KEY must be provided by the CI secret');
  assert(aSchema >= 0 && Number.isSafeInteger(aSchema), 'A schema must be a non-negative integer');
  assert(bSchema === aSchema + 1, `native acceptance requires B schema A+1 (${aSchema} -> ${bSchema})`);

  const sourceCommit = gitOutput(['rev-parse', 'HEAD']);
  assert(gitOutput(['status', '--porcelain', '--untracked-files=no']) === '', 'tracked worktree must be clean for native provenance');
  const privateKey = privateKeyFromText(signingKeyText);
  resetOutput();
  const { publicKey, publicKeyPath } = writeAcceptancePublicKey(privateKey);

  buildBaseResources(publicKeyPath);
  run('npm', ['run', 'build', '-w', '@printerops/api'], {
    env: cleanBuildEnv({ [acceptanceBuildEnvName]: '1' }),
  });
  const aServer = createAcceptanceApiServer();
  const brokenProxy = buildBrokenProxy();
  const resources = prepareVariantResources(aServer.serverPath, brokenProxy);

  const aArtifact = buildInstaller({ name: 'a', version: aVersion, schemaVersion: aSchema, resources: resources.aResources, includeRealServer: false });
  const bArtifact = buildInstaller({ name: 'b', version: bVersion, schemaVersion: bSchema, resources: resources.bResources, includeRealServer: false });
  const brokenArtifact = buildInstaller({ name: 'broken-b', version: bVersion, schemaVersion: bSchema, resources: resources.brokenResources, includeRealServer: true });

  const aManifest = writeManifest('A', aArtifact, aVersion, aSchema, privateKey);
  const bManifest = writeManifest('B', bArtifact, bVersion, bSchema, privateKey);
  const brokenManifest = writeManifest('broken-B', brokenArtifact, bVersion, bSchema, privateKey);
  const artifactEvidence = {};
  for (const [name, manifestPath, artifactPath, version, schemaVersion] of [
    ['A', aManifest, aArtifact, aVersion, aSchema],
    ['B', bManifest, bArtifact, bVersion, bSchema],
    ['broken-B', brokenManifest, brokenArtifact, bVersion, bSchema],
  ]) {
    artifactEvidence[name] = verifyManifestArtifact({
      manifestPath,
      artifactPath,
      publicKeyPath,
      expectedVersion: version,
      expectedSchemaVersion: schemaVersion,
    });
  }
  writeNativeEnvironment({
    publicKeyPath,
    aArtifact,
    aManifest,
    bArtifact,
    bManifest,
    brokenArtifact,
    brokenManifest,
  });
  writeEvidence({ publicKey, publicKeyPath, sourceCommit, artifacts: artifactEvidence });
  console.log(`[PASS] native acceptance artifacts generated in ${relative(root, outputRoot)}`);
  console.log(`[PASS] provenance verified for A ${aVersion}/${aSchema}, B ${bVersion}/${bSchema}, broken-B ${bVersion}/${bSchema}`);
}

try {
  main();
} catch (error) {
  console.error(`[FAIL] native acceptance build: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
