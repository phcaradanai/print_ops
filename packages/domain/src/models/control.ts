/**
 * Web Control & Remote Management domain models.
 * Contracts for device identity, enrollment, command plane, heartbeats,
 * OTA synchronization, and release catalog.
 */

// ─── Phase 1: Device Identity & Enrollment ──────────────────────────────────

export type DeviceConnectionState = 'ONLINE' | 'STALE' | 'OFFLINE';
export type DevicePrintState = 'IDLE' | 'PRINTING' | 'PAUSED' | 'ERROR';
export type DeviceRegistrationStatus = 'ACTIVE' | 'REVOKED';

export interface DeviceIdentity {
  /** Unique durable device identifier (e.g. dev_01H...). */
  deviceId: string;
  /** Unique installation identifier, persistent across application restarts. */
  installationId: string;
  /** Site / tenant / hospital branch identifier. */
  siteId: string;
  /** Operating system hostname. */
  hostname: string;
  /** Operating system platform (e.g. win32, linux, darwin). */
  platform: string;
  /** Machine architecture (e.g. x64, arm64). */
  architecture: string;
  /** Currently installed PrintOps application semver (e.g. 0.1.28). */
  appVersion: string;
  /** Current SQLite DB schema version (e.g. 7). */
  schemaVersion: number;
  /** Running PrintOps runner version. */
  runnerVersion: string;
}

export interface DeviceRecord extends DeviceIdentity {
  /** When device was first enrolled. */
  enrolledAt: Date;
  /** Timestamp of most recent heartbeat / seen event. */
  lastSeenAt: Date | null;
  /** Computed or reported connection state. */
  connectionState: DeviceConnectionState;
  /** Local printer/queue status reported by device. */
  printState: DevicePrintState;
  /** Current OTA state reported by device (e.g. IDLE, WAITING_FOR_IDLE, INSTALLING). */
  otaState: string;
  /** Most recent OTA operation or command id. */
  lastOtaOperation: string | null;
  /** Scrypt/SHA256 hash of device authentication secret. */
  deviceTokenHash: string;
  /** Enrollment status. */
  status: DeviceRegistrationStatus;
  /** Optional human-readable station label. */
  displayName?: string;
  /** Runner status summary (e.g. RUNNING, STOPPED). */
  runnerStatus?: string;
  /** Summary of printer readiness. */
  printReadinessSummary?: string;
}

export interface CreateDeviceRecordInput {
  deviceId: string;
  installationId: string;
  siteId: string;
  hostname: string;
  platform: string;
  architecture: string;
  appVersion: string;
  schemaVersion: number;
  runnerVersion: string;
  deviceTokenHash: string;
  displayName?: string;
}

export interface EnrollmentToken {
  /** One-time bootstrap token (e.g. enroll_sec_...). */
  token: string;
  /** Site / branch assigned to the device using this token. */
  siteId: string;
  /** Expiration timestamp. */
  expiresAt: Date;
  /** Timestamp when token was consumed by a device. Null if pending. */
  consumedAt: Date | null;
  /** Device ID that consumed this token. Null if pending. */
  consumedByDeviceId: string | null;
  /** Actor / user who generated the enrollment token. */
  createdBy: string;
  /** Creation timestamp. */
  createdAt: Date;
}

export interface CreateEnrollmentTokenInput {
  token?: string;
  siteId: string;
  expiresInSeconds?: number;
  createdBy: string;
}

export interface DeviceEnrollmentRequest {
  /** One-time bootstrap token. */
  enrollmentToken: string;
  /** Unique installation identifier persistent on device. */
  installationId: string;
  siteId?: string;
  hostname: string;
  platform: string;
  architecture: string;
  appVersion: string;
  schemaVersion: number;
  runnerVersion: string;
  displayName?: string;
}

export interface DeviceEnrollmentResponse {
  deviceId: string;
  installationId: string;
  siteId: string;
  /** Per-device authentication credential returned ONCE upon enrollment. */
  deviceToken: string;
  controlPlane: {
    natsUrl?: string;
    commandSubject: string;
    eventSubject: string;
    heartbeatSubject: string;
  };
}

// ─── Phase 2: Heartbeat & Registry ──────────────────────────────────────────

export interface DeviceHeartbeatPayload {
  deviceId: string;
  installationId: string;
  siteId: string;
  hostname: string;
  platform: string;
  architecture: string;
  appVersion: string;
  schemaVersion: number;
  runnerVersion: string;
  runnerStatus: string;
  printReadinessSummary: string;
  printState: DevicePrintState;
  otaState: string;
  lastOtaOperation: string | null;
  timestamp: string; // ISO 8601
}

