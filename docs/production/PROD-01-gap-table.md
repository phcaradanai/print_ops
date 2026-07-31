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
| 2. Fail-closed release | PARTIAL | Root `release:verify` validates toolchains, version consistency, forbidden tracked artifacts, complete builds, required resources, freshness, zero-byte files, and writes a SHA-256 resource manifest. `desktop:bundle` adds MSI/NSIS freshness and SHA-256 output. `build-all.js` no longer skips Go or missing resources. | Run `desktop:bundle`, retain its release manifest, add automated negative tests for missing/stale resources, and prove clean installation. |
| 3. Packaged authentication | PARTIAL | First-run OWNER setup uses salted scrypt hashes and single-flight creation; legacy passwordless databases require explicit OWNER-email migration; production fixtures are suppressed; HTTP and NATS intake wait for initialized credentials; service keys are random, one-time, hashed, rotatable, revocable, and audited; packaged CORS is loopback-only; the discovery runner uses a separate CSPRNG installation secret. Focused auth/key tests pass. | Rebuild the packaged resources/installers and capture clean-install, existing-database migration, log-redaction, and first-run UI evidence before marking the packaged gate PASS. |
| 4. Persistence/recovery | PARTIAL | SQLite has an OS-owned exclusive process lock, atomic replace-on-save, versioned transactional schema migration, automatic byte-for-byte pre-migration backup, corruption/newer-schema/read/write stage errors, and audited OWNER snapshot export. Restart tests requeue safe states and convert uncertain dispatch/printing to `UNVERIFIED`; the desktop now supervises and restarts crashed sidecars. | Capture packaged forced-termination, sidecar-crash, read-only/locked/corrupt DB, real prior-installer upgrade, restore, rollback, and uninstall/data-retention evidence. |
| 5. Readiness/support diagnostics | PARTIAL | Authenticated readiness now separates all required local, printer, NATS, and callback components, includes timing/error/action diagnostics, and the Settings UI exposes the same model. An OWNER-only audited support bundle includes bounded logs and operational summaries while tests prove payload, target, URL-credential, bearer, API-key, and password redaction. | Exercise packaged UI output and broker/network late recovery; manually review a real packaged support bundle before marking PASS. |
| 6. Real Windows printing | BLOCKED | Windows spooler, WebView2 helper, discovery, UI workflows, and packaged resources exist. | Execute the complete UI/HTTP/NATS physical workflow and failure matrix with an installed printer; capture job-specific evidence and physical samples. |
| 7. Cross-machine NATS/callback | BLOCKED | NATS intake and HTTP/NATS callback implementations and automated tests exist. | Run real JetStream and callback receiver off-host, execute all 16 cases, and retain sanitized broker/listener/trace evidence. |
| 8. Automated release/runtime checks | PARTIAL | TypeScript, Go, and focused lifecycle tests exist; release resource validation is now executable. | Add bound-port API/callback tests, real temporary NATS, migration/restart, packaged smoke, Playwright, security, no-double-executor, and verifier negative tests; run the full suite. |
| Production documentation | PARTIAL | The code-backed gap table and required architecture document exist. | Create the required runbook, verification report, and known-limitations documents with current evidence. |
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
