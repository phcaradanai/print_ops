import type {
  ArtifactComponent,
  ArtifactEntry,
  ArtifactPlatform,
  JobRepositoryPort,
  JobQueuePort,
  OtaUpdateStateRecord,
  OtaUpdateStateRepositoryPort,
  ReleaseChannel,
  ReleaseManifest,
} from '@printerops/domain';
import {
  compareVersions,
  isValidVersion,
  parseVersion,
} from '@printerops/domain';
import { AppError, ConflictError, ValidationError } from '@printerops/shared';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, rename, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PrintAdmissionGatePort } from './print-admission-gate.js';
import type { OtaArtifactStateStorePort } from './ota-artifact-state.js';
import { isExternalUpdaterTerminalPhase, readExternalUpdaterState } from './ota-updater-state.js';

const ARTIFACT_COMPONENTS = ['desktop', 'runner', 'api'] as const;
const ARTIFACT_PLATFORMS = ['windows-x64', 'node-bundle'] as const;
const RELEASE_CHANNELS = ['stable', 'beta', 'rc'] as const;
const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const DEFAULT_MANIFEST_TIMEOUT_MS = 5_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000;
const DEFAULT_QUEUE_IDLE_TIMEOUT_MS = 60 * 60 * 1_000;
const DEFAULT_QUEUE_POLL_MS = 5_000;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 20_000;
const DEFAULT_UPDATER_SHUTDOWN_TIMEOUT_MS = 30_000;
const DEFAULT_UPDATER_HANDOFF_DELAY_MS = 500;
const DEFAULT_SCHEMA_VERSION = 7;
const DEFAULT_AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_AUTO_UPDATE_JITTER_MS = 5 * 60 * 1_000;
const DEFAULT_AUTO_UPDATE_RETRY_BASE_MS = 60 * 1_000;
const DEFAULT_AUTO_UPDATE_RETRY_MAX_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_AUTO_UPDATE_MAX_FAILURES = 5;
const NON_TERMINAL_JOB_STATUSES = ['ACCEPTED', 'VALIDATED', 'QUEUED', 'DISPATCHED', 'PRINTING'] as const;

export type OtaSource = 'lan' | 'wan' | 'cache';
export type OtaFetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export interface OtaConfig {
  enabled: boolean;
  channel: ReleaseChannel;
  currentVersion: string;
  currentSchemaVersion: number;
  lanRelayUrl?: string;
  wanManifestUrl?: string;
  cacheDir: string;
  manifestTimeoutMs: number;
  downloadTimeoutMs: number;
  maxArtifactBytes: number;
  queueIdleTimeoutMs?: number;
  queuePollMs?: number;
  healthCheckTimeoutMs?: number;
  requireSignature?: boolean;
  publicKey?: string;
  updaterPath?: string;
  updaterRequestDirectory?: string;
  updaterStatePath?: string;
  artifactStatePath?: string;
  installRoot?: string;
  desktopPath?: string;
  desktopPid?: number;
  apiUrl?: string;
  healthToken?: string;
  updaterShutdownTimeoutMs?: number;
  updaterHandoffDelayMs?: number;
  databasePath?: string;
  policyStatePath?: string;
  autoUpdateEnabled?: boolean;
  autoUpdateCheckIntervalMs?: number;
  autoUpdateJitterMs?: number;
  autoUpdateRetryBaseMs?: number;
  autoUpdateRetryMaxMs?: number;
  autoUpdateMaxFailures?: number;
}

export interface OtaStatus {
  enabled: boolean;
  configured: boolean;
  currentVersion: string;
  currentSchemaVersion: number;
  channel: ReleaseChannel;
  signatureVerification: 'required' | 'deferred' | 'unavailable';
  installerConfigured: boolean;
  state: OtaUpdateStateRecord;
  stagedArtifact: {
    version: string;
    component: ArtifactComponent;
    platform: ArtifactPlatform;
    bytes: number;
    sha256: string;
    signature: string;
    format?: string;
    source: OtaSource;
  } | null;
}

export type UpdateCheckReason =
  | 'DISABLED'
  | 'CURRENT'
  | 'CHANNEL_MISMATCH'
  | 'PRERELEASE_NOT_AUTO_UPDATED';

export interface UpdateCheckResult {
  enabled: boolean;
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  channel: ReleaseChannel;
  source?: Exclude<OtaSource, 'cache'>;
  reason?: UpdateCheckReason;
  compatibility?: ReleaseManifest['compatibility'];
}

export interface DownloadUpdateRequest {
  version: string;
  component?: ArtifactComponent;
  platform?: ArtifactPlatform;
}

export interface DownloadUpdateResult {
  downloaded: boolean;
  alreadyCurrent: boolean;
  version: string;
  component: ArtifactComponent;
  platform: ArtifactPlatform;
  bytes: number;
  sha256: string;
  source: OtaSource;
  signatureVerification: 'verified' | 'deferred';
}

export interface OtaInstallRequest {
  version: string;
  component?: ArtifactComponent;
  platform?: ArtifactPlatform;
}

export interface OtaInstallInput {
  artifactPath: string;
  version: string;
  component: ArtifactComponent;
  platform: ArtifactPlatform;
  sha256: string;
  bytes: number;
  signature: string;
  format?: string;
  previousVersion?: string;
  databasePath?: string;
  databaseSchemaVersion?: number;
  targetSchemaVersion?: number;
}

export interface OtaInstallLaunch {
  kind: 'external';
  operationId: string;
}

export interface OtaInstallerPort {
  /** Install/swap the already verified artifact and restart the target process. */
  install(input: OtaInstallInput): Promise<void | OtaInstallLaunch>;
  /** Probe the newly started target and return true only when it is healthy. */
  healthCheck(input: OtaInstallInput): Promise<boolean>;
  /** Restore the previous version after install or health-check failure. */
  rollback(input: OtaInstallInput): Promise<void | OtaInstallLaunch>;
}

export interface OtaInstallResult {
  installed: boolean;
  version: string;
  component: ArtifactComponent;
  platform: ArtifactPlatform;
  state: 'RESTART_PENDING' | 'ROLLED_BACK';
  restartRequired?: boolean;
  operationId?: string;
}

export interface OtaRollbackResult {
  rolledBack: boolean;
  version: string;
  component: ArtifactComponent;
  platform: ArtifactPlatform;
  state: 'ROLLED_BACK' | 'RESTART_PENDING';
  restartRequired?: boolean;
  operationId?: string;
}

export interface OtaUpdateServicePort {
  getStatus(): Promise<OtaStatus>;
  checkForUpdate(): Promise<UpdateCheckResult>;
  downloadUpdate(request: DownloadUpdateRequest): Promise<DownloadUpdateResult>;
  installUpdate(request: OtaInstallRequest): Promise<OtaInstallResult>;
  rollbackUpdate(): Promise<OtaRollbackResult>;
  recordExternalOutcome(input: OtaExternalOutcome): Promise<void>;
}

export interface OtaExternalOutcome {
  operationId: string;
  version: string;
  state: 'COMPLETED' | 'ROLLED_BACK' | 'INSTALL_FAILED' | 'HEALTH_CHECK_FAILED' | 'ROLLBACK_FAILED';
  errorMessage?: string;
}

interface ResolvedManifest {
  manifest: ReleaseManifest;
  source: Exclude<OtaSource, 'cache'>;
  manifestUrl: string;
}

