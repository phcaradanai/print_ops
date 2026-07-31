import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('[SKIP] packaged desktop supervision smoke requires Windows');
  process.exit(0);
}

const root = resolve(import.meta.dirname, '..');
const desktopExe = join(root, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'printerops-desktop.exe');
const artifacts = join(root, 'artifacts', 'prod-01');
const tempRoot = join(process.env.TEMP ?? root, `printops-desktop-smoke-${process.pid}-${randomBytes(6).toString('hex')}`);
const appData = join(tempRoot, 'appdata');
const localAppData = join(tempRoot, 'localappdata');
const findings = [];
let desktop;
let observedSidecars = new Set();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function powershell(script) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function childProcesses(parentPid) {
  const result = powershell(
    `$items = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parentPid}" | ` +
      `Select-Object ProcessId, Name; if ($items) { $items | ConvertTo-Json -Compress }`,
  );
  if (result.status !== 0) throw new Error('could not inspect packaged desktop child processes');
  const output = result.stdout.trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function sidecar(children, executable) {
  return children.find((child) => String(child.Name).toLowerCase() === executable.toLowerCase());
}

async function waitFor(label, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`${label} did not become true${lastError ? ` (${lastError.message})` : ''}`);
}

async function portAvailable(port) {
  return new Promise((resolveCheck) => {
    const server = createServer();
    server.once('error', () => resolveCheck(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolveCheck(true)));
  });
}

async function healthOk() {
  const response = await fetch('http://127.0.0.1:31415/health');
  return response.ok;
}

function terminatePid(pid) {
  const result = powershell(`Stop-Process -Id ${pid} -Force -ErrorAction Stop`);
  if (result.status !== 0) throw new Error('could not terminate packaged sidecar');
}

function processExists(pid) {
  const result = powershell(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`);
  return result.status === 0;
}

async function captureSidecars() {
  const children = childProcesses(desktop.pid);
  for (const child of children) observedSidecars.add(Number(child.ProcessId));
  return {
    server: sidecar(children, 'server.exe'),
    runner: sidecar(children, 'printops-runner.exe'),
  };
}

async function closeDesktopNormally() {
  const result = powershell(
    `$p = Get-Process -Id ${desktop.pid} -ErrorAction Stop; ` +
      `if (-not $p.CloseMainWindow()) { throw 'desktop main window did not accept close' }`,
  );
  if (result.status !== 0) throw new Error('packaged desktop did not accept a normal window close');
  await waitFor('packaged desktop exit', () => !processExists(desktop.pid), 20_000);
}

try {
  assert(existsSync(desktopExe), 'release desktop executable is missing; run npm run desktop:bundle');
  assert(await portAvailable(31415), 'loopback port 31415 is already in use');
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  mkdirSync(artifacts, { recursive: true });

  desktop = spawn(desktopExe, [], {
    cwd: join(root, 'apps', 'desktop', 'src-tauri', 'target', 'release'),
    env: { ...process.env, APPDATA: appData, LOCALAPPDATA: localAppData },
    stdio: 'ignore',
    windowsHide: true,
  });

  await waitFor('packaged desktop API health', healthOk);
  const initial = await waitFor('initial packaged sidecars', async () => {
    const value = await captureSidecars();
    return value.server && value.runner ? value : undefined;
  });
  findings.push({ check: 'desktop-launches-both-sidecars', status: 'PASS' });

  terminatePid(Number(initial.server.ProcessId));
  const restartedServer = await waitFor('API sidecar restart', async () => {
    const value = await captureSidecars();
    return value.server && Number(value.server.ProcessId) !== Number(initial.server.ProcessId)
      ? value.server
      : undefined;
  });
  assert(await waitFor('restarted API health', healthOk), 'restarted API did not become healthy');
  findings.push({ check: 'desktop-restarts-crashed-api', status: 'PASS' });

  const beforeRunnerRestart = await captureSidecars();
  terminatePid(Number(beforeRunnerRestart.runner.ProcessId));
  await waitFor('discovery sidecar restart', async () => {
    const value = await captureSidecars();
    return value.runner && Number(value.runner.ProcessId) !== Number(beforeRunnerRestart.runner.ProcessId)
      ? value.runner
      : undefined;
  });
  findings.push({ check: 'desktop-restarts-crashed-discovery-runner', status: 'PASS' });

  assert(Number(restartedServer.ProcessId) !== Number(initial.server.ProcessId), 'API PID did not change');
  await closeDesktopNormally();
  await waitFor(
    'sidecars stopped after normal desktop exit',
    () => [...observedSidecars].every((pid) => !processExists(pid)),
    20_000,
  );
  findings.push({ check: 'normal-desktop-exit-stops-sidecars', status: 'PASS' });

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    desktop: { path: 'apps/desktop/src-tauri/target/release/printerops-desktop.exe', sha256: sha256(desktopExe) },
    isolation: { disposableAppData: true, windowHidden: true },
    findings,
    overall: 'PASS',
  };
  writeFileSync(join(artifacts, 'packaged-desktop-supervision-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[PASS] packaged desktop supervision smoke: ${findings.length} checks`);
  console.log('[INFO] Evidence: artifacts/prod-01/packaged-desktop-supervision-smoke.json');
} catch (error) {
  console.error(`[FAIL] packaged desktop supervision smoke: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (desktop && processExists(desktop.pid)) terminatePid(desktop.pid);
  for (const pid of observedSidecars) {
    if (processExists(pid)) terminatePid(pid);
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
