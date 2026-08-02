import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  forbiddenTrackedArtifacts,
  freshness,
  inspectRequiredFile,
  versionConsistency,
} from './release-verify-lib.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const postBundle = process.argv.includes('--post-bundle');
const failures = [];
const checks = [];

function pass(name, detail) {
  checks.push({ name, status: 'PASS', detail });
  console.log(`[PASS] ${name}: ${detail}`);
}

function fail(name, detail) {
  checks.push({ name, status: 'FAIL', detail });
  failures.push(`${name}: ${detail}`);
  console.error(`[FAIL] ${name}: ${detail}`);
}

function info(name, detail) {
  checks.push({ name, status: 'INFO', detail });
  console.log(`[INFO] ${name}: ${detail}`);
}

function commandVersion(name, args = ['--version']) {
  let executable = name;
  let commandArgs = args;
  if (process.platform === 'win32' && (name === 'npm' || name.toLowerCase().endsWith('.cmd'))) {
    const command = name === 'npm' ? 'npm.cmd' : name;
    executable = process.env.ComSpec || 'cmd.exe';
    commandArgs = ['/d', '/c', command, ...args];
  }
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    fail(`tool:${name}`, (result.stderr || result.stdout || 'not available').trim());
    return undefined;
  }
  const version = result.stdout.trim().split(/\r?\n/, 1)[0];
  pass(`tool:${name}`, version);
  return version;
}

function json(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function filesUnder(path, excluded = new Set()) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  const result = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(child, excluded));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

function newestMtime(paths) {
  const files = paths.flatMap((path) => filesUnder(path, new Set([
    'node_modules', 'dist', 'target', 'bin', 'obj', 'publish', '.git', '.worktrees',
  ])));
  return files.reduce((latest, path) => Math.max(latest, statSync(path).mtimeMs), 0);
}

function requireFile(path, label = relative(root, path)) {
  const result = inspectRequiredFile(path);
  if (!result.ok) {
    fail(`resource:${label}`, result.detail);
    return false;
  }
  pass(`resource:${label}`, result.detail);
  return true;
}

function requireFresh(output, sourcePaths, label) {
  if (!existsSync(output)) return;
  const outputTime = statSync(output).mtimeMs;
  const sourceTime = newestMtime(sourcePaths);
  const result = freshness(outputTime, sourceTime);
  if (!result.ok) fail(`fresh:${label}`, result.detail);
  else pass(`fresh:${label}`, result.detail);
}

function checkToolchain() {
  const nodeVersion = commandVersion('node');
  const npmVersion = commandVersion('npm');
  commandVersion('go', ['version']);
  commandVersion('rustc');
  commandVersion('cargo');
  commandVersion('dotnet', ['--version']);

  const tauriBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
  commandVersion(tauriBin);

  if (nodeVersion && Number(nodeVersion.replace(/^v/, '').split('.')[0]) < 20) {
    fail('version:node', `Node ${nodeVersion} is unsupported; require >=20`);
  } else if (nodeVersion) {
    pass('version:node', 'supported');
  }
  if (npmVersion && Number(npmVersion.split('.')[0]) < 10) {
    fail('version:npm', `npm ${npmVersion} is unsupported; require >=10`);
  } else if (npmVersion) {
    pass('version:npm', 'supported');
  }
}

function checkBuildHost() {
  if (process.platform !== 'win32') {
    fail(
      'platform:windows-installer',
      `current host is ${process.platform}/${process.arch}; this release requires both MSI and NSIS installers, and the MSI target must be built on Windows. Use a Windows x64 machine, VM, or CI runner`,
    );
    return;
  }
  pass('platform:windows-installer', `supported host ${process.platform}/${process.arch}`);
}

function checkVersions() {
  const versions = {
    root: json('package.json').version,
    api: json('apps/api/package.json').version,
    web: json('apps/web/package.json').version,
    desktop: json('apps/desktop/package.json').version,
    tauri: json('apps/desktop/src-tauri/tauri.conf.json').version,
  };
  const cargo = readFileSync(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')
    .match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  versions.cargo = cargo;
  const consistency = versionConsistency(versions);
  if (!consistency.ok) {
    fail('version:consistency', JSON.stringify(versions));
  } else {
    pass('version:consistency', `${versions.root} across root/API/web/desktop/Cargo/Tauri`);
  }
  return versions.root;
}

function checkForbiddenArtifacts() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const forbidden = forbiddenTrackedArtifacts(tracked);
  if (forbidden.length) fail('repository:forbidden-artifacts', forbidden.join(', '));
  else pass('repository:forbidden-artifacts', 'none tracked');
}