interface StagedInstallArtifact extends OtaInstallInput {
  source: OtaSource;
}

interface SourceCandidate {
  kind: Exclude<OtaSource, 'cache'>;
  url: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function valueAt(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function requiredString(record: JsonRecord, label: string, ...keys: string[]): string {
  const value = valueAt(record, ...keys);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('OTA_INVALID_MANIFEST', `Manifest field '${label}' must be a non-empty string`, 502);
  }
  return value.trim();
}

function requiredNumber(record: JsonRecord, label: string, ...keys: string[]): number {
  const value = valueAt(record, ...keys);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('OTA_INVALID_MANIFEST', `Manifest field '${label}' must be a finite number`, 502);
  }
  return value;
}

function manifestError(message: string): AppError {
  return new AppError('OTA_INVALID_MANIFEST', message, 502);
}

function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return typeof value === 'string' && (RELEASE_CHANNELS as readonly string[]).includes(value);
}

function isArtifactComponent(value: unknown): value is ArtifactComponent {
  return typeof value === 'string' && (ARTIFACT_COMPONENTS as readonly string[]).includes(value);
}

function isArtifactPlatform(value: unknown): value is ArtifactPlatform {
  return typeof value === 'string' && (ARTIFACT_PLATFORMS as readonly string[]).includes(value);
}

function isArtifactFormat(value: unknown): value is 'nsis-installer' | 'binary' | 'archive' {
  return value === 'nsis-installer' || value === 'binary' || value === 'archive';
}

function parseArtifact(value: unknown, label: string): ArtifactEntry {
  const record = asRecord(value);
  if (!record) throw manifestError(`Manifest artifact '${label}' must be an object`);

  const url = requiredString(record, `${label}.url`, 'url');
  const sha256 = requiredString(record, `${label}.sha256`, 'sha256').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw manifestError(`Manifest artifact '${label}.sha256' must be a SHA-256 hex digest`);
  }

  const signatureValue = valueAt(record, 'signature');
  if (signatureValue !== undefined && typeof signatureValue !== 'string') {
    throw manifestError(`Manifest artifact '${label}.signature' must be a string`);
  }

  const formatValue = valueAt(record, 'format');
  if (formatValue !== undefined && !isArtifactFormat(formatValue)) {
    throw manifestError(`Manifest artifact '${label}.format' must be nsis-installer, binary, or archive`);
  }

  const size = requiredNumber(record, `${label}.size`, 'size');
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw manifestError(`Manifest artifact '${label}.size' must be a positive integer`);
  }

  return {
    url,
    sha256,
    signature: typeof signatureValue === 'string' ? signatureValue : '',
    size,
    ...(formatValue !== undefined ? { format: formatValue } : {}),
  };
}

/** Parse the wire manifest while accepting the snake_case JSON contract. */
export function parseReleaseManifest(input: unknown): ReleaseManifest {
  const root = asRecord(input);
  if (!root) throw manifestError('Release manifest must be a JSON object');

  const schemaVersion = requiredNumber(root, 'schema_version', 'schema_version', 'schemaVersion');
  if (schemaVersion !== 1) throw manifestError(`Unsupported release manifest schema version: ${schemaVersion}`);

  const release = asRecord(valueAt(root, 'release'));
  if (!release) throw manifestError("Manifest field 'release' must be an object");
  const version = requiredString(release, 'release.version', 'version');
  const channelValue = requiredString(release, 'release.channel', 'channel');
  if (!isReleaseChannel(channelValue)) {
    throw manifestError(`Unsupported release channel: ${channelValue}`);
  }
  const releaseDate = requiredString(release, 'release.release_date', 'release_date', 'releaseDate');
  if (Number.isNaN(Date.parse(releaseDate))) {
    throw manifestError(`Manifest release date is not a valid ISO date: ${releaseDate}`);
  }
  const notesValue = valueAt(release, 'notes');
  if (notesValue !== undefined && typeof notesValue !== 'string') {
    throw manifestError("Manifest field 'release.notes' must be a string");
  }
  if (!isValidVersion(version)) throw manifestError(`Invalid release version: ${version}`);

  const artifactsRecord = asRecord(valueAt(root, 'artifacts'));
  if (!artifactsRecord) throw manifestError("Manifest field 'artifacts' must be an object");
  const artifacts: ReleaseManifest['artifacts'] = {};
  for (const component of ARTIFACT_COMPONENTS) {
    const componentRecord = asRecord(artifactsRecord[component]);
    if (!componentRecord) continue;
    const entries: Partial<Record<ArtifactPlatform, ArtifactEntry>> = {};
    for (const platform of ARTIFACT_PLATFORMS) {
      if (componentRecord[platform] !== undefined) {
        entries[platform] = parseArtifact(componentRecord[platform], `${component}.${platform}`);
      }
    }
    if (Object.keys(entries).length > 0) artifacts[component] = entries;
  }

  const compatibility = asRecord(valueAt(root, 'compatibility'));
  if (!compatibility) throw manifestError("Manifest field 'compatibility' must be an object");
  const minSupportedVersion = requiredString(
    compatibility,
    'compatibility.min_supported_version',
    'min_supported_version',
    'minSupportedVersion',
  );
  if (!isValidVersion(minSupportedVersion)) {
    throw manifestError(`Invalid minimum supported version: ${minSupportedVersion}`);
  }
  const requiredSchemaVersion = requiredNumber(
    compatibility,
    'compatibility.schema_version',
    'schema_version',
    'schemaVersion',
  );
  if (!Number.isSafeInteger(requiredSchemaVersion) || requiredSchemaVersion < 0) {
    throw manifestError('Manifest compatibility.schema_version must be a non-negative integer');
  }
  const minVsRelease = compareVersions(minSupportedVersion, version);
  if (minVsRelease === null || minVsRelease > 0) {
    throw manifestError('Manifest min_supported_version cannot be newer than release.version');
  }

  const rollout = asRecord(valueAt(root, 'rollout'));
  if (!rollout) throw manifestError("Manifest field 'rollout' must be an object");
  const rolloutPercentage = requiredNumber(
    rollout,
    'rollout.rollout_percentage',
    'rollout_percentage',
    'rolloutPercentage',
  );
  if (!Number.isInteger(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100) {
    throw manifestError('Manifest rollout percentage must be an integer from 0 to 100');
  }
  const stagedValue = valueAt(rollout, 'staged');
  if (typeof stagedValue !== 'boolean') throw manifestError("Manifest field 'rollout.staged' must be boolean");

  return {
    schemaVersion: 1,
    release: {
      version,
      channel: channelValue,
      releaseDate,
      notes: typeof notesValue === 'string' ? notesValue : '',
    },
    artifacts,
    compatibility: {
      minSupportedVersion,
      schemaVersion: requiredSchemaVersion,
    },
    rollout: {
      staged: stagedValue,
      rolloutPercentage,
    },
  };
}

function boolFromEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  switch (raw.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      throw new ValidationError('PRINTOPS_OTA_ENABLED must be true or false');
  }
}

function integerFromEnv(raw: string | undefined, fallback: number, label: string, min: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new ValidationError(`${label} must be an integer >= ${min}`);
  }
  return value;
}

function urlFromEnv(raw: string | undefined, label: string): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    throw new ValidationError(`${label} must be an absolute http(s) URL`);
  }
  return value;
}

