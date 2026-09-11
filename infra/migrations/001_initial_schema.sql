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
-- template management, route policy, and dynamic intake
-- ============================================================
CREATE TABLE IF NOT EXISTS paper_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  width_mm          NUMERIC(10, 2) NOT NULL,
  height_mm         NUMERIC(10, 2) NOT NULL,
  margin_top_mm     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  margin_right_mm   NUMERIC(10, 2) NOT NULL DEFAULT 0,
  margin_bottom_mm  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  margin_left_mm    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  dpi               INTEGER NOT NULL DEFAULT 203,
  orientation       TEXT NOT NULL DEFAULT 'portrait',
  unit              TEXT NOT NULL DEFAULT 'mm',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code     TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  engine            TEXT NOT NULL,
  content           TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'DRAFT',
  paper_profile_id  UUID REFERENCES paper_profiles(id),
  created_by        TEXT NOT NULL,
  updated_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_template_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       UUID NOT NULL REFERENCES print_templates(id) ON DELETE CASCADE,
  template_code     TEXT NOT NULL,
  version           INTEGER NOT NULL,
  engine            TEXT NOT NULL,
  content           TEXT NOT NULL,
  status            TEXT NOT NULL,
  paper_profile_id  UUID REFERENCES paper_profiles(id),
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_code, version)
);

CREATE TABLE IF NOT EXISTS printer_template_bindings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_code      TEXT NOT NULL,
  template_code     TEXT NOT NULL,
  paper_profile_id  UUID REFERENCES paper_profiles(id),
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (printer_code, template_code)
);

CREATE TABLE IF NOT EXISTS webhook_route_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code       TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  match_rules       JSONB NOT NULL DEFAULT '{}',
  printer_mapping   JSONB NOT NULL DEFAULT '{}',
  template_mapping  JSONB NOT NULL DEFAULT '{}',
  payload_mapping   JSONB NOT NULL DEFAULT '{}',
  priority_mapping  JSONB NOT NULL DEFAULT '{}',
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_code     TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  source_system     TEXT NOT NULL,
  auth_mode         TEXT NOT NULL DEFAULT 'NONE',
  secret_hash       TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  route_policy_id   UUID REFERENCES webhook_route_policies(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_render_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id          TEXT NOT NULL,
  print_job_id      UUID REFERENCES print_jobs(id) ON DELETE SET NULL,
  template_code     TEXT NOT NULL,
  paper_profile_id  UUID REFERENCES paper_profiles(id),
  render_ms         INTEGER NOT NULL DEFAULT 0,
  warnings          JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS resolved_template_code TEXT,
  ADD COLUMN IF NOT EXISTS paper_profile_id UUID REFERENCES paper_profiles(id),
  ADD COLUMN IF NOT EXISTS route_policy_id UUID REFERENCES webhook_route_policies(id),
  ADD COLUMN IF NOT EXISTS intake_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS route_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS template_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rendered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS route_resolve_ms INTEGER,
  ADD COLUMN IF NOT EXISTS render_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_print_templates_code ON print_templates (template_code);
CREATE INDEX IF NOT EXISTS idx_template_bindings_printer ON printer_template_bindings (printer_code) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_code ON webhook_endpoints (endpoint_code) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_render_logs_job ON template_render_logs (print_job_id, created_at DESC);

INSERT INTO paper_profiles (
  code, name, width_mm, height_mm, margin_top_mm, margin_right_mm,
  margin_bottom_mm, margin_left_mm, dpi, orientation, unit
) VALUES
  ('LABEL_100X50', 'Label 100 x 50 mm', 100, 50, 2, 2, 2, 2, 203, 'portrait', 'mm'),
  ('LABEL_80X50', 'Label 80 x 50 mm', 80, 50, 2, 2, 2, 2, 203, 'portrait', 'mm')
ON CONFLICT (code) DO NOTHING;

INSERT INTO print_templates (
  template_code, name, description, engine, content, status, paper_profile_id, created_by
) VALUES
  (
    'LAB_LABEL_DEFAULT',
    'Lab Label Default',
    'Default lab label template',
    'RAW_TEXT',
    'LAB {{label}}
BARCODE {{barcode}}
HN {{hn_masked}}',
    'PUBLISHED',
    (SELECT id FROM paper_profiles WHERE code = 'LABEL_100X50'),
    'seed'
  ),
  (
    'BARCODE_LABEL_DEFAULT',
    'Barcode Label Default',
    'Default ZPL-like barcode label skeleton',
    'ZPL',
    '^XA
^FO40,40^FD{{label}}^FS
^FO40,80^BCN,80,Y,N,N^FD{{barcode}}^FS
^XZ',
    'PUBLISHED',
    (SELECT id FROM paper_profiles WHERE code = 'LABEL_100X50'),
    'seed'
  ),
  (
    'TEST_LABEL',
    'Test Label',
    'Basic RAW_TEXT test label',
    'RAW_TEXT',
    'TEST {{label}}
{{barcode}}',
    'PUBLISHED',
    (SELECT id FROM paper_profiles WHERE code = 'LABEL_100X50'),
    'seed'
  )
ON CONFLICT (template_code) DO NOTHING;

INSERT INTO printer_template_bindings (
  printer_code, template_code, paper_profile_id, is_default, enabled
) VALUES (
  'LAB_LABEL_01',
  'LAB_LABEL_DEFAULT',
  (SELECT id FROM paper_profiles WHERE code = 'LABEL_100X50'),
  TRUE,
  TRUE
) ON CONFLICT (printer_code, template_code) DO NOTHING;

INSERT INTO webhook_route_policies (
  policy_code, name, match_rules, printer_mapping, template_mapping, payload_mapping, priority_mapping, enabled
) VALUES (
  'lab-label-static',
  'Lab Label Static',
  '{"when":[{"field":"type","op":"eq","value":"lab_label"}]}'::jsonb,
  '{"strategy":"static","printer_code":"LAB_LABEL_01"}'::jsonb,
  '{"strategy":"static","template_code":"LAB_LABEL_DEFAULT"}'::jsonb,
  '{"barcode":"$.barcode","label":"$.label","hn_masked":"$.hn"}'::jsonb,
  '{"strategy":"static","priority":"normal"}'::jsonb,
  TRUE
) ON CONFLICT (policy_code) DO NOTHING;

INSERT INTO webhook_endpoints (
  endpoint_code, name, source_system, auth_mode, enabled, route_policy_id
) VALUES (
  'dev-intake',
  'Development Intake',
  'integration-service',
  'NONE',
  TRUE,
  (SELECT id FROM webhook_route_policies WHERE policy_code = 'lab-label-static')
) ON CONFLICT (endpoint_code) DO NOTHING;

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
  computer_name         TEXT,
  os_name               TEXT,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
  UNIQUE (runner_id, local_printer_name)
);

CREATE INDEX IF NOT EXISTS idx_discovered_runner ON discovered_printers (runner_id);
CREATE INDEX IF NOT EXISTS idx_discovered_last_seen ON discovered_printers (last_seen_at DESC);
