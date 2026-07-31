import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = resolve(import.meta.dirname, '..');
const resources = join(root, 'apps/desktop/src-tauri/resources');
const artifacts = join(root, 'artifacts/prod-01');
const work = mkdtempSync(join(tmpdir(), 'printops-packaged-smoke-'));
const dbPath = join(work, 'printops.db');
const logsDir = join(work, 'logs');
const serverLog = join(logsDir, 'server.log');
const runnerLog = join(logsDir, 'runner.log');
const serverExe = join(resources, 'server.exe');
const runnerExe = join(resources, 'printops-runner.exe');
const wasmPath = join(resources, 'sql-wasm.wasm');
const helperExe = join(resources, 'print-helper', 'printops-html-print.exe');
const jwtSecret = randomBytes(32).toString('hex');
const runnerSecret = randomBytes(32).toString('hex');
const ownerPassword = `Smoke-${randomBytes(8).toString('hex')}!Aa1`;
const findings = [];
let serverChild;
let runnerChild;

mkdirSync(logsDir, { recursive: true });

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function requireResource(path) {
  if (!statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`required packaged resource is missing or empty: ${path}`);
  }
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

function collect(child, target) {
  const chunks = [];
  child.stdout?.on('data', (value) => chunks.push(Buffer.from(value)));
  child.stderr?.on('data', (value) => chunks.push(Buffer.from(value)));
  child.once('close', () => writeFileSync(target, Buffer.concat(chunks)));
}

async function waitFor(label, check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

async function json(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => undefined);
  return { status: response.status, body };
}

function startServer(port) {
  const child = spawn(serverExe, [], {
    cwd: resources,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_MODE: 'sqlite',
      PRINTOPS_RUNTIME_MODE: 'packaged-windows-desktop',
      PRINTOPS_LOCAL_WORKER: 'true',
      PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED: 'false',
      PRINTOPS_DB_PATH: dbPath,
      PRINTOPS_LOG_DIR: logsDir,
      PRINTOPS_APP_VERSION: '0.1.15',
      PRINTOPS_GIT_COMMIT: 'packaged-sidecar-smoke',
      SQL_WASM_PATH: wasmPath,
      JWT_SECRET: jwtSecret,
      PRINTOPS_RUNNER_BOOTSTRAP_SECRET: runnerSecret,
      PRINTOPS_HTML_PRINT_HELPER: helperExe,
      PRINTOPS_DEV_SEED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  collect(child, serverLog);
  return child;
}

function startRunner(base) {
  const child = spawn(runnerExe, ['run'], {
    cwd: resources,
    env: {
      ...process.env,
      PRINTOPS_API_BASE_URL: base,
      PRINTOPS_RUNNER_NAME: 'packaged-smoke-discovery',
      PRINTOPS_DISCOVERY_MODE: 'fake',
      PRINTOPS_EXECUTOR_MODE: 'fake',
      PRINTOPS_JOBS_ENABLED: 'false',
      PRINTOPS_RUNNER_BOOTSTRAP_SECRET: runnerSecret,
      PRINTOPS_HEARTBEAT_INTERVAL_MS: '500',
      PRINTOPS_DISCOVERY_INTERVAL_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  collect(child, runnerLog);
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolveClose) => child.once('close', resolveClose)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

try {
  [serverExe, runnerExe, wasmPath, helperExe].forEach(requireResource);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  serverChild = startServer(port);
  await waitFor('packaged API health', async () => (await fetch(`${base}/health`)).ok);
  findings.push({ check: 'server-startup-health', status: 'PASS' });

  const initial = await json(base, '/auth/bootstrap');
  if (initial.status !== 200 || initial.body?.state !== 'REQUIRED_NEW') {
    throw new Error(`unexpected initial bootstrap state: ${JSON.stringify(initial)}`);
  }
  findings.push({ check: 'first-run-no-seeded-owner', status: 'PASS' });

  const bootstrapped = await json(base, '/auth/bootstrap', {
    method: 'POST',
    body: {
      name: 'Packaged Smoke Owner',
      email: 'packaged-smoke@example.invalid',
      password: ownerPassword,
      passwordConfirmation: ownerPassword,
    },
  });
  if (bootstrapped.status !== 201 || !bootstrapped.body?.token) {
    throw new Error(`owner bootstrap failed: ${JSON.stringify(bootstrapped)}`);
  }
  const auth = { authorization: `Bearer ${bootstrapped.body.token}` };
  findings.push({ check: 'owner-bootstrap', status: 'PASS' });

  runnerChild = startRunner(base);
  const runner = await waitFor('discovery runner registration', async () => {
    const result = await json(base, '/runners', { headers: auth });
    const rows = Array.isArray(result.body) ? result.body : result.body?.items;
    return rows?.find((item) => item.name === 'packaged-smoke-discovery');
  });
  if (runner.metadata?.jobs_enabled !== false || runner.supportedProtocols?.length !== 0) {
    throw new Error(`discovery runner advertised execution capability: ${JSON.stringify(runner)}`);
  }
  findings.push({ check: 'runner-discovery-only', status: 'PASS' });

  const architecture = await json(base, '/api/v1/print-flow/runtime-architecture', { headers: auth });
  if (architecture.status !== 200
      || architecture.body?.invariant?.code !== 'SINGLE_EXECUTOR'
      || architecture.body?.executor?.owner !== 'api-local-worker'
      || architecture.body?.discovery?.jobsEnabled !== false) {
    throw new Error(`unsafe runtime architecture: ${JSON.stringify(architecture)}`);
  }
  findings.push({ check: 'single-executor-invariant', status: 'PASS' });

  const readiness = await json(base, '/api/v1/system/readiness', { headers: auth });
  if (readiness.status !== 200
      || readiness.body?.components?.localApi?.state !== 'READY'
      || readiness.body?.components?.database?.state !== 'READY'
      || readiness.body?.components?.localPrintWorker?.state !== 'READY') {
    throw new Error(`core readiness is not healthy: ${JSON.stringify(readiness)}`);
  }
  findings.push({ check: 'core-readiness', status: 'PASS' });

  await stop(runnerChild);
  runnerChild = undefined;
  await stop(serverChild);
  serverChild = undefined;

  serverChild = startServer(port);
  await waitFor('restarted packaged API health', async () => (await fetch(`${base}/health`)).ok);
  const persisted = await json(base, '/auth/bootstrap');
  if (persisted.status !== 200 || persisted.body?.state !== 'READY') {
    throw new Error(`owner state did not survive restart: ${JSON.stringify(persisted)}`);
  }
  findings.push({ check: 'sqlite-restart-persistence', status: 'PASS' });

  mkdirSync(artifacts, { recursive: true });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    topology: 'packaged resources; API local worker + discovery-only Go runner',
    networkScope: 'loopback',
    resources: [serverExe, runnerExe, wasmPath, helperExe].map((path) => ({
      name: path.slice(resources.length + 1).replaceAll('\\', '/'),
      bytes: statSync(path).size,
      sha256: sha256(path),
    })),
    findings,
  };
  writeFileSync(join(artifacts, 'packaged-sidecar-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[PASS] packaged sidecar smoke: ${findings.length} checks`);
  console.log('[INFO] Evidence: artifacts/prod-01/packaged-sidecar-smoke.json');
} catch (error) {
  console.error(`[FAIL] packaged sidecar smoke: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stop(runnerChild);
  await stop(serverChild);
  rmSync(work, { recursive: true, force: true });
}
