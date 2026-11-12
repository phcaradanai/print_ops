#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/smoke-app-image.mjs <image>');
const name = `printops-app-smoke-${process.pid}`;
const volume = `${name}-data`;
const password = `Smoke-${randomBytes(16).toString('hex')}!`;
const secret = randomBytes(32).toString('hex');
const expectedVersion = image.slice(image.lastIndexOf(':') + 1);
function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.error}`);
  return result.stdout.trim();
}
async function healthy() {
  const port = docker('port', name, '3001/tcp').split('\n')[0].split(':').pop();
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) {
        const body = await res.json();
        assert.equal(body.version, expectedVersion);
        return base;
      }
    } catch {}
    await setTimeout(1000);
  }
  throw new Error('Application did not become healthy');
}
async function json(base, path, body) {
  const res = await fetch(`${base}${path}`, body ? {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  } : {});
  assert.ok(res.ok, `${path}: HTTP ${res.status}`);
  return res.json();
}
function start() {
  docker('run', '-d', '--init', '--name', name, '-p', '127.0.0.1::3001',
    '-e', `JWT_SECRET=${secret}`, '-v', `${volume}:/data`, image);
}
try {
  docker('volume', 'create', volume);
  start();
  let base = await healthy();
  const home = await fetch(base);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<div id="root">/);
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset, 'SPA must include its built JavaScript');
  const js = await fetch(`${base}${asset}`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const appJS = await js.text();
  assert.ok(appJS.includes(expectedVersion), 'UI must carry the release version');
  const deepLink = await fetch(`${base}/jobs`, { headers: { accept: 'text/html' } });
  assert.equal(await deepLink.text(), html, 'Browser deep links must serve the SPA');
  assert.equal((await json(base, '/api/auth/bootstrap')).state, 'REQUIRED_NEW');
  const owner = { name: 'Smoke Owner', email: 'smoke@example.test', password, passwordConfirmation: password };
  await json(base, '/api/auth/bootstrap', owner);
  assert.equal((await json(base, '/api/auth/bootstrap')).state, 'READY');
  docker('exec', name, 'test', '-x', '/usr/local/bin/printops-runner');
  // Recreate the container, retaining only the named volume, to verify durability.
  await setTimeout(1000);
  docker('stop', '-t', '5', name);
  docker('rm', name);
  start();
  base = await healthy();
  assert.equal((await json(base, '/api/auth/bootstrap')).state, 'READY');
  const login = await json(base, '/api/auth/login', { email: owner.email, password });
  assert.ok(login.token, 'Persisted owner must be able to log in after recreation');
  const config = JSON.parse(docker('inspect', name))[0].Config;
  assert.ok(config.Env.includes('PRINTOPS_LOCAL_WORKER=true'));
  assert.ok(config.Env.includes('PRINTOPS_JOBS_ENABLED=false'));
  console.log(`PASS ${image}: health/version, SPA/assets/deep links, owner/login, SQLite persistence, runner binary, single API worker`);
} catch (error) {
  const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
  process.stderr.write(logs.stdout || '');
  process.stderr.write(logs.stderr || '');
  throw error;
} finally {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' });
}
