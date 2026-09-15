import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryOtaUpdateStateRepository } from '../infra/repos/in-memory-ota-state.repo.js';
import { OtaUpdateService, type OtaConfig } from '../services/ota-update.service.js';

let wan = '';
let lan = '';
const cases: Array<{ name: string; detail: string }> = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function pass(name: string, detail: string): void {
  cases.push({ name, detail });
  console.log(`[PASS] ${name}: ${detail}`);
}

async function control(base: string, value: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${base}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`OTA lab control failed at ${base}: HTTP ${response.status}`);
}

async function publicKey(base: string): Promise<string> {
  const response = await fetch(`${base}/__control`, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`OTA lab control read failed at ${base}: HTTP ${response.status}`);
  const body = await response.json() as { publicKey?: unknown };
  assert(typeof body.publicKey === 'string' && body.publicKey.trim(), `OTA lab ${base} did not expose a public key`);
  return body.publicKey;
}

type ServiceOptions = {
  publicKey?: string;
  requireSignature?: boolean;
  lanUrl?: string;
  wanUrl?: string;
  manifestTimeoutMs?: number;
  downloadTimeoutMs?: number;
};

async function withService<T>(options: ServiceOptions, action: (service: OtaUpdateService) => Promise<T>): Promise<T> {
  const cacheDir = await mkdtemp(join(tmpdir(), 'printops-ota-docker-'));
  const config: OtaConfig = {
    enabled: true,
    channel: 'stable',
    currentVersion: '0.1.28',
    currentSchemaVersion: 7,
    lanRelayUrl: options.lanUrl,
    wanManifestUrl: options.wanUrl,
    cacheDir,
    manifestTimeoutMs: options.manifestTimeoutMs ?? 1_000,
    downloadTimeoutMs: options.downloadTimeoutMs ?? 1_000,
    maxArtifactBytes: 1_000_000,
    requireSignature: options.requireSignature ?? true,
    publicKey: options.publicKey,
    healthCheckTimeoutMs: 250,
  };
  const service = new OtaUpdateService({
    state: new InMemoryOtaUpdateStateRepository(),
    config,
    installer: {
      async install() {
        return undefined;
      },
      async healthCheck() {
        return true;
      },
      async rollback() {
        return undefined;
      },
    },
  });
  try {
    return await action(service);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

async function expectCode(name: string, action: () => Promise<unknown>, expected: string[]): Promise<string> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  if (!thrown) throw new Error(`${name} unexpectedly succeeded`);
  const code = errorCode(thrown);
  if (!code || !expected.includes(code)) {
    throw new Error(`${name} returned ${code ?? 'an untyped error'}; expected ${expected.join(', ')}`);
  }
  pass(name, code);
  return code;
}

async function expectCheckFailure(name: string, options: ServiceOptions, expected: string[]): Promise<void> {
  await withService(options, async (service) => {
    await expectCode(name, () => service.checkForUpdate(), expected);
    const status = await service.getStatus();
    assert(status.state.state === 'CHECK_FAILED', `${name} did not persist CHECK_FAILED`);
  });
}

async function expectDownloadFailure(
  name: string,
  artifactMode: string,
  publicKeyValue: string,
  expected: string[],
  options: Partial<ServiceOptions> = {},
): Promise<void> {
  await control(wan, {
    manifestMode: 'healthy',
    artifactMode,
    delayMs: options.downloadTimeoutMs && options.downloadTimeoutMs < 100 ? 200 : 0,
  });
  await withService({ wanUrl: wan, publicKey: publicKeyValue, ...options }, async (service) => {
    const checked = await service.checkForUpdate();
    assert(checked.available && checked.latestVersion === '0.1.29', `${name} did not find the signed candidate`);
    await expectCode(name, () => service.downloadUpdate({ version: '0.1.29' }), expected);
    const status = await service.getStatus();
    assert(['DOWNLOAD_FAILED', 'VERIFY_FAILED'].includes(status.state.state), `${name} did not persist a download/verify failure`);
  });
}

async function expectManifestArtifactFailure(
  name: string,
  manifestMode: string,
  publicKeyValue: string,
  expected: string[],
): Promise<void> {
  await control(wan, { manifestMode, artifactMode: 'healthy', delayMs: 0 });
  await withService({ wanUrl: wan, publicKey: publicKeyValue }, async (service) => {
    const checked = await service.checkForUpdate();
    assert(checked.available, `${name} did not find the candidate before download verification`);
    await expectCode(name, () => service.downloadUpdate({ version: '0.1.29' }), expected);
    const status = await service.getStatus();
    assert(['DOWNLOAD_FAILED', 'VERIFY_FAILED'].includes(status.state.state), `${name} did not persist a download/verify failure`);
  });
}

async function main(): Promise<void> {
  const lanKey = await publicKey(lan);
  const wanKey = await publicKey(wan);

  await control(lan, { manifestMode: 'healthy', artifactMode: 'healthy', version: '0.1.29', delayMs: 0 });
  await control(wan, { manifestMode: 'http-500', artifactMode: 'healthy', version: '0.1.29', delayMs: 0 });
  await withService({ lanUrl: lan, wanUrl: wan, publicKey: lanKey }, async (service) => {
    const result = await service.checkForUpdate();
    assert(result.available && result.source === 'lan', 'healthy LAN source was not selected');
    pass('LAN source selection', 'signed envelope accepted from LAN relay');
  });

  await control(lan, { manifestMode: 'http-500', artifactMode: 'healthy', delayMs: 0 });
  await control(wan, { manifestMode: 'healthy', artifactMode: 'healthy', delayMs: 0 });
  await withService({ lanUrl: lan, wanUrl: wan, publicKey: wanKey }, async (service) => {
    const result = await service.checkForUpdate();
    assert(result.available && result.source === 'wan', 'WAN fallback was not selected after LAN failure');
    pass('WAN fallback', 'LAN failure did not mask a healthy signed WAN release');
  });

  await control(lan, { manifestMode: 'http-500' });
  await control(wan, { manifestMode: 'http-500' });
  await expectCheckFailure('LAN+WAN unavailable', { lanUrl: lan, wanUrl: wan, publicKey: wanKey }, ['OTA_SOURCE_UNAVAILABLE']);

  await control(wan, { manifestMode: 'healthy', artifactMode: 'healthy', delayMs: 0 });
  await withService({ wanUrl: wan, publicKey: wanKey }, async (service) => {
    const checked = await service.checkForUpdate();
    assert(checked.available, 'healthy signed release was not available');
    const downloaded = await service.downloadUpdate({ version: '0.1.29' });
    assert(downloaded.signatureVerification === 'verified', 'artifact signature was not independently verified');
    const installed = await service.installUpdate({ version: '0.1.29', mode: 'automatic' });
    assert(installed.state === 'COMPLETED' && installed.installed, 'signed local install did not complete');
    const status = await service.getStatus();
    assert(status.state.state === 'COMPLETED', 'COMPLETED install state was not persisted');
    pass('signed download and install', 'manifest envelope, artifact digest/signature, and COMPLETED state verified');
  });

  await control(wan, { manifestMode: 'wrong-manifest-signature', artifactMode: 'healthy' });
  await expectCheckFailure('tampered manifest envelope', { wanUrl: wan, publicKey: wanKey }, ['OTA_SIGNATURE_INVALID']);
  await control(wan, { manifestMode: 'missing-signature', artifactMode: 'healthy' });
  await expectCheckFailure('missing manifest signature', { wanUrl: wan, publicKey: wanKey }, ['OTA_SIGNATURE_REQUIRED']);
  await control(wan, { manifestMode: 'healthy', artifactMode: 'healthy' });
  await expectCheckFailure('wrong verification key', { wanUrl: wan, publicKey: lanKey }, ['OTA_SIGNATURE_INVALID']);
  await control(wan, { manifestMode: 'invalid-json', artifactMode: 'healthy' });
  await expectCheckFailure('invalid JSON manifest', { wanUrl: wan, requireSignature: false }, ['OTA_INVALID_MANIFEST']);
  await control(wan, { manifestMode: 'invalid-manifest', artifactMode: 'healthy' });
  await expectCheckFailure('invalid manifest schema', { wanUrl: wan, requireSignature: false }, ['OTA_INVALID_MANIFEST']);

  await control(wan, { manifestMode: 'old-release', artifactMode: 'healthy' });
  await withService({ wanUrl: wan, publicKey: wanKey }, async (service) => {
    const result = await service.checkForUpdate();
    assert(!result.available && result.reason === 'CURRENT', 'old release was not treated as current');
    pass('old release', 'older signed release was ignored');
  });
  await control(wan, { manifestMode: 'prerelease', artifactMode: 'healthy' });
  await withService({ wanUrl: wan, publicKey: wanKey }, async (service) => {
    const result = await service.checkForUpdate();
    assert(!result.available && result.reason === 'PRERELEASE_NOT_AUTO_UPDATED', 'stable channel accepted a prerelease');
    pass('stable prerelease policy', 'prerelease candidate was not auto-installed');
  });
  await control(wan, { manifestMode: 'incompatible-schema', artifactMode: 'healthy' });
  await expectCheckFailure('schema-changing release without DB backup path', { wanUrl: wan, publicKey: wanKey }, ['OTA_DB_BACKUP_UNAVAILABLE']);

  await expectManifestArtifactFailure('wrong artifact checksum', 'wrong-checksum', wanKey, ['OTA_VERIFY_FAILED']);
  await expectManifestArtifactFailure('wrong artifact signature', 'wrong-signature', wanKey, ['OTA_SIGNATURE_INVALID']);
  await expectDownloadFailure('truncated artifact', 'truncated', wanKey, ['OTA_DOWNLOAD_FAILED']);
  await expectDownloadFailure('corrupt artifact', 'corrupt', wanKey, ['OTA_DOWNLOAD_FAILED', 'OTA_VERIFY_FAILED']);
  await expectDownloadFailure('artifact HTTP 404', 'http-404', wanKey, ['OTA_DOWNLOAD_FAILED']);
  await expectDownloadFailure('artifact HTTP 500', 'http-500', wanKey, ['OTA_DOWNLOAD_FAILED']);
  await expectDownloadFailure('artifact timeout', 'slow', wanKey, ['OTA_TIMEOUT'], { downloadTimeoutMs: 50 });
  await expectDownloadFailure('artifact dropped connection', 'drop', wanKey, ['OTA_DOWNLOAD_FAILED']);

  await control(wan, { manifestMode: 'slow', artifactMode: 'healthy', delayMs: 200 });
  await expectCheckFailure('manifest timeout', { wanUrl: wan, publicKey: wanKey, manifestTimeoutMs: 50 }, ['OTA_SOURCE_UNAVAILABLE']);
  await control(wan, { manifestMode: 'drop', artifactMode: 'healthy', delayMs: 0 });
  await expectCheckFailure('manifest dropped connection', { wanUrl: wan, publicKey: wanKey }, ['OTA_SOURCE_UNAVAILABLE']);

  const outputDir = process.env.PRINTOPS_OTA_DOCKER_REPORT_DIR ?? join(process.cwd(), 'artifacts', 'prod-01');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, 'ota-docker-client-matrix.json'),
    `${JSON.stringify({ status: 'PASS', cases, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  console.log(`[ota-docker-client] ${cases.length} client/service assertions passed`);
}

export async function runClientMatrix(wanUrl: string, lanUrl: string): Promise<void> {
  if (!wanUrl || !lanUrl) throw new Error('OTA Docker client matrix requires both WAN and LAN URLs');
  wan = wanUrl;
  lan = lanUrl;
  cases.length = 0;
  await main();
}
