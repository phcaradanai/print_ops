-- PrintOps MVP — Initial Schema (PostgreSQL)
-- Branch: mvp_nippon
-- Run order: 001

-- ============================================================
-- service_accounts — external integration programs
-- ============================================================
CREATE TABLE IF NOT EXISTS service_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  source_system   TEXT NOT NULL UNIQUE,
  api_key_hash    TEXT NOT NULL,
  api_key_prefix  TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_printer_codes  TEXT[] NOT NULL DEFAULT '{}',
  allowed_template_codes TEXT[] NOT NULL DEFAULT '{}',
  max_copies_per_job     INTEGER NOT NULL DEFAULT 100,
  max_payload_bytes      INTEGER NOT NULL DEFAULT 65536,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- printers
-- ============================================================
CREATE TABLE IF NOT EXISTS printers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  location         TEXT,
  protocol         TEXT NOT NULL,
  connection_uri   TEXT NOT NULL,
  allowed_templates TEXT[],
  max_copies_per_job INTEGER,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_printers_code ON printers (code) WHERE is_active = TRUE;

-- ============================================================
-- printer_status_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS printer_status_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id  UUID NOT NULL REFERENCES printers(id),
  status_code TEXT NOT NULL,
  message     TEXT,
  toner_levels  JSONB,
  paper_levels  JSONB,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_printer_status_printer_id ON printer_status_snapshots (printer_id, checked_at DESC);

-- ============================================================
-- runners
-- ============================================================
CREATE TABLE IF NOT EXISTS runners (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  hostname            TEXT NOT NULL,
  ip_address          TEXT,
  status              TEXT NOT NULL DEFAULT 'offline',
  supported_protocols TEXT[] NOT NULL DEFAULT '{}',
  last_heartbeat_at   TIMESTAMPTZ,
  registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata            JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS runner_heartbeats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id  UUID NOT NULL REFERENCES runners(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runner_heartbeats_runner ON runner_heartbeats (runner_id, received_at DESC);

-- ============================================================
-- print_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS print_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id        UUID NOT NULL REFERENCES printers(id),
  printer_code      TEXT,
  template_code     TEXT,
  created_by        TEXT NOT NULL,
  source_system     TEXT,
  source_reference  TEXT,
  request_id        TEXT,
  status            TEXT NOT NULL DEFAULT 'ACCEPTED',
  priority          INTEGER NOT NULL DEFAULT 50,
  priority_label    TEXT NOT NULL DEFAULT 'normal',
  trace_id          TEXT NOT NULL,
  correlation_id    TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  copies            INTEGER NOT NULL DEFAULT 1,
  duplex            BOOLEAN NOT NULL DEFAULT FALSE,
  color_mode        TEXT NOT NULL DEFAULT 'auto',
  media_type        TEXT,
  resolution        TEXT,
  payload_snapshot  TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  max_retries       INTEGER NOT NULL DEFAULT 3,
  runner_id         UUID REFERENCES runners(id),
  adapter_used      TEXT,
  -- fast-path timestamps
  received_at       TIMESTAMPTZ,
  validated_at      TIMESTAMPTZ,
  queued_at         TIMESTAMPTZ,
  dispatched_at     TIMESTAMPTZ,
  runner_received_at TIMESTAMPTZ,
  spooler_sent_at   TIMESTAMPTZ,
  printer_ack_at    TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  -- computed latency (ms)
  total_latency_ms  INTEGER,
  validation_ms     INTEGER,
  queue_wait_ms     INTEGER,
  dispatch_ms       INTEGER,
  runner_exec_ms    INTEGER,
  spooler_ms        INTEGER,
  printer_ack_ms    INTEGER,
  -- error info
  error_code        TEXT,
  error_message     TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: one job per (request_id, source_system)
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_idempotency
  ON print_jobs (request_id, source_system)
  WHERE request_id IS NOT NULL AND source_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_print_jobs_status     ON print_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_jobs_printer_id ON print_jobs (printer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_jobs_source     ON print_jobs (source_system, source_reference);

-- ============================================================
-- print_job_events
-- ============================================================
CREATE TABLE IF NOT EXISTS print_job_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES print_jobs(id),
  event_type     TEXT NOT NULL,
  trace_id       TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON print_job_events (job_id, occurred_at);

-- ============================================================
-- print_job_traces
-- ============================================================
CREATE TABLE IF NOT EXISTS print_job_traces (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES print_jobs(id) UNIQUE,
  trace_id       TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  source         TEXT NOT NULL,
  destination    TEXT NOT NULL,
  runner_id      UUID REFERENCES runners(id),
  printer_id     UUID NOT NULL REFERENCES printers(id),
  adapter_name   TEXT NOT NULL,
  queued_at      TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  duration_ms    INTEGER,
  status         TEXT NOT NULL,
  error_code     TEXT,
  error_message  TEXT,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  evidence       JSONB NOT NULL DEFAULT '{}',
  steps          JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_traces_job_id   ON print_job_traces (job_id);
CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON print_job_traces (trace_id);

-- ============================================================
-- audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id      TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor_id      TEXT,
  actor_email   TEXT,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  before_state  JSONB,
  after_state   JSONB,
  metadata      JSONB NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor    ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_time     ON audit_logs (occurred_at DESC);

-- ============================================================
-- users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'VIEWER',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- discovered_printers  (runner printer discovery — read-only, no spooler changes)
-- ============================================================
CREATE TABLE IF NOT EXISTS discovered_printers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id             TEXT NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  local_printer_name    TEXT NOT NULL,
  driver_name           TEXT,
  port_name             TEXT,
  connection_type       TEXT NOT NULL DEFAULT 'unknown',
  is_default            BOOLEAN NOT NULL DEFAULT FALSE,
  is_shared             BOOLEAN NOT NULL DEFAULT FALSE,
  attributes            JSONB NOT NULL DEFAULT '{}',
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
  UNIQUE (runner_id, local_printer_name)
);

CREATE INDEX IF NOT EXISTS idx_discovered_runner ON discovered_printers (runner_id);
CREATE INDEX IF NOT EXISTS idx_discovered_last_seen ON discovered_printers (last_seen_at DESC);