export function otaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OtaConfig {
  const enabled = boolFromEnv(env['PRINTOPS_OTA_ENABLED'], false);
  const channelValue = (env['PRINTOPS_OTA_CHANNEL'] ?? 'stable').trim();
  if (!isReleaseChannel(channelValue)) {
    throw new ValidationError('PRINTOPS_OTA_CHANNEL must be stable, beta, or rc');
  }

  const dbPath = env['PRINTOPS_DB_PATH']?.trim();
  const databasePath = dbPath || (env['DB_MODE'] === 'sqlite' ? resolve(process.cwd(), 'printops.db') : undefined);
  const dataDir = env['PRINTOPS_OTA_DATA_DIR']
    ?? (dbPath ? dirname(dbPath) : join(process.cwd(), '.printops-data'));
  const cacheDir = env['PRINTOPS_OTA_CACHE_DIR']?.trim() || join(dataDir, 'ota', 'cache');
  const desktopPid = env['PRINTOPS_DESKTOP_PID']?.trim()
    ? integerFromEnv(env['PRINTOPS_DESKTOP_PID'], 0, 'PRINTOPS_DESKTOP_PID', 1)
    : undefined;

  return {
    enabled,
    channel: channelValue,
    // Packaged Desktop injects this value from the Tauri release version. A
    // standalone process without it must not silently present itself as an
    // old, updatable production release.
    currentVersion: (env['PRINTOPS_APP_VERSION'] ?? 'development').trim(),
    currentSchemaVersion: integerFromEnv(
      env['PRINTOPS_DB_SCHEMA_VERSION'],
      DEFAULT_SCHEMA_VERSION,
      'PRINTOPS_DB_SCHEMA_VERSION',
      0,
    ),
    lanRelayUrl: urlFromEnv(env['PRINTOPS_OTA_LAN_RELAY_URL'], 'PRINTOPS_OTA_LAN_RELAY_URL'),
    wanManifestUrl: urlFromEnv(
      env['PRINTOPS_OTA_WAN_MANIFEST_URL'] ?? env['PRINTOPS_OTA_MANIFEST_URL'],
      'PRINTOPS_OTA_WAN_MANIFEST_URL',
    ),
    cacheDir,
    manifestTimeoutMs: integerFromEnv(
      env['PRINTOPS_OTA_MANIFEST_TIMEOUT_MS'],
      DEFAULT_MANIFEST_TIMEOUT_MS,
      'PRINTOPS_OTA_MANIFEST_TIMEOUT_MS',
      1,
    ),
    downloadTimeoutMs: integerFromEnv(
      env['PRINTOPS_OTA_DOWNLOAD_TIMEOUT_MS'],
      DEFAULT_DOWNLOAD_TIMEOUT_MS,
      'PRINTOPS_OTA_DOWNLOAD_TIMEOUT_MS',
      1,
    ),
    maxArtifactBytes: integerFromEnv(
      env['PRINTOPS_OTA_MAX_ARTIFACT_BYTES'],
      DEFAULT_MAX_ARTIFACT_BYTES,
      'PRINTOPS_OTA_MAX_ARTIFACT_BYTES',
      1,
    ),
    queueIdleTimeoutMs: integerFromEnv(
      env['PRINTOPS_OTA_QUEUE_IDLE_TIMEOUT_MS'],
      DEFAULT_QUEUE_IDLE_TIMEOUT_MS,
      'PRINTOPS_OTA_QUEUE_IDLE_TIMEOUT_MS',
      1,
    ),
    queuePollMs: integerFromEnv(
      env['PRINTOPS_OTA_QUEUE_POLL_MS'],
      DEFAULT_QUEUE_POLL_MS,
      'PRINTOPS_OTA_QUEUE_POLL_MS',
      1,
    ),
    healthCheckTimeoutMs: integerFromEnv(
      env['PRINTOPS_OTA_HEALTH_CHECK_TIMEOUT_MS'],
      DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      'PRINTOPS_OTA_HEALTH_CHECK_TIMEOUT_MS',
      1,
    ),
    requireSignature: boolFromEnv(env['PRINTOPS_OTA_REQUIRE_SIGNATURE'], enabled),
    publicKey: env['PRINTOPS_OTA_PUBLIC_KEY']?.trim() || undefined,
    updaterPath: env['PRINTOPS_OTA_UPDATER_PATH']?.trim() || undefined,
    updaterRequestDirectory: env['PRINTOPS_OTA_UPDATER_REQUEST_DIR']?.trim()
      || join(dataDir, 'ota', 'requests'),
    updaterStatePath: env['PRINTOPS_OTA_UPDATER_STATE_PATH']?.trim()
      || join(dataDir, 'ota', 'updater-state.json'),
    artifactStatePath: env['PRINTOPS_OTA_ARTIFACT_STATE_PATH']?.trim()
      || join(dataDir, 'ota', 'staged-artifact.json'),
    installRoot: env['PRINTOPS_OTA_INSTALL_ROOT']?.trim() || undefined,
    desktopPath: env['PRINTOPS_OTA_DESKTOP_PATH']?.trim() || undefined,
    desktopPid,
    apiUrl: urlFromEnv(env['PRINTOPS_OTA_API_URL'], 'PRINTOPS_OTA_API_URL')
      ?? 'http://127.0.0.1:31415',
    healthToken: env['PRINTOPS_OTA_HEALTH_TOKEN']?.trim() || undefined,
    updaterShutdownTimeoutMs: integerFromEnv(
      env['PRINTOPS_OTA_UPDATER_SHUTDOWN_TIMEOUT_MS'],
      DEFAULT_UPDATER_SHUTDOWN_TIMEOUT_MS,
      'PRINTOPS_OTA_UPDATER_SHUTDOWN_TIMEOUT_MS',
      1,
    ),
    updaterHandoffDelayMs: integerFromEnv(
      env['PRINTOPS_OTA_UPDATER_HANDOFF_DELAY_MS'],
      DEFAULT_UPDATER_HANDOFF_DELAY_MS,
      'PRINTOPS_OTA_UPDATER_HANDOFF_DELAY_MS',
      0,
    ),
    databasePath,
    policyStatePath: env['PRINTOPS_OTA_POLICY_STATE_PATH']?.trim()
      || join(dataDir, 'ota', 'auto-policy-state.json'),
    // Automatic installation is an explicit operator opt-in even when the
    // signed/manual OTA engine itself is enabled.
    autoUpdateEnabled: boolFromEnv(env['PRINTOPS_OTA_AUTO_UPDATE_ENABLED'], false),
    autoUpdateCheckIntervalMs: integerFromEnv(
      env['PRINTOPS_OTA_AUTO_UPDATE_CHECK_INTERVAL_MS'],
      DEFAULT_AUTO_UPDATE_CHECK_INTERVAL_MS,
      'PRINTOPS_OTA_AUTO_UPDATE_CHECK_INTERVAL_MS',
      1_000,
    ),
    autoUpdateJitterMs: integerFromEnv(
      env['PRINTOPS_OTA_AUTO_UPDATE_JITTER_MS'],
      DEFAULT_AUTO_UPDATE_JITTER_MS,
      'PRINTOPS_OTA_AUTO_UPDATE_JITTER_MS',
      0,
    ),
    autoUpdateRetryBaseMs: integerFromEnv(
      env['PRINTOPS_OTA_AUTO_UPDATE_RETRY_BASE_MS'],
      DEFAULT_AUTO_UPDATE_RETRY_BASE_MS,
      'PRINTOPS_OTA_AUTO_UPDATE_RETRY_BASE_MS',
      1_000,
    ),
    autoUpdateRetryMaxMs: integerFromEnv(
      env['PRINTOPS_OTA_AUTO_UPDATE_RETRY_MAX_MS'],
      DEFAULT_AUTO_UPDATE_RETRY_MAX_MS,
      'PRINTOPS_OTA_AUTO_UPDATE_RETRY_MAX_MS',
      1_000,
    ),
    autoUpdateMaxFailures: integerFromEnv(
      env['PRINTOPS_OTA_AUTO_UPDATE_MAX_FAILURES'],
      DEFAULT_AUTO_UPDATE_MAX_FAILURES,
      'PRINTOPS_OTA_AUTO_UPDATE_MAX_FAILURES',
      1,
    ),
  };
}

