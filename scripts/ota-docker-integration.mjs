import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const composeFile = 'tests/ota-lab/docker-compose.yml';
const compose = (args) => execFileSync('docker', ['compose', '-f', composeFile, ...args], {
  cwd: root,
  stdio: 'inherit',
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(base, path, init) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await fetch(`${base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(3_000),
      });
    } catch (error) {
      if (attempt === 29) throw error;
      await wait(250);
    }
  }
  throw new Error('unreachable');
}

async function control(base, value) {
  const response = await request(base, '/__control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`control failed: HTTP ${response.status}`);
}

async function expectStatus(base, path, status) {
  const response = await request(base, path);
  if (response.status !== status) throw new Error(`${path} returned ${response.status}, expected ${status}`);
}

try {
  compose(['up', '--build', '--detach', '--remove-orphans']);
  const wan = 'http://127.0.0.1:18080';
  const lan = 'http://127.0.0.1:18081';
  await expectStatus(wan, '/manifest.json', 200);
  await expectStatus(wan, '/desktop.artifact', 200);

  for (const mode of ['http-404', 'http-500', 'invalid-json', 'invalid-manifest', 'old-release', 'prerelease', 'incompatible-schema', 'wrong-checksum', 'wrong-signature']) {
    await control(wan, { manifestMode: mode });
    const expected = mode.startsWith('http-') ? Number(mode.slice(5)) : 200;
    await expectStatus(wan, '/manifest.json', expected);
  }
  await control(wan, { manifestMode: 'healthy', artifactMode: 'truncated' });
  await expectStatus(wan, '/desktop.artifact', 200);
  await control(wan, { artifactMode: 'corrupt' });
  await expectStatus(wan, '/desktop.artifact', 200);
  await control(wan, { manifestMode: 'slow', artifactMode: 'slow', delayMs: 50 });
  await expectStatus(wan, '/manifest.json', 200);
  await control(wan, { manifestMode: 'drop' });
  let dropped = false;
  try {
    await request(wan, '/manifest.json');
  } catch {
    dropped = true;
  }
  if (!dropped) throw new Error('drop mode unexpectedly returned a response');

  // LAN and WAN are independent sources; a failed LAN must not alter WAN.
  await control(lan, { manifestMode: 'http-500' });
  await control(wan, { manifestMode: 'healthy', artifactMode: 'healthy' });
  await expectStatus(wan, '/manifest.json', 200);
  console.log('[ota-docker] deterministic WAN/LAN failure matrix passed');
} finally {
  try {
    compose(['down', '--volumes', '--remove-orphans']);
  } catch (error) {
    console.error('[ota-docker] compose cleanup failed', error);
    process.exitCode = 1;
  }
}
