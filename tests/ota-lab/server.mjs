import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number(process.env.PORT ?? 8080);
const role = process.env.ROLE ?? 'ota-source';
const manifestPath = process.env.MANIFEST_PATH;
const artifactPath = process.env.ARTIFACT_PATH;
const state = {
  manifestMode: 'healthy',
  artifactMode: 'healthy',
  delayMs: 0,
  version: '0.1.29',
  channel: 'stable',
  schemaVersion: 7,
  artifact: Buffer.from('printops-ota-lab-artifact-v0.1.29'),
};

function manifest() {
  const digest = createHash('sha256').update(state.artifact).digest('hex');
  const mode = state.manifestMode;
  return {
    schema_version: 1,
    release: {
      version: mode === 'old-release'
        ? '0.1.27'
        : mode === 'prerelease'
          ? `${state.version}-rc.1`
          : state.version,
      channel: state.channel,
      release_date: '2026-09-10T00:00:00.000Z',
      notes: 'deterministic local OTA lab release',
    },
    artifacts: {
      desktop: {
        'windows-x64': {
          url: 'desktop.artifact',
          sha256: mode === 'wrong-checksum' ? '0'.repeat(64) : digest,
          signature: mode === 'wrong-signature' ? 'not-a-signature' : '',
          size: state.artifact.byteLength,
          format: 'nsis-installer',
        },
      },
    },
    compatibility: {
      min_supported_version: '0.1.20',
      schema_version: mode === 'incompatible-schema' ? state.schemaVersion + 1 : state.schemaVersion,
    },
    rollout: { staged: false, rollout_percentage: 100 },
  };
}

function modeFor(request, type) {
  const configured = type === 'manifest' ? state.manifestMode : state.artifactMode;
  return new URL(request.url, 'http://ota-lab').searchParams.get('mode') ?? configured;
}

function writeJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

async function applyFailureMode(request, response, type) {
  const mode = modeFor(request, type);
  if (mode === 'drop') {
    request.socket.destroy();
    return true;
  }
  if (mode === 'slow') {
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, state.delayMs || 2_000)));
    return false;
  }
  if (mode === 'http-404' || mode === 'http-500') {
    writeJson(response, mode === 'http-404' ? 404 : 500, { error: mode });
    return true;
  }
  return false;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (url.pathname === '/__control' && request.method === 'GET') {
    return writeJson(response, 200, { role, ...state, artifact: undefined });
  }
  if (url.pathname === '/__control' && request.method === 'POST') {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    try {
      const input = JSON.parse(raw || '{}');
      for (const key of ['manifestMode', 'artifactMode', 'version', 'channel']) {
        if (typeof input[key] === 'string') state[key] = input[key];
      }
      if (Number.isSafeInteger(input.delayMs) && input.delayMs >= 0) state.delayMs = input.delayMs;
      if (Number.isSafeInteger(input.schemaVersion) && input.schemaVersion >= 0) state.schemaVersion = input.schemaVersion;
      if (typeof input.artifact === 'string') state.artifact = Buffer.from(input.artifact);
      return writeJson(response, 200, { ok: true, role, ...state, artifact: undefined });
    } catch {
      return writeJson(response, 400, { error: 'invalid control JSON' });
    }
  }
  if (url.pathname === '/manifest.json') {
    const failed = await applyFailureMode(request, response, 'manifest');
    if (failed === true) return;
    const mode = modeFor(request, 'manifest');
    if (mode === 'invalid-json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end('{ definitely-not-json');
    }
    const external = manifestPath && mode === 'healthy'
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : undefined;
    const value = external ?? (mode === 'invalid-manifest'
      ? { schema_version: 1, release: { version: state.version } }
      : manifest());
    const body = JSON.stringify(value);
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    return response.end(body);
  }
  if (url.pathname === '/desktop.artifact') {
    const failed = await applyFailureMode(request, response, 'artifact');
    if (failed === true) return;
    let body = artifactPath ? readFileSync(artifactPath) : state.artifact;
    if (modeFor(request, 'artifact') === 'corrupt') body = Buffer.from('corrupted-artifact');
    if (modeFor(request, 'artifact') === 'truncated') body = body.subarray(0, Math.max(1, Math.floor(body.length / 2)));
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
    return response.end(body);
  }
  writeJson(response, 404, { error: 'not found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[ota-lab] ${role} listening on ${port}`);
});
