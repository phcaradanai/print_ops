# PROD-01 code-backed gap table

Last updated: 2026-07-31 (Asia/Bangkok)

Status meanings:

- **PASS**: current repository evidence directly covers the stated in-repository requirement.
- **PARTIAL**: implementation exists, but required production or failure-matrix evidence is incomplete.
- **BLOCKED**: the gate requires external hardware, another machine/service, or clean-install evidence that is not present.
- **FAIL**: current evidence contradicts the requirement.

This table is an implementation guide, not an acceptance report. Automated evidence does not convert a packaged, physical, cross-machine, or upgrade gate into a pass.

| Phase | Status | Current evidence | Remaining proof or implementation |
| --- | --- | --- | --- |
| 0. Branch reconciliation | PASS | Merge `24b4555` records `origin/main` ancestry. Commit `232fd78` deliberately ports the workspace watch scripts while preserving the Go runner workflow. Commit `c023bcf` hardens the active `NatsConnectionManager`; `apps/api/src/tests/nats-consumer-lifecycle.test.ts` covers compatible reuse, subject conflict, create race, and safe tuning updates. | Real JetStream reconnect and duplicate-consume-loop integration evidence remains part of Phases 7–8. |
| 1. Truthful Windows architecture | PASS | `docs/production/PROD-01-architecture.md` records the packaged topology. Tauri injects one shared discovery-only value into both sidecars; `runtime-architecture.ts` refuses unsafe packaged startup; Settings shows the effective executor/discovery owners; the Go runner advertises no executable protocols when discovery-only. API, Go, web/i18n, and Rust tests cover the contract. | Remote/headless Go execution remains deferred and needs a separate production gate. |
| 2. Fail-closed release | PARTIAL | Root `release:verify` validates toolchains, version consistency, forbidden tracked artifacts, complete builds, required resources, freshness, and zero-byte files. Four negative tests exercise rejection paths. `desktop:bundle` produced fresh MSI/NSIS installers for commit `071acd4` and recorded their SHA-256 hashes in the release manifest. | Prove both installer formats on a clean Windows machine and complete the organization-specific signing/distribution decision. |
| 3. Packaged authentication | PARTIAL | First-run OWNER setup uses salted scrypt hashes and single-flight creation; legacy passwordless databases require explicit OWNER-email migration and now expose only masked eligible-owner hints; production fixtures are suppressed; HTTP and NATS intake wait for initialized credentials; service keys are random, one-time, hashed, rotatable, revocable, and audited; packaged CORS is loopback-only; the discovery runner uses a separate CSPRNG installation secret. The shipped `server.exe` smoke proves first bootstrap, authenticated access, and restart persistence. | Capture clean-install UI, existing-database migration, filesystem ACL, and operator log-redaction evidence before marking the packaged gate PASS. |
| 4. Persistence/recovery | PARTIAL | SQLite has an OS-owned exclusive process lock, atomic replace-on-save, versioned migration/backup, and actionable read/write/corruption errors. Shipped `server.exe` proves all five durable restart states, ambiguous replay suppression, lock rejection, corrupt-byte preservation, and write failure. The release desktop proves single instance, child restart/containment, and clean restart after forced shell termination. | Physical mid-spool termination, real prior-installer upgrade, restore, rollback, and uninstall/data-retention still require external acceptance. |
| 5. Readiness/support diagnostics | PARTIAL | Authenticated readiness now separates all required local, printer, NATS, and callback components, includes timing/error/action diagnostics, and the Settings UI exposes the same model. JetStream durable conflicts identify exact expected/actual fields and safe non-destructive remedies, including during Test Connection. An OWNER-only audited support bundle includes bounded logs and operational summaries while tests prove payload, target, URL-credential, bearer, API-key, and password redaction. | Exercise packaged UI output and broker/network late recovery; manually review a real packaged support bundle before marking PASS. |
| 6. Real Windows printing | BLOCKED | Windows spooler, WebView2 helper, discovery, UI workflows, and packaged resources exist. | Execute the complete UI/HTTP/NATS physical workflow and failure matrix with an installed printer; capture job-specific evidence and physical samples. |
| 7. Cross-machine NATS/callback | BLOCKED | A pinned NATS 2.10.29 JetStream container, bound loopback API, real TCP callback receiver, real NATS subscriber, discovery-only Go runner, and API-local sole executor pass the automated transport/callback matrix without duplicate jobs. | Repeat off-host with a physical printer, execute all 16 cases, and retain sanitized broker/listener/trace evidence. |
| 8. Automated release/runtime checks | PASS | Real temporary JetStream, bound TCP API/callback, retry/recovery, DLQ negatives, cross-transport idempotency, migration/restart, security, lifecycle, 67-test built-static Playwright coverage, four release-verifier negatives, final installer freshness/hashes, 16 packaged-sidecar checks, and seven actual-Tauri lifecycle checks pass. | External clean-machine, physical, off-host, and upgrade matrices remain separate acceptance gates. |
| Production documentation | PASS | Architecture, runbook, known limitations, code-backed gap table, and verification report exist and distinguish automated evidence from external acceptance. | Add external evidence rows as the pilot machines and printer become available. |
| Final acceptance | BLOCKED | No current report proves a clean workstation install, real printer matrix, cross-machine topology, or upgrade/rollback matrix. | Complete each external matrix and mark blocked cases as PASS only after reproducible packaged evidence is captured. |

## Release-verifier evidence

Run:

```powershell
npm run release:verify
npm run desktop:bundle
```

Expected generated evidence (ignored by Git):

- `artifacts/prod-01/resource-manifest.json`
- `artifacts/prod-01/release-manifest.json`

The post-bundle manifest records the application version, Git commit, build timestamp, resource inventory, installer paths, sizes, and SHA-256 hashes. An installer older than the verified resources fails the gate.
