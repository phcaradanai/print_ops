# PROD-01 verification report

This report distinguishes automated repository evidence from packaged,
physical, cross-machine, and upgrade evidence. A `BLOCKED` row is not a pass.

## Build under test

| Field | Value |
| --- | --- |
| Report date/time | 2026-07-31, Asia/Bangkok |
| Branch | `mvp_nippon` |
| Application version | 0.1.15 |
| Git commit | `bd531e98219e287be1913f74bc74246fb61c5d2e` |
| Installer MSI | `PrinterOps_0.1.15_x64_en-US.msi`, 26,509,312 bytes, SHA-256 `6898094502202f2fbd60afd1ff95f798ef2fd9ec66f50b733ec0262ec500e971` |
| Installer NSIS | `PrinterOps_0.1.15_x64-setup.exe`, 20,146,066 bytes, SHA-256 `f97668fc06597cfe8c16552b062348bcbfbe9afb4d3b6543b7145c19b6cabe03` |
| Windows version | Development workstation only; clean-machine value pending |
| Printer | Pending physical acceptance |
| NATS | Automated loopback: 2.10.29, pinned digest; cross-machine acceptance pending |

## Gate summary

| Gate | Result | Evidence |
| --- | --- | --- |
| AUTOMATED | PASS | API 45 files/351 tests, web 23 files/453 tests, API/web typechecks and builds, Go suite, Rust suite, SQLite migration/backup, readiness, support-bundle redaction, pinned real JetStream/TCP callback matrix, 67 built-static Playwright tests, release-verifier negatives, final MSI/NSIS verification, packaged sidecar smoke, and packaged Tauri supervision smoke pass. |
| PACKAGED CLEAN-MACHINE | BLOCKED | No post-authentication installer clean-install evidence captured. |
| PHYSICAL PRINTER | BLOCKED | No physical sample or packaged UI/HTTP/NATS print matrix captured. |
| CROSS-MACHINE NATS | BLOCKED | No off-host broker/listener evidence captured. |
| UPGRADE/ROLLBACK | BLOCKED | No prior-database upgrade and rollback evidence captured. |

## Automated cases