// ─── Phase 3: Separate Management Command Plane ─────────────────────────────

export type ControlCommandType =
  | 'OTA_CHECK'
  | 'OTA_DOWNLOAD'
  | 'OTA_INSTALL'
  | 'OTA_ROLLBACK';

export type ControlCommandStatus =
  | 'PENDING'
  | 'DELIVERED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'COMPLETED'
  | 'FAILED';

export interface ControlCommandEnvelope {
  command_id: string;
  device_id: string;
  type: ControlCommandType;
  target_version?: string;
  requested_at: string; // ISO 8601
  expires_at: string; // ISO 8601
  requested_by: string;
  idempotency_key: string;
}

export interface ControlCommandRecord {
  commandId: string;
  deviceId: string;
  type: ControlCommandType;
  targetVersion?: string;
  requestedAt: Date;
  expiresAt: Date;
  requestedBy: string;
  idempotencyKey: string;
  status: ControlCommandStatus;
  acceptedAt?: Date;
  completedAt?: Date;
  terminalState?: string;
  failureReason?: string;
}

export interface CreateControlCommandInput {
  deviceId: string;
  type: ControlCommandType;
  targetVersion?: string;
  expiresInSeconds?: number;
  requestedBy: string;
  idempotencyKey: string;
}

// ─── Phase 5: OTA State Synchronization ─────────────────────────────────────

export type OtaTransitionState =
  | 'REQUESTED'
  | 'DELIVERED'
  | 'ACCEPTED'
  | 'CHECKING'
  | 'DOWNLOADING'
  | 'VERIFIED'
  | 'WAITING_FOR_IDLE'
  | 'INSTALLING'
  | 'RESTARTING'
  | 'COMPLETED'
  | 'INSTALL_FAILED'
  | 'HEALTH_CHECK_FAILED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED'
  | 'RECOVERY_REQUIRED';

export const OTA_TRANSITION_STATES: Record<OtaTransitionState, true> = {
  REQUESTED: true,
  DELIVERED: true,
  ACCEPTED: true,
  CHECKING: true,
  DOWNLOADING: true,
  VERIFIED: true,
  WAITING_FOR_IDLE: true,
  INSTALLING: true,
  RESTARTING: true,
  COMPLETED: true,
  INSTALL_FAILED: true,
  HEALTH_CHECK_FAILED: true,
  ROLLING_BACK: true,
  ROLLED_BACK: true,
  ROLLBACK_FAILED: true,
  RECOVERY_REQUIRED: true,
};

export const BLOCKING_RECOVERY_STATES: Record<string, true> = {
  ROLLBACK_FAILED: true,
  RECOVERY_REQUIRED: true,
};

export interface ControlOtaTransitionEvent {
  eventId: string;
  deviceId: string;
  commandId?: string;
  state: OtaTransitionState;
  previousState?: string;
  targetVersion?: string;
  currentVersion: string;
  details?: Record<string, unknown>;
  errorMessage?: string;
  timestamp: string; // ISO 8601
}

// ─── Phase 6: Release Catalog ───────────────────────────────────────────────

export type ReleaseRecordStatus = 'AVAILABLE' | 'REVOKED' | 'DEPRECATED';

export interface ReleaseCatalogRecord {
  id: string;
  version: string;
  channel: 'stable' | 'beta' | 'rc';
  platform: 'windows-x64' | 'node-bundle';
  architecture: 'x64' | 'arm64';
  schemaVersion: number;
  manifestRef: string;
  artifactRef: string;
  sha256: string;
  signature: string;
  minSupportedVersion: string;
  status: ReleaseRecordStatus;
  createdAt: Date;
  releaseNotes?: string;
}

export interface CreateReleaseCatalogInput {
  version: string;
  channel?: 'stable' | 'beta' | 'rc';
  platform?: 'windows-x64' | 'node-bundle';
  architecture?: 'x64' | 'arm64';
  schemaVersion: number;
  manifestRef: string;
  artifactRef: string;
  sha256: string;
  signature: string;
  minSupportedVersion?: string;
  status?: ReleaseRecordStatus;
  releaseNotes?: string;
}

// ─── Phase 8: Control Audit Log ─────────────────────────────────────────────

export interface ControlAuditRecord {
  id: string;
  actor: string;
  deviceId: string;
  commandId?: string;
  action: string;
  sourceVersion?: string;
  targetVersion?: string;
  requestedAt: Date;
  acceptedAt?: Date;
  terminalState?: string;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}
