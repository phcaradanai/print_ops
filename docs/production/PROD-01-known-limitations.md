# PROD-01 known limitations

Last updated: 2026-07-31 (Asia/Bangkok)

These limits are part of the Windows pilot boundary. Repository implementation
or unit tests do not override a blocked acceptance gate.

## Supported production boundary

- Windows desktop package only.
- Printers installed through a supported Windows printer driver.
- The bundled API local worker is the sole print executor.
- The bundled Go runner is discovery and heartbeat only.
- HTTP and client-scoped NATS JetStream intake.
- HTTP or NATS terminal callbacks where configured.

## Deferred or unsupported

- macOS and Linux packaged production.
- CUPS, raw TCP 9100, ZPL/TSPL direct execution, and remote/headless runners.
- IPP execution as a production path.
- Automatic replay of uncertain `DISPATCHED` or `PRINTING` work.
- Multiple desktop processes sharing one database.

## Acceptance still outstanding

- Clean Windows installation without developer toolchains.
- Full first-run and legacy-database authentication exercise in the installer.
- Packaged restore, prior-installer migration, and migration rollback proof
  remain outstanding; backup download and versioned pre-migration copies are
  implemented.
- Packaged manual review of the downloadable support bundle on a clean pilot
  machine; automated payload/credential redaction checks are implemented.
- Physical UI, HTTP, and NATS prints through a real installed printer.
- The physical printer failure matrix.
- Cross-machine NATS, callback receiver, reconnect, and duplicate-client matrix.
- Upgrade, rollback, uninstall, and data-retention matrix.
- Code-signing and organization-specific installer distribution policy.

## Result semantics

Windows spooler acceptance is not proof that the physical page completed.
PrintOps must use `UNVERIFIED` when evidence cannot be attributed to the exact
job. Operators must not blindly retry an uncertain job.

## Security operations

- Integration keys are not recoverable after their create/rotate response.
- Losing the only OWNER password currently requires a controlled database
  recovery procedure; there is no insecure password-reset backdoor.
- NATS transport credentials are deployment-managed; the current desktop
  settings UI covers broker URL/client identity, not a general enterprise
  credential vault.
- The temporary manual database backup procedure includes installation secrets
  and therefore requires encrypted, access-controlled storage.
