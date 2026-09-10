/**
 * OTA domain models — version model, manifest schemas, and update state machine.
 *
 * These types are the contracts between the build pipeline (which emits
 * manifests), the update agent (which consumes them), and the content sync
 * service (which tracks content ownership).
 *
 * Application OTA contract shared by the API, release pipeline, and native
 * external updater.
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
  | 'ROLLBACK_FAILED'
  | 'HEALTH_CHECK_FAILED';

export const TERMINAL_FAILURE_STATES: ReadonlySet<UpdateState> = new Set([
  'CHECK_FAILED',
  'DOWNLOAD_FAILED',
  'VERIFY_FAILED',
  'INSTALL_FAILED',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
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

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
  build: string | null;
}

/**
 * Parse a SemVer 2.0 version used by the release channel.
 *
 * The old implementation compared the complete prerelease string as one
 * lexicographic value, which made rc.10 sort before rc.2. Keep the parsed
 * identifiers available to the comparator while retaining the small public
 * shape consumed by the rest of PrintOps.
 */
export function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version.trim());
  if (!match) return null;

  const majorText = match[1]!;
  const minorText = match[2]!;
  const patchText = match[3]!;
  const numeric = [majorText, minorText, patchText];
  if (numeric.some((value) => (value.length > 1 && value.startsWith('0')) || !Number.isSafeInteger(Number(value)))) {
    return null;
  }

  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((identifier) => /^\d+$/.test(identifier) && (identifier.length > 1 && identifier.startsWith('0')))) {
    return null;
  }

  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
    pre: match[4] ?? null,
    build: match[5] ?? null,
  };
}

function compareNumericIdentifier(a: string, b: string): number {
  const left = a.replace(/^0+(?=\d)/, '');
  const right = b.replace(/^0+(?=\d)/, '');
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const left = a.split('.');
  const right = b.split('.');
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = left[index]!;
    const rightIdentifier = right[index]!;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      const comparison = compareNumericIdentifier(leftIdentifier, rightIdentifier);
      if (comparison !== 0) return comparison;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (leftIdentifier !== rightIdentifier) {
      return leftIdentifier < rightIdentifier ? -1 : 1;
    }
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
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

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  // Build metadata is deliberately ignored by SemVer precedence.
  return comparePrerelease(pa.pre, pb.pre);
}

/** True when `candidate` is a valid PrintOps version string. */
export function isValidVersion(candidate: string): boolean {
  return parseVersion(candidate) !== null;
}

// ─── Release manifest (Application OTA) ──────────────────────────────────────

export type ArtifactPlatform = 'windows-x64' | 'node-bundle';
export type ArtifactComponent = 'desktop' | 'runner' | 'api';
export type ReleaseChannel = 'stable' | 'beta' | 'rc';
export type ArtifactFormat = 'nsis-installer' | 'binary' | 'archive';

export interface ArtifactEntry {
  url: string;
  sha256: string;
  /** Ed25519 signature over the artifact SHA-256 digest (hex or base64). */
  signature: string;
  size: number;
  /** Required by production install targets; omitted only for legacy manifests. */
  format?: ArtifactFormat;
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