function checkResources() {
  const resourceRoot = join(root, 'apps/desktop/src-tauri/resources');
  const required = [
    join(resourceRoot, 'server.exe'),
    join(resourceRoot, 'printops-runner.exe'),
    join(resourceRoot, 'sql-wasm.wasm'),
    join(resourceRoot, 'static/index.html'),
    join(resourceRoot, 'print-helper/printops-html-print.exe'),
    join(resourceRoot, 'print-helper/WebView2Loader.dll'),
  ];
  required.forEach((path) => requireFile(path));

  requireFresh(join(resourceRoot, 'server.exe'), [
    join(root, 'apps/api/src'),
    join(root, 'packages/domain/src'),
    join(root, 'packages/shared/src'),
    join(root, 'packages/adapters/src'),
  ], 'server.exe');
  requireFresh(join(resourceRoot, 'printops-runner.exe'), [
    join(root, 'apps/runner-go/cmd'),
    join(root, 'apps/runner-go/internal'),
    join(root, 'apps/runner-go/go.mod'),
    join(root, 'apps/runner-go/go.sum'),
  ], 'printops-runner.exe');
  requireFresh(join(resourceRoot, 'static/index.html'), [
    join(root, 'apps/web/src'),
    join(root, 'apps/web/package.json'),
  ], 'static');
  requireFresh(join(resourceRoot, 'print-helper/printops-html-print.exe'), [
    join(root, 'apps/windows-print-helper'),
  ], 'print-helper');

  const manifest = filesUnder(resourceRoot).map((path) => ({
    path: relative(resourceRoot, path).replaceAll('\\', '/'),
    bytes: statSync(path).size,
    sha256: sha256(path),
  })).sort((a, b) => a.path.localeCompare(b.path));
  if (manifest.some((entry) => entry.bytes === 0)) {
    fail('resources:zero-byte-scan', 'one or more bundled resources are empty');
  } else {
    pass('resources:zero-byte-scan', `${manifest.length} files checked`);
  }
  return manifest;
}

function installers(version, minimumMtime) {
  const bundle = join(root, 'apps/desktop/src-tauri/target/release/bundle');
  const expected = [
    join(bundle, 'msi', `PrinterOps_${version}_x64_en-US.msi`),
    join(bundle, 'nsis', `PrinterOps_${version}_x64-setup.exe`),
  ];
  return expected.flatMap((path) => {
    if (!requireFile(path, `installer/${basename(path)}`)) return [];
    if (statSync(path).mtimeMs + 2_000 < minimumMtime) {
      fail(`fresh:installer/${basename(path)}`, 'installer is older than the verified bundled resources');
      return [];
    }
    pass(`fresh:installer/${basename(path)}`, 'installer contains the current resource build');
    return [{
        path: relative(root, path).replaceAll('\\', '/'),
        bytes: statSync(path).size,
        sha256: sha256(path),
      }];
  });
}

checkBuildHost();
checkToolchain();
const version = checkVersions();
checkForbiddenArtifacts();

if (!postBundle && failures.length === 0) {
  console.log('[BUILD] Running the complete desktop resource build');
  try {
    execFileSync(process.execPath, ['apps/desktop/src-tauri/scripts/build-all.js'], {
      cwd: root,
      stdio: 'inherit',
    });
    pass('build:resources', 'web, API, Go runner, and .NET helper built');
  } catch (error) {
    fail('build:resources', `build-all exited ${error.status ?? 'with an error'}`);
  }
}

if (!postBundle && failures.length > 0) {
  info(
    'build:resources',
    'skipped because release preflight failed; generated desktop resources are checked only after their build can run',
  );
}

const resources = !postBundle && failures.length > 0 ? [] : checkResources();
const resourceMtime = newestMtime([join(root, 'apps/desktop/src-tauri/resources')]);
const installerManifest = postBundle ? installers(version, resourceMtime) : [];
if (postBundle && installerManifest.length !== 2) {
  fail('installers:targets', `expected MSI and NSIS for ${version}`);
}

const outputDir = join(root, 'artifacts/prod-01');
mkdirSync(outputDir, { recursive: true });
const manifestPath = join(outputDir, postBundle ? 'release-manifest.json' : 'resource-manifest.json');
const manifest = {
  schemaVersion: 1,
  applicationVersion: version,
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  buildTimestamp: new Date().toISOString(),
  phase: postBundle ? 'post-bundle' : 'resource-verification',
  checks,
  resources,
  installers: installerManifest,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[INFO] Manifest: ${relative(root, manifestPath)}`);
for (const installer of installerManifest) {
  console.log(`[INSTALLER] ${installer.path}`);
  console.log(`[SHA-256] ${installer.sha256}`);
}

if (failures.length) {
  console.error(`\nRelease verification failed with ${failures.length} error(s).`);
  process.exit(1);
}
console.log(`\nRelease verification passed for PrinterOps ${version}.`);
