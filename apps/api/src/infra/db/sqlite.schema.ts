import type { Database } from 'sql.js';

export const CURRENT_SCHEMA_VERSION = 2;

export function schemaVersion(db: Database): number {
  const result = db.exec('PRAGMA user_version');
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  try {
    while (stmt.step()) {
      if (stmt.getAsObject()['name'] === column) return true;
    }
    return false;
  } finally {
    stmt.free();
  }
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Apply every schema change transactionally and advance PRAGMA user_version.
 *
 * Version 0 is the legacy unversioned schema. Its migration deliberately runs
 * the complete idempotent schema below so databases from any earlier desktop
 * build converge to the same shape before incremental migrations run.
 */
export function runSchemaMigration(db: Database): void {
  const fromVersion = schemaVersion(db);
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `PRINTOPS_DB_NEWER_SCHEMA: database schema ${fromVersion} is newer than this application supports (${CURRENT_SCHEMA_VERSION}).`,
    );
  }
  if (fromVersion === CURRENT_SCHEMA_VERSION) return;

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  db.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    if (fromVersion < 1) migrateVersionZeroToOne(db);
    if (fromVersion < 2) migrateVersionOneToTwo(db);
    db.run(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION}`);
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch { /* retain the original migration error */ }
    throw error;
  }
}

/**
 * Per-user page access shipped after version 1 had already been released.
 * Keep this as a real versioned migration: placing the column only in the
 * version-0 bootstrap leaves existing version-1 installations unchanged.
 */
function migrateVersionOneToTwo(db: Database): void {
  ensureColumn(db, 'users', 'allowed_pages_json', 'TEXT');
}

function migrateVersionZeroToOne(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      location TEXT,
      protocol TEXT NOT NULL DEFAULT 'fake',
      connection_uri TEXT NOT NULL,
      capabilities TEXT,          -- JSON: PrinterCapability
      status TEXT,                -- JSON: PrinterStatus
      allowed_templates TEXT,     -- JSON array of strings
      max_copies_per_job INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY NOT NULL,
      printer_id TEXT NOT NULL,
      printer_code TEXT,
      template_code TEXT,
      resolved_template_code TEXT,
      paper_profile_id TEXT,
      route_policy_id TEXT,
      rendered_print_payload TEXT,
      created_by TEXT NOT NULL,
      source_system TEXT,
      source_reference TEXT,
      request_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACCEPTED',
      priority INTEGER NOT NULL DEFAULT 50,
      priority_label TEXT NOT NULL DEFAULT 'normal',
      trace_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      document_url TEXT,
      document_base64 TEXT,
      payload_snapshot TEXT,
      mime_type TEXT NOT NULL,
      copies INTEGER NOT NULL DEFAULT 1,
      duplex INTEGER NOT NULL DEFAULT 0,
      color_mode TEXT NOT NULL DEFAULT 'auto',
      media_type TEXT,
      resolution TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      received_at TEXT,
      validated_at TEXT,
      queued_at TEXT,
      dispatched_at TEXT,
      runner_received_at TEXT,
      spooler_sent_at TEXT,
      printer_ack_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      completed_at TEXT,
      latency TEXT,               -- JSON: JobLatency
      template_timing TEXT,       -- JSON
      error_code TEXT,
      error_message TEXT,
      runner_id TEXT,
      adapter_used TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_jobs_printer_id ON jobs(printer_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_request_id ON jobs(request_id, source_system);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      source TEXT NOT NULL,
      destination TEXT NOT NULL,
      runner_id TEXT,
      printer_id TEXT NOT NULL,
      adapter_name TEXT NOT NULL,
      queued_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      duration_ms REAL,
      status TEXT NOT NULL DEFAULT 'ACCEPTED',
      error_code TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      evidence TEXT NOT NULL DEFAULT '{}',
      steps TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS runners (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      hostname TEXT NOT NULL,
      ip_address TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      supported_protocols TEXT NOT NULL DEFAULT '[]',
      last_heartbeat_at TEXT,
      registered_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      trace_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_email TEXT,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      before TEXT,                -- JSON
      after TEXT,                 -- JSON
      metadata TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL
    )
  `);

  // Earlier desktop builds created audit_logs with before_snapshot and
  // after_snapshot, while the repository has always read/write before and
  // after. Add the canonical columns without touching existing audit history.
  ensureColumn(db, 'audit_logs', 'before', 'TEXT');
  ensureColumn(db, 'audit_logs', 'after', 'TEXT');

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'VIEWER',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  ensureColumn(db, 'users', 'password_hash', 'TEXT');
  ensureColumn(db, 'users', 'allowed_pages_json', 'TEXT');

  db.run(`
    CREATE TABLE IF NOT EXISTS service_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      source_system TEXT NOT NULL UNIQUE,
      api_key_hash TEXT NOT NULL,
      api_key_prefix TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      allowed_printer_codes TEXT NOT NULL DEFAULT '[]',
      allowed_template_codes TEXT NOT NULL DEFAULT '[]',
      max_copies_per_job INTEGER NOT NULL DEFAULT 100,
      max_payload_bytes INTEGER NOT NULL DEFAULT 65536,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS discovered_printers (
      id TEXT PRIMARY KEY NOT NULL,
      runner_id TEXT NOT NULL,
      local_printer_name TEXT NOT NULL,
      driver_name TEXT,
      port_name TEXT,
      connection_type TEXT NOT NULL DEFAULT 'unknown',
      is_default INTEGER NOT NULL DEFAULT 0,
      is_shared INTEGER NOT NULL DEFAULT 0,
      attributes TEXT NOT NULL DEFAULT '{}',
      computer_name TEXT,
      os_name TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      registered_printer_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS print_templates (
      id TEXT PRIMARY KEY NOT NULL,
      template_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      engine TEXT NOT NULL DEFAULT 'RAW_TEXT',
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      paper_profile_id TEXT,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paper_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      width_mm REAL NOT NULL,
      height_mm REAL NOT NULL,
      margin_top_mm REAL NOT NULL DEFAULT 0,
      margin_right_mm REAL NOT NULL DEFAULT 0,
      margin_bottom_mm REAL NOT NULL DEFAULT 0,
      margin_left_mm REAL NOT NULL DEFAULT 0,
      dpi INTEGER NOT NULL DEFAULT 203,
      orientation TEXT NOT NULL DEFAULT 'portrait',
      unit TEXT NOT NULL DEFAULT 'mm',
      fields TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS printer_template_bindings (
      id TEXT PRIMARY KEY NOT NULL,
      printer_code TEXT NOT NULL,
      template_code TEXT NOT NULL,
      paper_profile_id TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY NOT NULL,
      endpoint_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      source_system TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'NONE',
      api_key TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      route_policy_id TEXT NOT NULL,
      callback_transport TEXT NOT NULL DEFAULT 'NONE',
      callback_url TEXT,
      callback_nats_subject TEXT,
      callback_payload_template TEXT,
      callback_on_print_result INTEGER NOT NULL DEFAULT 0,
      callback_signing_secret_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Migration: add callback columns that shipped after the first schema version.
  for (const col of [
    'ALTER TABLE webhook_endpoints ADD COLUMN callback_transport TEXT NOT NULL DEFAULT \'NONE\'',
    'ALTER TABLE webhook_endpoints ADD COLUMN callback_url TEXT',
    'ALTER TABLE webhook_endpoints ADD COLUMN callback_nats_subject TEXT',
    'ALTER TABLE webhook_endpoints ADD COLUMN callback_payload_template TEXT',
    'ALTER TABLE webhook_endpoints ADD COLUMN callback_on_print_result INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE webhook_endpoints ADD COLUMN callback_signing_secret_ref TEXT',
  ]) {
    try {
      db.run(col);
    } catch {
      // column already exists — ignore
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_route_policies (
      id TEXT PRIMARY KEY NOT NULL,
      policy_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      match_rules TEXT NOT NULL DEFAULT '{}',
      printer_mapping TEXT NOT NULL DEFAULT '{}',
      template_mapping TEXT NOT NULL DEFAULT '{}',
      payload_mapping TEXT NOT NULL DEFAULT '{}',
      priority_mapping TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Terminal result-callback deliveries. Durable (unlike the 500-entry
  // in-memory WebhookCallbackAttempt ring buffer) because the retry worker has
  // to find RETRY_SCHEDULED rows again after a process restart — a ring buffer
  // would silently drop a callback still owed to a caller.
  db.run(`
    CREATE TABLE IF NOT EXISTS callback_deliveries (
      id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT NOT NULL,
      print_job_id TEXT NOT NULL,
      request_id TEXT,
      source_system TEXT,
      transport TEXT NOT NULL,
      target TEXT NOT NULL,
      trigger_kind TEXT NOT NULL DEFAULT 'PRINT_RESULT',
      delivery_status TEXT NOT NULL DEFAULT 'PENDING',
      guarantee TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_attempt_at TEXT,
      next_attempt_at TEXT,
      delivered_at TEXT,
      last_http_status INTEGER,
      last_error_code TEXT,
      last_error_message TEXT,
      print_status TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      endpoint_id TEXT,
      endpoint_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // The UNIQUE index IS the callback idempotency guarantee: a redelivered or
  // replayed terminal event cannot insert a second delivery for the same
  // (job, transport, destination).
  db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_callback_deliveries_key ON callback_deliveries(print_job_id, transport, target)',
  );
  db.run('CREATE INDEX IF NOT EXISTS idx_callback_deliveries_job ON callback_deliveries(print_job_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_callback_deliveries_request ON callback_deliveries(request_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_callback_deliveries_event ON callback_deliveries(event_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_callback_deliveries_status ON callback_deliveries(delivery_status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_callback_deliveries_next ON callback_deliveries(next_attempt_at)');

  db.run(`
    CREATE TABLE IF NOT EXISTS imported_designs (
      id TEXT PRIMARY KEY NOT NULL,
      paper_profile_id TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      fit_mode TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      pixel_width INTEGER NOT NULL,
      pixel_height INTEGER NOT NULL,
      detected_dpi REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}
