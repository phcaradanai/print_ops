/**
 * OTA domain models — version model, manifest schemas, and update state machine.
 *
 * These types are the contracts between the build pipeline (which emits
 * manifests), the update agent (which consumes them), and the content sync
 * service (which tracks content ownership).
 *
 * Phase OTA-01: foundation only — no network, no download, no install.
 */

// ─── Update state machine ────────────────────────────────────────────────────

/**
 * Every state the application OTA can be in. The state machine is defined in
 * docs/ota/OTA-architecture-contracts.md §3.
 */
export type UpdateState =
  | 'IDLE'
  | 'CHECKING'
  | 'UPDATE_AVAILABLE'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'VERIFIED'
  | 'WAITING_FOR_IDLE'
  | 'INSTALLING'
  | 'INSTALLING_COMPLETE'
  | 'HEALTH_CHECK'
  | 'COMPLETED'
  | 'RESTART_PENDING'
  | 'CHECK_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'VERIFY_FAILED'
  | 'INSTALL_FAILED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'HEALTH_CHECK_FAILED';

export const TERMINAL_FAILURE_STATES: ReadonlySet<UpdateState> = new Set([
  'CHECK_FAILED',
  'DOWNLOAD_FAILED',
  'VERIFY_FAILED',
  'INSTALL_FAILED',
  'ROLLED_BACK',
  'HEALTH_CHECK_FAILED',
]);

export const ACTIVE_STATES: ReadonlySet<UpdateState> = new Set([
  'CHECKING',
  'DOWNLOADING',
  'VERIFIED',
  'WAITING_FOR_IDLE',
  'INSTALLING',
  'INSTALLING_COMPLETE',
  'HEALTH_CHECK',
  'ROLLING_BACK',
]);

export interface OtaUpdateStateRecord {
  state: UpdateState;
  targetVersion: string | null;
  startedAt: Date | null;
  updatedAt: Date;
  errorMessage: string | null;
  retryCount: number;
}

// ─── Semver ──────────────────────────────────────────────────────────────────

/**
 * Minimal semver parse for PrintOps versions: <major>.<minor>.<patch>[-<pre>].
 * Returns null when the input is not a valid PrintOps version string.
 */
export function parseVersion(version: string): { major: number; minor: number; patch: number; pre: string | null } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}

/**
 * Compare two PrintOps version strings. Returns:
 *   <0 if a < b, 0 if a == b, >0 if a > b
 *
 * Pre-release versions sort BEFORE the release (1.0.0-rc.1 < 1.0.0).
 * Returns null if either version is unparseable.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;

  const major = pa.major - pb.major;
  if (major !== 0) return major;
  const minor = pa.minor - pb.minor;
  if (minor !== 0) return minor;
  const patch = pa.patch - pb.patch;
  if (patch !== 0) return patch;

  // Both same major.minor.patch — pre-release sorts before release.
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1; // a is release, b is pre → a > b
  if (pb.pre === null) return -1;
  // Both pre-release: lexicographic (good enough for our single-key use).
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

/** True when `candidate` is a valid PrintOps version string. */
export function isValidVersion(candidate: string): boolean {
  return parseVersion(candidate) !== null;
}

// ─── Release manifest (Application OTA) ──────────────────────────────────────

export type ArtifactPlatform = 'windows-x64' | 'node-bundle';
export type ArtifactComponent = 'desktop' | 'runner' | 'api';
export type ReleaseChannel = 'stable' | 'beta' | 'rc';

export interface ArtifactEntry {
  url: string;
  sha256: string;
  /** Ed25519 signature over the artifact bytes (hex or base64). Empty until OTA-08. */
  signature: string;
  size: number;
}

export interface ReleaseManifest {
  schemaVersion: 1;
  release: {
    version: string;
    channel: ReleaseChannel;
    releaseDate: string; // ISO 8601
    notes: string;
  };
  artifacts: Partial<Record<ArtifactComponent, Partial<Record<ArtifactPlatform, ArtifactEntry>>>>;
  compatibility: {
    /** Oldest version that may update to this release. */
    minSupportedVersion: string;
    /** Required DB schema version — forward-guard refuses older app opening newer DB. */
    schemaVersion: number;
  };
  rollout: {
    staged: boolean;
    rolloutPercentage: number;
  };
}

// ─── Content manifest (Content OTA) ──────────────────────────────────────────

export type ContentType = 'profiles' | 'templates';
export type ContentAction = 'upsert' | 'delete' | 'ignore';

export interface ContentManifestItem {
  /** Stable id (profile code or template code). */
  id: string;
  action: ContentAction;
  sha256: string;
  signature: string;
  size: number;
}

export interface ContentManifest {
  schemaVersion: 1;
  contentType: ContentType;
  version: number;
  releaseDate: string;
  compatibility: {
    minAppVersion: string;
    maxAppVersion: string;
    requiredSchemaVersion: number;
  };
  items: ContentManifestItem[];
  rollout: {
    staged: boolean;
    rolloutPercentage: number;
  };
}

// ─── Content ownership ───────────────────────────────────────────────────────

/**
 * Who owns a content item (profile or template).
 *
 * - MANAGED: centrally controlled, OTA may update or delete.
 * - LOCAL: created locally, OTA never touches it.
 * - FORKED: was MANAGED but locally modified; OTA creates a suffixed copy
 *   instead of overwriting the fork.
 */
export type ContentOwnership = 'MANAGED' | 'LOCAL' | 'FORKED';

export interface ContentHistoryRecord {
  id: string;
  contentType: ContentType;
  version: number;
  appliedAt: Date;
  manifestJson: string;
}
