# PROD-01 verification report

This report distinguishes automated repository evidence from packaged,
physical, cross-machine, and upgrade evidence. A `BLOCKED` row is not a pass.

## Build under test

| Field | Value |
| --- | --- |
| Report date/time | 2026-07-31, Asia/Bangkok |
| Branch | `mvp_nippon` |
| Application version | 0.1.15 |
| Git commit | Pending authentication-phase commit |
| Installer MSI | Pending rebuilt installer |
| Installer NSIS | Pending rebuilt installer |
| Windows version | Development workstation only; clean-machine value pending |
| Printer | Pending physical acceptance |
| NATS | Pending cross-machine acceptance |

## Gate summary

| Gate | Result | Evidence |
| --- | --- | --- |
| AUTOMATED | PARTIAL | API 45 files/350 tests, web 23 files/453 tests, API/web typechecks and builds, Go suite, Rust suite, SQLite migration/backup, readiness, and support-bundle redaction automation pass; bound-port, real NATS, Playwright, and packaged smoke automation remain incomplete. |
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
| AUTH-04 | Runner secret is exact-match only | Invalid secret 401; valid secret issues JWT | `apps/api/src/tests/auth-security.test.ts` | PASS | Packaged sidecar exercise pending |
| KEY-01 | Key plaintext shown only on create/rotate and hash stored | Random `po_live_…` returned; list/audit omit key/hash | `apps/api/src/tests/service-account-security.test.ts` | PASS | Packaged clipboard/operator exercise pending |
| KEY-02 | Rotate/revoke immediately invalidate lifecycle state | Hash changes on rotation; account inactive on revoke | `apps/api/src/tests/service-account-security.test.ts` | PASS | Bound-port external caller exercise pending |
| KEY-03 | OWNER-only mutation with actor audit | ADMIN receives 403; three actor-attributed audit actions recorded | `apps/api/src/tests/service-account-security.test.ts` | PASS | Audit UI screenshot pending |
| AUTH-05 | External intake unavailable before OWNER setup | API-key hook returns 503 before readiness | `apps/api/src/tests/service-account-security.test.ts` | PASS | Real NATS pending-message behavior pending |
| API-01 | Existing API regression suite stays green | 45 files / 350 tests pass | Local command output, 2026-07-31 | PASS | Bound-port and real-service integration remain |
| WEB-01 | Frontend regressions absent and translations remain paired | 23 files / 453 tests pass; production Vite build passes | Local command output, 2026-07-31 | PASS | Packaged WebView exercise pending |
| RUNNER-01 | Go runner remains build/test clean | `go test ./...` passes | Local command output, 2026-07-31 | PASS | Packaged runner authentication pending |
| DESKTOP-01 | Per-installation secrets use OS CSPRNG and persist | Rust check and 5 tests pass | Local command output, 2026-07-31 | PASS | File ACL/clean-install inspection pending |
| DB-01 | Legacy DB migration is versioned, backed up, and data-preserving | Version 0 upgrades to 1; marker data survives; byte-identical backup retained | `apps/api/src/tests/sqlite-migration-safety.test.ts` | PASS | Real prior installer DB pending |
| DB-02 | Unsafe DB inputs fail without overwriting primary | Newer schema, corruption, and invalid path are rejected with stage errors | `apps/api/src/tests/sqlite-migration-safety.test.ts` | PASS | Packaged read-only/locked UI evidence pending |
| DB-03 | OWNER backup is valid and audited | Download opens as current-schema SQLite; no-store and actor audit verified | `apps/api/src/tests/database-backup.test.ts` | PASS | Offline packaged restore pending |
| DB-04 | Restart does not replay uncertain physical work | Safe states rehydrate; `DISPATCHED`/`PRINTING` become `UNVERIFIED` | `apps/api/src/tests/local-worker-rehydration.test.ts` | PASS | Forced packaged termination pending |
| READY-01 | Required runtime components are represented independently | Local/API/DB/worker/discovery/printer and split NATS/callback/retry states returned with actions | `apps/api/src/tests/readiness-support-bundle.test.ts` | PASS | Packaged Settings screenshot pending |
| SUPPORT-01 | Support export is OWNER-only, audited, bounded, and credential-safe | ADMIN receives 403; payloads, targets, URL credentials, bearer tokens, API keys, and passwords are absent | `apps/api/src/tests/readiness-support-bundle.test.ts` | PASS | Manual packaged bundle review pending |

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
