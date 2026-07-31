# PROD-01 Windows pilot runbook

This runbook describes the packaged Windows desktop architecture at version
0.1.15. Procedures that still require clean-machine or physical acceptance are
identified explicitly; their successful execution must be recorded in
`docs/verification/PROD-01-report.md`.

## Clean installation

1. Verify the MSI or NSIS SHA-256 against `artifacts/prod-01/release-manifest.json`.
2. Install on the pilot Windows workstation using the normal installer UI.
3. Start PrintOps from the Start menu. Node, npm, Go, Rust, and .NET are build
   tools and must not be installed on the pilot workstation.
4. Confirm the local dashboard loads while general internet access is disabled.
5. Open Settings and confirm the runtime reports the API local worker as sole
   executor and the Go runner as discovery-only.

## First-run owner setup

On a new database, PrintOps opens **Secure this PrintOps station** instead of a
login form.

1. Enter the owner name and email.
2. Enter the password twice. It must contain 12–128 characters, uppercase,
   lowercase, a number, and a symbol.
3. Select **Create owner account**.
4. Confirm the dashboard opens and a restart returns to the normal login form.

There is no production default password. Repeated bootstrap requests after the
first successful owner return `409`.

### Existing development database migration

An existing database with a passwordless OWNER shows the migration setup text.
Use that existing OWNER email and choose a new strong password. PrintOps rejects
a different email rather than silently creating a competing owner. On success,
other passwordless legacy accounts are disabled. Plaintext legacy passwords are
never accepted.

Back up the database before pilot migration. If the expected OWNER email is
unknown, stop and restore the backup; do not delete the database to bypass
ownership.

## Integration API-key creation

Only an OWNER can manage integration keys.

1. Open **Settings → Integration API keys**.
2. Enter a descriptive account name and stable source-system identifier.
3. Select **Create API key**.
4. Copy the displayed `po_live_…` key immediately into the calling system's
   secret store. PrintOps cannot display it again.
5. Configure the caller to send `X-Api-Key: <key>`.

Use **Rotate key** to invalidate the previous key immediately and display a new
key once. Use **Revoke** to stop the integration. Create, rotate, and revoke
actions appear in Audit Logs with actor, time, and service-account identity.

Never place a key in a command history, screenshot, issue, support bundle, or
shared configuration file. When command-line verification is required, load it
from the process environment and redact the captured command.

## Printer discovery and registration

1. Install the manufacturer's supported Windows driver.
2. Add the printer in Windows and print a Windows test page.
3. Start PrintOps and open **Discovered printers**.
4. Confirm the Windows queue appears under the local discovery runner.
5. Register it with a stable PrintOps printer code; do not edit source code or
   rely on a seeded queue name.

Only installed Windows printer queues are supported by PROD-01. Raw TCP, CUPS,
IPP execution, and remote/headless execution are deferred.

## Paper profile, template, and test print

1. Create or import the paper profile in **Paper profiles**.
2. Create the matching template and binding through the dashboard.
3. Preview the exact output and verify dimensions.
4. Run a packaged UI test print.
5. Record the job, trace, audit identifiers, screenshot, and physical sample ID.

Spooler acceptance alone is not physical proof. A result without job-specific
device evidence must remain `UNVERIFIED`.

## NATS configuration

1. Open **Settings → NATS client configuration**.
2. Use the remote broker address, never `localhost` for an off-host broker.
3. Choose a unique workstation client ID.
4. Enter the approved subject prefix and apply the settings.
5. Confirm core, JetStream, stream, durable, and intake readiness separately.

Before OWNER setup, NATS intake remains paused with
`CREDENTIALS_NOT_INITIALIZED`. If the broker starts later, PrintOps retries
without requiring an application restart. Duplicate client IDs are prohibited.

## Backup and restore

Select **Settings → Download database backup** while signed in as OWNER. The
download is a consistent SQLite snapshot and the action is audited. It contains
operational history and must be moved immediately to approved encrypted
storage.

Restore remains an offline operator procedure:

1. Exit PrintOps and confirm its sidecars have stopped.
2. Preserve the current `printops.db` under a new incident filename.
3. Copy the verified backup to the application-data directory as `printops.db`.
4. Start PrintOps and verify owner login, schema version, printers, jobs,
   callback state, and Audit Logs.

On an application upgrade, PrintOps creates a timestamped byte-for-byte backup
in `printops.db.backups` before applying a schema migration. A failed migration
preserves the primary and backup and prevents startup.

Never copy `jwt-secret.txt` or `runner-bootstrap-secret.txt` into support
attachments. Packaged restore still requires clean-machine acceptance evidence.

## Logs and support

Desktop, server, and runner logs are below the per-user PrintOps application
data/log directory. Redact credentials, payloads, patient data, callback
secrets, NATS credentials, and API keys before sharing.

The required downloadable support bundle is not yet accepted. Do not substitute
an unreviewed archive of the application-data directory.

## Restart and recovery

Normal restart must preserve configuration and history. Safe pre-dispatch work
may be recovered. A job interrupted in `DISPATCHED` or `PRINTING` must become
`UNVERIFIED` and must not print automatically. Follow the job trace and inspect
the physical printer before an OWNER decides whether to create a new request.

If a sidecar exits unexpectedly, the desktop logs the exit and restarts that
sidecar with the packaged configuration. If repeated restarts continue, capture
the redacted logs and restart PrintOps. Do not launch a second server or runner
manually against the same database.

## Upgrade, rollback, and uninstall

Before upgrade:

1. Capture the installed version and installer SHA-256.
2. Stop PrintOps and take the approved backup.
3. Install the newer signed/verified package over the existing installation.
4. Confirm owner login, settings, printers, history, and pending callback state.

Rollback and uninstall data-retention behavior remain unaccepted until the
Phase 4/clean-machine matrix is executed. Do not delete application data during
a pilot incident. Record the actual installer prompts and retained paths in the
verification report.