| Test ID | Expected | Observed | Evidence | Result | Remaining risk |
| --- | --- | --- | --- | --- | --- |
| AUTH-01 | One atomic OWNER bootstrap | Concurrent requests yield one success and one 409; one OWNER stored | `apps/api/src/tests/auth-security.test.ts` | PASS | Packaged UI exercise pending |
| AUTH-02 | Strong salted password; legacy plaintext rejected | scrypt round-trip succeeds; wrong/plaintext values fail | `apps/api/src/tests/auth-security.test.ts` | PASS | Password recovery procedure pending |
| AUTH-03 | Existing database requires matching OWNER email | Mismatched migration email returns 409 | `apps/api/src/tests/auth-security.test.ts` | PASS | Prior real database copy pending |
| AUTH-04 | Runner secret is exact-match only | Invalid secret 401; valid secret issues JWT; shipped discovery runner authenticates and registers under isolated packaged state | `apps/api/src/tests/auth-security.test.ts`, `artifacts/prod-01/packaged-sidecar-smoke.json` | PASS | Clean-machine filesystem inspection pending |
| KEY-01 | Key plaintext shown only on create/rotate and hash stored | Random `po_live_…` returned; list/audit omit key/hash | `apps/api/src/tests/service-account-security.test.ts` | PASS | Packaged clipboard/operator exercise pending |
| KEY-02 | Rotate/revoke immediately invalidate lifecycle state | Hash changes on rotation; account inactive on revoke | `apps/api/src/tests/service-account-security.test.ts` | PASS | Bound-port external caller exercise pending |
| KEY-03 | OWNER-only mutation with actor audit | ADMIN receives 403; three actor-attributed audit actions recorded | `apps/api/src/tests/service-account-security.test.ts` | PASS | Audit UI screenshot pending |
| AUTH-05 | External intake unavailable before OWNER setup | API-key hook returns 503 before readiness | `apps/api/src/tests/service-account-security.test.ts` | PASS | Real NATS pending-message behavior pending |
| API-01 | Existing API regression suite stays green | 45 files / 351 tests pass | Local command output, 2026-07-31 | PASS | Physical and off-host integration remain |
| WEB-01 | Frontend regressions absent and translations remain paired | 23 files / 453 tests pass; production Vite build passes | Local command output, 2026-07-31 | PASS | Packaged WebView exercise pending |
| RUNNER-01 | Go runner remains build/test clean | `go test ./...` passes | Local command output, 2026-07-31 | PASS | Packaged runner authentication pending |
| DESKTOP-01 | Per-installation secrets use OS CSPRNG and persist | Rust check and 5 tests pass | Local command output, 2026-07-31 | PASS | File ACL/clean-install inspection pending |
| DB-01 | Legacy DB migration is versioned, backed up, and data-preserving | Version 0 upgrades to 1; marker data survives; byte-identical backup retained | `apps/api/src/tests/sqlite-migration-safety.test.ts` | PASS | Real prior installer DB pending |
| DB-02 | Unsafe DB inputs fail without overwriting primary | Newer schema, corruption, invalid read path, and unwritable parent are rejected with stage errors; shipped `server.exe` rejects a locked database, preserves corrupt bytes, and reports `PRINTOPS_DB_WRITE_FAILED` without changing the blocker | `apps/api/src/tests/sqlite-migration-safety.test.ts`, `artifacts/prod-01/packaged-sidecar-smoke.json` | PASS | Clean-machine UI presentation pending |
| DB-03 | OWNER backup is valid and audited | Download opens as current-schema SQLite; no-store and actor audit verified | `apps/api/src/tests/database-backup.test.ts` | PASS | Offline packaged restore pending |
| DB-04 | Restart does not replay uncertain physical work | Shipped `server.exe` recovers `ACCEPTED`/`VALIDATED` to `QUEUED`, preserves `QUEUED`, converts `DISPATCHED`/`PRINTING` to `UNVERIFIED` with recovery metadata, and does not replay ambiguous jobs | `apps/api/src/tests/local-worker-rehydration.test.ts`, `artifacts/prod-01/packaged-sidecar-smoke.json` | PASS | Termination during a real physical spool remains in the printer matrix |
| READY-01 | Required runtime components are represented independently | Local/API/DB/worker/discovery/printer and split NATS/callback/retry states returned with actions | `apps/api/src/tests/readiness-support-bundle.test.ts` | PASS | Packaged Settings screenshot pending |
| SUPPORT-01 | Support export is OWNER-only, audited, bounded, and credential-safe | ADMIN receives 403; payloads, targets, URL credentials, bearer tokens, API keys, and passwords are absent | `apps/api/src/tests/readiness-support-bundle.test.ts` | PASS | Manual packaged bundle review pending |
| NATS-E2E-01 | Real JetStream intake and real TCP callbacks cover both transports without duplicates | Pinned NATS 2.10.29 container passes API/NATS intake × HTTP/NATS callback, no-callback, DLQ, retry/recovery, and cross-transport idempotency cells | `artifacts/e2e/e2e-report.json`, generated 2026-07-31T10:07:45Z | PASS | Loopback fake-printer automation only; off-host and physical proof pending |
| WEB-E2E-01 | Production static bundle remains operable at supported viewports | 67/67 Playwright tests pass against `apps/web/dist` | Local command output, 2026-07-31 | PASS | WebView2 packaged exercise pending |
| RELEASE-01 | Release fails closed and emits current installer hashes | Four verifier-negative tests reject version drift, forbidden artifacts, missing/zero resources, and stale outputs; final post-bundle gate verifies both installers against current resources | `scripts/release-verify.test.mjs`, `artifacts/prod-01/release-manifest.json`, generated 2026-07-31T11:00:23Z | PASS | Code signing and clean-machine installation pending |
| PACKAGED-01 | Shipped API and discovery binaries start safely and recover durable state | Final bundled `server.exe` passes 16 checks covering health, OWNER bootstrap, discovery-only runner, `SINGLE_EXECUTOR`, readiness, restart persistence, five job-state recoveries, no ambiguous replay, exclusive lock, corrupt-file preservation, and write-stage failure | `artifacts/prod-01/packaged-sidecar-smoke.json`, generated after final bundle | PASS | Tauri/WebView2 clean-machine UI and filesystem ACL exercise pending |
| PACKAGED-02 | Tauri contains and supervises product sidecars | Actual release desktop enforces single instance, recovers both forced-terminated sidecars, contains them in a kill-on-close Windows Job Object, leaves no child after abrupt shell termination, restarts cleanly, and leaves no child after normal close | `artifacts/prod-01/packaged-desktop-supervision-smoke.json`, generated 2026-07-31T10:50:32Z | PASS | Clean-machine UI exercise pending |

## Packaged, physical, cross-machine, and recovery matrices

The case rows required by the PROD-01 gate will be added with:

- exact date/time and timezone;
- tested Git commit and installer SHA-256;
- Windows version and machine role;
- printer make/model/driver;
- NATS version and sanitized address;
- exact sanitized request;
- expected and observed result;
- trace/audit IDs;
- evidence filename;
- PASS/FAIL/BLOCKED and remaining risk.

Until those rows contain reproducible evidence, their gate summaries remain
`BLOCKED`.