function manifestUrlForSource(value: string): string {
  const url = new URL(value);
  if (!/\/manifest\.json$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/manifest.json`;
  }
  return url.toString();
}

function artifactUrl(manifestUrl: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value, manifestUrl);
  } catch {
    throw new AppError('OTA_INVALID_MANIFEST', 'Artifact URL is not a valid URL', 502);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('OTA_INVALID_MANIFEST', 'Artifact URL must use http or https', 502);
  }
  return url.toString();
}

function safeErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  const input = createReadStream(path);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest('hex');
}

function signatureBytes(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-f]{128}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return Buffer.from(trimmed, 'base64');
}

function publicKeyObject(value: string): ReturnType<typeof createPublicKey> {
  const trimmed = value.trim();
  if (trimmed.includes('BEGIN PUBLIC KEY')) return createPublicKey(trimmed);

  const raw = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (raw.length !== 32) throw new Error('Ed25519 public key must be PEM or 32 raw bytes');
  // SubjectPublicKeyInfo prefix for an Ed25519 public key.
  return createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
    format: 'der',
    type: 'spki',
  });
}

function verifyArtifactSignature(sha256: string, signature: string, publicKey: string | undefined): void {
  if (!signature.trim()) throw new AppError('OTA_SIGNATURE_REQUIRED', 'Release artifact has no Ed25519 signature', 422);
  if (!publicKey?.trim()) throw new AppError('OTA_SIGNATURE_UNAVAILABLE', 'No OTA Ed25519 public key is configured', 503);
  let valid = false;
  try {
    const signatureValue = signatureBytes(signature);
    valid = signatureValue.length === 64
      && verifySignature(null, Buffer.from(sha256, 'hex'), publicKeyObject(publicKey), signatureValue);
  } catch {
    valid = false;
  }
  if (!valid) throw new AppError('OTA_SIGNATURE_INVALID', 'Release artifact signature is invalid', 422);
}

export class OtaUpdateService implements OtaUpdateServicePort {
  private operation: Promise<unknown> | undefined;
  private stagedArtifact: StagedInstallArtifact | null = null;

  constructor(
    private readonly deps: {
      state: OtaUpdateStateRepositoryPort;
      config: OtaConfig;
      fetchImpl?: OtaFetch;
      now?: () => Date;
      queue?: JobQueuePort;
      jobs?: JobRepositoryPort;
      admission?: PrintAdmissionGatePort;
      schedulerSettled?: () => Promise<void>;
      eventBusSettled?: () => Promise<void>;
      installer?: OtaInstallerPort;
      artifactState?: OtaArtifactStateStorePort;
    },
  ) {}

  async getStatus(): Promise<OtaStatus> {
    await this.reconcileExternalUpdaterState();
    const staged = this.stagedArtifact ?? await this.loadPersistedArtifact();
    return {
      enabled: this.deps.config.enabled,
      configured: Boolean(this.deps.config.lanRelayUrl || this.deps.config.wanManifestUrl),
      currentVersion: this.deps.config.currentVersion,
      currentSchemaVersion: this.deps.config.currentSchemaVersion,
      channel: this.deps.config.channel,
      signatureVerification: this.deps.config.requireSignature
        ? (this.deps.config.publicKey ? 'required' : 'unavailable')
        : 'deferred',
      installerConfigured: Boolean(this.deps.installer),
      state: await this.deps.state.get(),
      stagedArtifact: staged
        ? {
            version: staged.version,
            component: staged.component,
            platform: staged.platform,
            bytes: staged.bytes,
            sha256: staged.sha256,
            signature: staged.signature,
            ...(staged.format ? { format: staged.format } : {}),
            source: staged.source,
          }
        : null,
    };
  }

  async checkForUpdate(): Promise<UpdateCheckResult> {
    if (!this.deps.config.enabled) {
      return {
        enabled: false,
        available: false,
        currentVersion: this.deps.config.currentVersion,
        channel: this.deps.config.channel,
        reason: 'DISABLED',
      };
    }

    return this.runExclusive(async () => this.checkForUpdateInternal());
  }

  async downloadUpdate(request: DownloadUpdateRequest): Promise<DownloadUpdateResult> {
    if (!this.deps.config.enabled) throw new AppError('OTA_DISABLED', 'OTA is disabled', 409);
    if (!isValidVersion(request.version)) throw new ValidationError('version must be a valid semantic version');

    const component = request.component ?? 'desktop';
    const platform = request.platform ?? (component === 'api' ? 'node-bundle' : 'windows-x64');
    if (!isArtifactComponent(component)) throw new ValidationError(`Unsupported OTA component: ${String(component)}`);
    if (!isArtifactPlatform(platform)) throw new ValidationError(`Unsupported OTA platform: ${String(platform)}`);

    return this.runExclusive(async () => {
      const currentVersion = this.deps.config.currentVersion;
      const currentComparison = compareVersions(request.version, currentVersion);
      if (currentComparison === null) throw new ValidationError('current application version is invalid');
      if (currentComparison <= 0) {
        await this.deps.state.update({
          state: 'IDLE',
          targetVersion: null,
          startedAt: null,
          errorMessage: null,
          retryCount: 0,
        });
        return {
          downloaded: false,
          alreadyCurrent: true,
          version: request.version,
          component,
          platform,
          bytes: 0,
          sha256: '',
          source: 'cache' as const,
          signatureVerification: 'deferred' as const,
        };
      }

      const startedAt = this.now();
      await this.deps.state.update({
        state: 'DOWNLOADING',
        targetVersion: request.version,
        startedAt,
        errorMessage: null,
      });

      let phase: 'download' | 'verify' = 'download';
      const partPath = this.artifactPath(request.version, component, platform) + '.part';
      const finalPath = this.artifactPath(request.version, component, platform);
      try {
        const resolution = await this.resolveManifest();
        if (resolution.manifest.release.version !== request.version) {
          throw new ConflictError(
            `Requested OTA version ${request.version} is not the available release (${resolution.manifest.release.version})`,
          );
        }
        this.assertManifestCompatible(resolution.manifest);
        this.assertManifestTrust(resolution.manifest);
        if (resolution.manifest.release.channel !== this.deps.config.channel) {
          throw new ConflictError(`Release channel ${resolution.manifest.release.channel} does not match configured channel ${this.deps.config.channel}`);
        }
        if (this.deps.config.channel === 'stable' && parseVersion(request.version)?.pre !== null) {
          throw new ConflictError('Pre-release versions are not auto-updated on the stable channel');
        }

        const entry = this.selectArtifact(resolution.manifest, component, platform);
        this.assertArtifactCompatible(component, platform, entry.format);
        const url = artifactUrl(resolution.manifestUrl, entry.url);
        let source: OtaSource = resolution.source;
        let cached = false;
        try {
          await this.verifyArtifactFile(finalPath, entry);
          cached = true;
          source = 'cache';
        } catch {
          await rm(finalPath, { force: true });
        }

        if (!cached) await this.downloadToPart(url, partPath, entry);
        await this.deps.state.update({ state: 'DOWNLOADED' });

        phase = 'verify';
        if (!cached) {
          await this.verifyArtifactFile(partPath, entry);
          await rename(partPath, finalPath);
        }
        const verified = await this.verifyArtifactFile(finalPath, entry);
        this.stagedArtifact = {
          artifactPath: finalPath,
          version: request.version,
          component,
          platform,
          bytes: verified.bytes,
          sha256: verified.sha256,
           signature: entry.signature,
           ...(entry.format ? { format: entry.format } : {}),
           previousVersion: currentVersion,
           databasePath: this.deps.config.databasePath,
           databaseSchemaVersion: this.deps.config.currentSchemaVersion,
           targetSchemaVersion: resolution.manifest.compatibility.schemaVersion,
           source,
         };
        await this.deps.artifactState?.save({
          artifactPath: finalPath,
          version: request.version,
          component,
          platform,
          bytes: verified.bytes,
          sha256: verified.sha256,
           signature: entry.signature,
           ...(entry.format ? { format: entry.format } : {}),
           previousVersion: currentVersion,
           targetSchemaVersion: resolution.manifest.compatibility.schemaVersion,
           source,
           updatedAt: this.now().toISOString(),
        });
        await this.deps.state.update({
          state: 'VERIFIED',
          errorMessage: null,
          retryCount: 0,
        });
        return {
          downloaded: !cached,
          alreadyCurrent: false,
          version: request.version,
          component,
          platform,
          bytes: verified.bytes,
          sha256: verified.sha256,
          source,
          signatureVerification: this.deps.config.requireSignature ? 'verified' : 'deferred',
        };
      } catch (error) {
        await rm(partPath, { force: true }).catch(() => undefined);
        const failureState = phase === 'verify' || (error instanceof AppError && error.code === 'OTA_VERIFY_FAILED')
          ? 'VERIFY_FAILED'
          : 'DOWNLOAD_FAILED';
        await this.recordFailure(failureState, error);
        throw this.asOtaError(error, failureState === 'VERIFY_FAILED' ? 'OTA_VERIFY_FAILED' : 'OTA_DOWNLOAD_FAILED');
      }
    });
  }

  async installUpdate(request: OtaInstallRequest): Promise<OtaInstallResult> {
    if (!this.deps.config.enabled) throw new AppError('OTA_DISABLED', 'OTA is disabled', 409);
    if (!this.deps.installer) {
      throw new AppError(
        'OTA_INSTALL_UNAVAILABLE',
        'No application installer is configured for this runtime',
        501,
      );
    }
    if (!isValidVersion(request.version)) throw new ValidationError('version must be a valid semantic version');

    const component = request.component ?? 'desktop';
    const platform = request.platform ?? (component === 'api' ? 'node-bundle' : 'windows-x64');
    if (!isArtifactComponent(component)) throw new ValidationError(`Unsupported OTA component: ${String(component)}`);
    if (!isArtifactPlatform(platform)) throw new ValidationError(`Unsupported OTA platform: ${String(platform)}`);

    return this.runExclusive(async () => {
      const comparison = compareVersions(request.version, this.deps.config.currentVersion);
      if (comparison === null) throw new ValidationError('current application version is invalid');
      if (comparison <= 0) throw new ConflictError('OTA refuses to install the current or an older version');

      let staged: StagedInstallArtifact;
      try {
        staged = await this.getStagedInstallArtifact(request.version, component, platform);
      } catch (error) {
        if (error instanceof AppError && error.code === 'OTA_VERIFY_FAILED') {
          await this.recordFailure('VERIFY_FAILED', error);
          throw error;
        }
        throw this.asOtaError(error, 'OTA_INSTALL_FAILED');
      }
      const startedAt = this.now();
      let releaseAdmission: (() => void) | undefined;
      let installStarted = false;
      let maintenanceTransferred = false;

      try {
        await this.deps.state.update({
          state: 'WAITING_FOR_IDLE',
          targetVersion: request.version,
          startedAt,
          errorMessage: null,
        });
        if (this.deps.admission) releaseAdmission = await this.deps.admission.beginMaintenance();
        await this.waitForPrintIdle();

        await this.deps.state.update({ state: 'INSTALLING' });
        installStarted = true;
        const launch = await this.deps.installer!.install(staged);
        if (launch && launch.kind === 'external') {
          // The API must return the handoff response before the updater stops
          // the Desktop process. The external bootstrapper owns the rest of
          // INSTALL → HEALTH_CHECK → ROLLBACK and persists its outcome.
          await this.deps.state.update({ state: 'RESTART_PENDING' });
          maintenanceTransferred = true;
          return {
            installed: false,
            version: request.version,
            component,
            platform,
            state: 'RESTART_PENDING' as const,
            restartRequired: true,
            operationId: launch.operationId,
          };
        }
        await this.deps.state.update({ state: 'INSTALLING_COMPLETE' });
        await this.deps.state.update({ state: 'HEALTH_CHECK' });

        if (!(await this.waitForHealth(staged))) {
          throw new AppError('OTA_HEALTH_CHECK_FAILED', 'Updated application did not become healthy in time', 503);
        }

        await this.deps.state.update({
          state: 'COMPLETED',
          errorMessage: null,
          retryCount: 0,
        });
        await this.deps.state.update({ state: 'RESTART_PENDING' });
        return {
          installed: true,
          version: request.version,
          component,
          platform,
          state: 'RESTART_PENDING' as const,
        };
      } catch (error) {
        const failureState = error instanceof AppError && error.code === 'OTA_HEALTH_CHECK_FAILED'
          ? 'HEALTH_CHECK_FAILED'
          : 'INSTALL_FAILED';
        await this.recordInstallFailure(failureState, error);

        // A queue timeout or an unavailable print drain happens before any
        // bytes are swapped. Releasing the gate is enough; never run rollback
        // against an installation that did not start.
        if (!installStarted) throw this.asOtaError(error, 'OTA_INSTALL_FAILED');

        await this.deps.state.update({ state: 'ROLLING_BACK', errorMessage: safeErrorMessage(error) });
        try {
          const rollbackLaunch = await this.deps.installer!.rollback(staged);
          if (rollbackLaunch && rollbackLaunch.kind === 'external') {
            maintenanceTransferred = true;
            await this.deps.state.update({
              state: 'RESTART_PENDING',
              errorMessage: `Update ${request.version} failed; external rollback is in progress`,
            });
            throw new AppError(
              'OTA_ROLLBACK_PENDING',
              `Update ${request.version} failed; external rollback is in progress`,
              503,
            );
          }
          await this.deps.state.update({
            state: 'ROLLED_BACK',
            errorMessage: `Update ${request.version} failed and the previous version was restored: ${safeErrorMessage(error)}`,
          });
        } catch (rollbackError) {
          if (rollbackError instanceof AppError && rollbackError.code === 'OTA_ROLLBACK_PENDING') {
            throw rollbackError;
          }
          const message =
            `Update ${request.version} failed (${safeErrorMessage(error)}); automatic rollback also failed: ` +
            safeErrorMessage(rollbackError);
          maintenanceTransferred = true;
          await this.deps.state.update({ state: 'ROLLBACK_FAILED', errorMessage: message });
          throw new AppError('OTA_ROLLBACK_FAILED', message, 500);
        }
        throw new AppError(
          'OTA_ROLLED_BACK',
          `Update ${request.version} failed and was rolled back: ${safeErrorMessage(error)}`,
          502,
        );
      } finally {
        if (!maintenanceTransferred) releaseAdmission?.();
      }
    });
  }

  async recordExternalOutcome(input: OtaExternalOutcome): Promise<void> {
    if (!input.operationId.trim()) throw new ValidationError('external OTA operation id is required');
    if (!isValidVersion(input.version)) throw new ValidationError('version must be a valid semantic version');
    if (this.deps.config.updaterStatePath) {
      const snapshot = await readExternalUpdaterState(this.deps.config.updaterStatePath);
      if (snapshot && (snapshot.operationId !== input.operationId || snapshot.version !== input.version)) {
        throw new ConflictError('External OTA outcome does not match the persisted updater operation');
      }
    }
    const current = await this.deps.state.get();
    if (current.targetVersion && current.targetVersion !== input.version) {
      throw new ConflictError(
        `External OTA outcome for ${input.version} does not match active target ${current.targetVersion}`,
      );
    }
    await this.deps.state.update({
      state: input.state,
      targetVersion: input.version,
      errorMessage: input.errorMessage ?? null,
      retryCount: input.state === 'COMPLETED' ? 0 : current.retryCount + 1,
    });
    if (input.state !== 'ROLLBACK_FAILED') {
      this.deps.admission?.resumeMaintenance();
    }
  }

  async rollbackUpdate(): Promise<OtaRollbackResult> {
    if (!this.deps.config.enabled) throw new AppError('OTA_DISABLED', 'OTA is disabled', 409);
    if (!this.deps.installer) {
      throw new AppError(
        'OTA_INSTALL_UNAVAILABLE',
        'No application installer is configured for this runtime',
        501,
      );
    }

    return this.runExclusive(async () => {
      const stagedDescriptor = this.stagedArtifact ?? await this.loadPersistedArtifact();
      if (!stagedDescriptor) {
        throw new AppError('OTA_ROLLBACK_UNAVAILABLE', 'No verified update is available for rollback', 409);
      }
      const staged = await this.getStagedInstallArtifact(
        stagedDescriptor.version,
        stagedDescriptor.component,
        stagedDescriptor.platform,
      );
      await this.deps.state.update({ state: 'ROLLING_BACK', errorMessage: null });
      let releaseAdmission: (() => void) | undefined;
      let maintenanceTransferred = false;
      try {
        if (this.deps.admission) releaseAdmission = await this.deps.admission.beginMaintenance();
        await this.waitForPrintIdle();
        const launch = await this.deps.installer!.rollback(staged);
        if (launch && launch.kind === 'external') {
          maintenanceTransferred = true;
          await this.deps.state.update({ state: 'RESTART_PENDING' });
          return {
            rolledBack: false,
            version: staged.version,
            component: staged.component,
            platform: staged.platform,
            state: 'RESTART_PENDING' as const,
            restartRequired: true,
            operationId: launch.operationId,
          };
        }
        await this.deps.state.update({ state: 'ROLLED_BACK', errorMessage: null });
        return {
          rolledBack: true,
          version: staged.version,
          component: staged.component,
          platform: staged.platform,
          state: 'ROLLED_BACK' as const,
        };
      } catch (error) {
        const message = `Manual rollback failed: ${safeErrorMessage(error)}`;
        maintenanceTransferred = true;
        await this.deps.state.update({ state: 'ROLLBACK_FAILED', errorMessage: message });
        throw new AppError('OTA_ROLLBACK_FAILED', message, 500);
      } finally {
        if (!maintenanceTransferred) releaseAdmission?.();
      }
    });
  }

  private async checkForUpdateInternal(): Promise<UpdateCheckResult> {
    const startedAt = this.now();
    await this.deps.state.update({
      state: 'CHECKING',
      targetVersion: null,
      startedAt,
      errorMessage: null,
    });
    try {
      const resolution = await this.resolveManifest();
      const manifest = resolution.manifest;
      this.assertManifestCompatible(manifest);
      this.assertManifestTrust(manifest);
      const comparison = compareVersions(manifest.release.version, this.deps.config.currentVersion);
      if (comparison === null) throw new ValidationError('current application version is invalid');

      if (manifest.release.channel !== this.deps.config.channel) {
        await this.deps.state.update({ state: 'IDLE', targetVersion: null, startedAt: null, retryCount: 0 });
        return {
          enabled: true,
          available: false,
          currentVersion: this.deps.config.currentVersion,
          latestVersion: manifest.release.version,
          releaseNotes: manifest.release.notes,
          channel: this.deps.config.channel,
          source: resolution.source,
          reason: 'CHANNEL_MISMATCH',
          compatibility: manifest.compatibility,
        };
      }

      if (comparison <= 0) {
        await this.deps.state.update({ state: 'IDLE', targetVersion: null, startedAt: null, retryCount: 0 });
        return {
          enabled: true,
          available: false,
          currentVersion: this.deps.config.currentVersion,
          latestVersion: manifest.release.version,
          releaseNotes: manifest.release.notes,
          channel: this.deps.config.channel,
          source: resolution.source,
          reason: 'CURRENT',
          compatibility: manifest.compatibility,
        };
      }

      if (this.deps.config.channel === 'stable' && parseVersion(manifest.release.version)?.pre !== null) {
        await this.deps.state.update({ state: 'IDLE', targetVersion: null, startedAt: null, retryCount: 0 });
        return {
          enabled: true,
          available: false,
          currentVersion: this.deps.config.currentVersion,
          latestVersion: manifest.release.version,
          releaseNotes: manifest.release.notes,
          channel: this.deps.config.channel,
          source: resolution.source,
          reason: 'PRERELEASE_NOT_AUTO_UPDATED',
          compatibility: manifest.compatibility,
        };
      }

      await this.deps.state.update({ state: 'UPDATE_AVAILABLE', targetVersion: manifest.release.version });
      return {
        enabled: true,
        available: true,
        currentVersion: this.deps.config.currentVersion,
        latestVersion: manifest.release.version,
        releaseNotes: manifest.release.notes,
        channel: manifest.release.channel,
        source: resolution.source,
        compatibility: manifest.compatibility,
      };
    } catch (error) {
      await this.recordFailure('CHECK_FAILED', error);
      throw this.asOtaError(error, 'OTA_CHECK_FAILED');
    }
  }

  private async getStagedInstallArtifact(
    version: string,
    component: ArtifactComponent,
    platform: ArtifactPlatform,
  ): Promise<StagedInstallArtifact> {
    const path = this.artifactPath(version, component, platform);
    const persisted = this.stagedArtifact ?? await this.loadPersistedArtifact();
    if (
      persisted
      && persisted.version === version
      && persisted.component === component
      && persisted.platform === platform
    ) {
      this.assertArtifactCompatible(component, platform, persisted.format);
      const verified = await this.verifyArtifactFile(path, {
        url: '',
        sha256: persisted.sha256,
        signature: persisted.signature,
        size: persisted.bytes,
        ...(persisted.format ? { format: persisted.format as 'nsis-installer' | 'binary' | 'archive' } : {}),
      });
      return {
        ...persisted,
        bytes: verified.bytes,
        sha256: verified.sha256,
        artifactPath: path,
        databasePath: this.deps.config.databasePath,
        databaseSchemaVersion: this.deps.config.currentSchemaVersion,
        targetSchemaVersion: persisted.targetSchemaVersion ?? this.deps.config.currentSchemaVersion,
      };
    }

    // The staged path survives an API restart, while the in-memory descriptor
    // does not. Re-read the manifest to recover the expected digest instead of
    // trusting a file merely because its name contains a release version.
    const resolution = await this.resolveManifest();
    if (resolution.manifest.release.version !== version) {
      throw new ConflictError(
        `Requested OTA version ${version} is not the available release (${resolution.manifest.release.version})`,
      );
    }
    this.assertManifestCompatible(resolution.manifest);
    const entry = this.selectArtifact(resolution.manifest, component, platform);
    this.assertArtifactCompatible(component, platform, entry.format);
    const verified = await this.verifyArtifactFile(path, entry);
    const staged: StagedInstallArtifact = {
      artifactPath: path,
      version,
      component,
      platform,
      bytes: verified.bytes,
      sha256: verified.sha256,
       signature: entry.signature,
       ...(entry.format ? { format: entry.format } : {}),
       previousVersion: this.deps.config.currentVersion,
       databasePath: this.deps.config.databasePath,
       databaseSchemaVersion: this.deps.config.currentSchemaVersion,
       targetSchemaVersion: resolution.manifest.compatibility.schemaVersion,
       source: 'cache',
     };
    this.stagedArtifact = staged;
    return staged;
  }

  private async waitForPrintIdle(): Promise<void> {
    const timeoutMs = this.deps.config.queueIdleTimeoutMs ?? DEFAULT_QUEUE_IDLE_TIMEOUT_MS;
    const pollMs = this.deps.config.queuePollMs ?? DEFAULT_QUEUE_POLL_MS;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (await this.printQueueIsIdle()) {
        await this.deps.schedulerSettled?.();
        await this.deps.eventBusSettled?.();
        // Recheck after all currently scheduled work and terminal events have
        // settled. This closes the common dequeue/settle race before install.
        if (await this.printQueueIsIdle()) return;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new AppError(
          'OTA_QUEUE_NOT_IDLE',
          `Print queue did not become idle within ${timeoutMs}ms`,
          409,
        );
      }
      await delay(Math.min(pollMs, remainingMs));
    }
  }

  private async printQueueIsIdle(): Promise<boolean> {
    const metrics = this.deps.queue
      ? await this.deps.queue.getMetrics()
      : { size: 0, inflight: 0 };
    if (metrics.size !== 0 || metrics.inflight !== 0) return false;
    if (!this.deps.jobs) return true;

    const activeJobs = await Promise.all(
      NON_TERMINAL_JOB_STATUSES.map((status) => this.deps.jobs!.findAll({ status })),
    );
    return activeJobs.every((jobs) => jobs.length === 0);
  }

  private async waitForHealth(input: OtaInstallInput): Promise<boolean> {
    const installer = this.deps.installer;
    if (!installer) return false;
    const timeoutMs = this.deps.config.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    do {
      try {
        if (await installer.healthCheck(input)) return true;
      } catch {
        // Health checks are expected to fail while a child process is still
        // restarting. Keep polling until the bounded deadline.
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await delay(Math.min(250, remainingMs));
    } while (Date.now() < deadline);
    return false;
  }

  private async resolveManifest(): Promise<ResolvedManifest> {
    const candidates = this.sourceCandidates();
    if (candidates.length === 0) {
      throw new AppError(
        'OTA_NOT_CONFIGURED',
        'No OTA manifest source is configured; set PRINTOPS_OTA_LAN_RELAY_URL or PRINTOPS_OTA_WAN_MANIFEST_URL',
        409,
      );
    }

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const response = await this.fetchWithTimeout(candidate.url, this.deps.config.manifestTimeoutMs, 'application/json');
        if (!response.ok) {
          lastError = new Error(`manifest source returned HTTP ${response.status}`);
          continue;
        }
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > 1_048_576) {
          lastError = manifestError('Release manifest exceeds the 1 MiB limit');
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          lastError = manifestError('Release manifest is not valid JSON');
          continue;
        }
        return { manifest: parseReleaseManifest(parsed), source: candidate.kind, manifestUrl: candidate.url };
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof AppError && lastError.code === 'OTA_INVALID_MANIFEST') throw lastError;
    throw new AppError('OTA_SOURCE_UNAVAILABLE', 'No configured OTA manifest source is reachable', 503);
  }

  private sourceCandidates(): SourceCandidate[] {
    const candidates: SourceCandidate[] = [];
    if (this.deps.config.lanRelayUrl) {
      candidates.push({ kind: 'lan', url: manifestUrlForSource(this.deps.config.lanRelayUrl) });
    }
    if (this.deps.config.wanManifestUrl) {
      candidates.push({ kind: 'wan', url: manifestUrlForSource(this.deps.config.wanManifestUrl) });
    }
    return candidates.filter((candidate, index) => candidates.findIndex((other) => other.url === candidate.url) === index);
  }

  private async fetchWithTimeout(url: string, timeoutMs: number, accept: string): Promise<Response> {
    // AbortSignal.timeout remains active while the caller consumes the
    // response body. A timer around only `fetch()` would stop protecting a
    // slow/stalled download as soon as response headers arrived.
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const fetchImpl = this.deps.fetchImpl ?? fetch;
      return await fetchImpl(url, { headers: { accept }, signal });
    } catch (error) {
      if (signal.aborted) throw new AppError('OTA_TIMEOUT', `OTA request timed out after ${timeoutMs}ms`, 503);
      throw error;
    }
  }

  private selectArtifact(manifest: ReleaseManifest, component: ArtifactComponent, platform: ArtifactPlatform): ArtifactEntry {
    const entry = manifest.artifacts[component]?.[platform];
    if (!entry) throw new AppError('OTA_ARTIFACT_NOT_FOUND', `Manifest has no ${component}/${platform} artifact`, 409);
    return entry;
  }

  private assertManifestTrust(manifest: ReleaseManifest): void {
    if (!this.deps.config.requireSignature) return;
    if (!this.deps.config.publicKey) {
      throw new AppError(
        'OTA_SIGNATURE_UNAVAILABLE',
        'WAN/application OTA requires PRINTOPS_OTA_PUBLIC_KEY before a release can be trusted',
        503,
      );
    }
    const desktop = manifest.artifacts.desktop?.['windows-x64'];
    if (!desktop?.signature.trim()) {
      throw new AppError(
        'OTA_SIGNATURE_REQUIRED',
        'Release manifest does not contain a signature for the Windows application artifact',
        422,
      );
    }
  }

  private assertArtifactCompatible(
    component: ArtifactComponent,
    platform: ArtifactPlatform,
    format: string | undefined,
  ): void {
    if (component !== 'desktop' || platform !== 'windows-x64') {
      throw new AppError(
        'OTA_UNSUPPORTED_TARGET',
        'This Windows Desktop updater accepts only the signed desktop/windows-x64 installer target',
        422,
      );
    }
    if (format !== 'nsis-installer') {
      throw new AppError(
        'OTA_INCOMPATIBLE_ARTIFACT',
        'The selected desktop artifact is not a supported NSIS installer',
        422,
      );
    }
  }

  private assertManifestCompatible(manifest: ReleaseManifest): void {
    const current = parseVersion(this.deps.config.currentVersion);
    const minimum = parseVersion(manifest.compatibility.minSupportedVersion);
    if (!current || !minimum) throw new ValidationError('application version compatibility cannot be evaluated');
    if (manifest.compatibility.schemaVersion < this.deps.config.currentSchemaVersion) {
      throw new ConflictError(
        `Release requires database schema ${manifest.compatibility.schemaVersion}, `
        + `but this application uses schema ${this.deps.config.currentSchemaVersion}`,
      );
    }
    if (manifest.compatibility.schemaVersion > this.deps.config.currentSchemaVersion
      && !this.deps.config.databasePath) {
      throw new AppError(
        'OTA_DB_BACKUP_UNAVAILABLE',
        'Schema-changing OTA requires a configured SQLite database path for rollback backup',
        503,
      );
    }
    const comparison = compareVersions(this.deps.config.currentVersion, manifest.compatibility.minSupportedVersion);
    if (comparison === null || comparison < 0) {
      throw new ConflictError(
        `Current application ${this.deps.config.currentVersion} is below the manifest minimum ${manifest.compatibility.minSupportedVersion}`,
      );
    }
  }

  private artifactPath(version: string, component: ArtifactComponent, platform: ArtifactPlatform): string {
    return join(this.deps.config.cacheDir, version, `${component}-${platform}.artifact`);
  }

  private async downloadToPart(url: string, partPath: string, entry: ArtifactEntry): Promise<void> {
    if (entry.size > this.deps.config.maxArtifactBytes) {
      throw new AppError('OTA_DOWNLOAD_FAILED', 'Artifact exceeds the configured download size limit', 413);
    }
    await mkdir(dirname(partPath), { recursive: true });
    await rm(partPath, { force: true });
    const response = await this.fetchWithTimeout(url, this.deps.config.downloadTimeoutMs, 'application/octet-stream');
    if (!response.ok) throw new AppError('OTA_DOWNLOAD_FAILED', `Artifact download returned HTTP ${response.status}`, 503);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > this.deps.config.maxArtifactBytes) {
      throw new AppError('OTA_DOWNLOAD_FAILED', 'Artifact exceeds the configured download size limit', 413);
    }
    if (!response.body) throw new AppError('OTA_DOWNLOAD_FAILED', 'Artifact response has no body', 503);

    try {
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(partPath, { flags: 'wx' }),
      );
      const info = await stat(partPath);
      if (!info.isFile() || info.size > this.deps.config.maxArtifactBytes || info.size !== entry.size) {
        throw new AppError('OTA_DOWNLOAD_FAILED', 'Downloaded artifact size does not match the manifest', 422);
      }
    } catch (error) {
      await rm(partPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async verifyArtifactFile(path: string, entry: ArtifactEntry): Promise<{ bytes: number; sha256: string }> {
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new AppError('OTA_VERIFY_FAILED', 'Staged artifact is missing', 422);
    }
    if (!info.isFile() || info.size !== entry.size) {
      throw new AppError('OTA_VERIFY_FAILED', 'Staged artifact size does not match the manifest', 422);
    }
    const sha256 = await sha256File(path);
    if (sha256 !== entry.sha256.toLowerCase()) {
      throw new AppError('OTA_VERIFY_FAILED', 'Staged artifact SHA-256 does not match the manifest', 422);
    }
    if (this.deps.config.requireSignature) {
      try {
        verifyArtifactSignature(sha256, entry.signature, this.deps.config.publicKey);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('OTA_SIGNATURE_INVALID', 'Release artifact signature is invalid', 422);
      }
    }
    return { bytes: info.size, sha256 };
  }

  private async loadPersistedArtifact(): Promise<StagedInstallArtifact | null> {
    const value = await this.deps.artifactState?.load();
    if (!value) return null;
    if (
      !isValidVersion(value.version)
      || !isArtifactComponent(value.component)
      || !isArtifactPlatform(value.platform)
      || !value.artifactPath
    ) return null;
    const staged: StagedInstallArtifact = {
      artifactPath: value.artifactPath,
      version: value.version,
      component: value.component,
      platform: value.platform,
      bytes: value.bytes,
      sha256: value.sha256,
       signature: value.signature,
       ...(value.format ? { format: value.format } : {}),
       previousVersion: value.previousVersion ?? this.deps.config.currentVersion,
       databasePath: this.deps.config.databasePath,
       databaseSchemaVersion: this.deps.config.currentSchemaVersion,
       targetSchemaVersion: value.targetSchemaVersion ?? this.deps.config.currentSchemaVersion,
       source: value.source,
     };
    this.stagedArtifact = staged;
    return staged;
  }

  private async reconcileExternalUpdaterState(): Promise<void> {
    const path = this.deps.config.updaterStatePath;
    if (!path) return;
    const snapshot = await readExternalUpdaterState(path);
    if (!snapshot || !isExternalUpdaterTerminalPhase(snapshot.phase)) return;
    const current = await this.deps.state.get();
    if (current.targetVersion && current.targetVersion !== snapshot.version) return;

    const state = snapshot.phase === 'COMPLETED'
      ? 'COMPLETED'
      : snapshot.phase === 'ROLLED_BACK'
        ? 'ROLLED_BACK'
        : snapshot.phase === 'ROLLBACK_FAILED'
          ? 'ROLLBACK_FAILED'
          : 'INSTALL_FAILED';
    const errorMessage = state === 'COMPLETED'
      ? null
      : snapshot.error ?? `External updater ended in ${snapshot.phase}`;
    if (current.state === state && current.errorMessage === errorMessage) return;
    await this.deps.state.update({
      state,
      targetVersion: snapshot.version,
      errorMessage,
      retryCount: state === 'COMPLETED' ? 0 : current.retryCount + 1,
    });
    if (state !== 'ROLLBACK_FAILED') {
      this.deps.admission?.resumeMaintenance();
    }
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.operation) throw new ConflictError('Another OTA operation is already in progress');

    // The in-memory promise is assigned before the async operation can yield,
    // so concurrent requests cannot both pass the mutex check. Persisted state
    // is intentionally not used as a lock; recovery of stale states belongs to
    // the install/rollback phase.
    const pending = Promise.resolve().then(operation);
    this.operation = pending;
    return pending.finally(() => {
      if (this.operation === pending) this.operation = undefined;
    });
  }

  private async recordFailure(
    state: 'CHECK_FAILED' | 'DOWNLOAD_FAILED' | 'VERIFY_FAILED',
    error: unknown,
  ): Promise<void> {
    const current = await this.deps.state.get();
    await this.deps.state.update({
      state,
      errorMessage: safeErrorMessage(error),
      retryCount: current.retryCount + 1,
    });
  }

  private async recordInstallFailure(
    state: 'INSTALL_FAILED' | 'HEALTH_CHECK_FAILED',
    error: unknown,
  ): Promise<void> {
    const current = await this.deps.state.get();
    await this.deps.state.update({
      state,
      errorMessage: safeErrorMessage(error),
      retryCount: current.retryCount + 1,
    });
  }

  private asOtaError(error: unknown, fallbackCode: string): AppError {
    if (error instanceof AppError) return error;
    return new AppError(fallbackCode, safeErrorMessage(error), 503);
  }
}
