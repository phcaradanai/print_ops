import { connect } from 'node:net';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const image = process.env.PRINTOPS_E2E_NATS_IMAGE
  ?? 'nats@sha256:b83efabe3e7def1e0a4a31ec6e078999bb17c80363f881df35edc70fcb6bb927';
const name = `printops-nats-e2e-${process.pid}`;

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    ...options,
  });
}

function requireSuccess(result, label) {
  if (result.status === 0) return result;
  throw new Error(`${label} failed:\n${result.stderr || result.stdout || 'unknown error'}`);
}

async function waitForPort(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolveConnection) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolveConnection(true);
      });
      socket.once('error', () => resolveConnection(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolveConnection(false);
      });
    });
    if (connected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`temporary NATS server did not listen on ${port}`);
}

let started = false;
try {
  const goBuild = spawnSync('go', [
    'build', '-trimpath',
    '-o', 'printops-runner.exe',
    './cmd/printops-runner/',
  ], {
    cwd: resolve(root, 'apps/runner-go'),
    encoding: 'utf8',
    shell: false,
  });
  requireSuccess(goBuild, 'Go runner build');

  requireSuccess(docker([
    'run', '--detach', '--rm',
    '--name', name,
    '--publish', '127.0.0.1::4222',
    image,
    '--jetstream',
  ]), 'docker run');
  started = true;

  const mapping = requireSuccess(docker(['port', name, '4222/tcp']), 'docker port').stdout.trim();
  const port = Number(mapping.match(/:(\d+)\s*$/)?.[1]);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`cannot parse NATS port mapping: ${mapping}`);
  await waitForPort(port);

  const result = spawnSync(process.execPath, [
    '--import', 'tsx',
    'apps/api/src/tests/e2e/harness.ts',
  ], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      PRINTOPS_E2E_NATS_URL: `nats://127.0.0.1:${port}`,
      PRINTOPS_E2E_NATS_IMAGE: image,
    },
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`real NATS E2E harness exited ${result.status}`);
} catch (error) {
  if (started) {
    const logs = docker(['logs', name]);
    if (logs.stdout) process.stderr.write(`\n[NATS container log]\n${logs.stdout}`);
    if (logs.stderr) process.stderr.write(logs.stderr);
  }
  throw error;
} finally {
  if (started) docker(['stop', '--time', '3', name]);
}
