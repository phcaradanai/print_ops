# PrintOps Application OTA - Native Acceptance Review

Date: 2026-09-15
Scope: Application OTA only. Content OTA is out of scope and remains DRAFT.
Review mode: Separate post-implementation evidence review of the committed
code, CI results, job logs, and uploaded native evidence.

## Accepted implementation

- Commit: `5647140aceb286c0579b0c5d3538704bd535d651`
- Workflow: [Application OTA gate run 34930387984](https://github.com/phcaradanai/print_ops/actions/runs/34930387984)
- Dispatch input: `run_native_windows_e2e=true`
- Result: `success`

## Acceptance results

| Area | Result | Evidence |
|---|---|---|
| Native Windows packaging | PASS | Real MSI/NSIS packaging, packaged Tauri supervision, and sidecar checks passed |
| Signed A -> B update | PASS | Real NSIS A `0.1.27` / schema `6` updated to B `0.1.28` / schema `7` |
| Broken-B rollback | PASS | A was restored and persisted state was `ROLLED_BACK` after readiness failure |
| Schema rollback | PASS | The native scenario exercised the real `6 -> 7` schema transition and rollback path |
| Security and provenance | PASS | SHA-256 bytes and Ed25519 artifact/manifest signatures verified; private key was not persisted |
| Print safety | PASS | Queue-idle/readiness, update policy, API/domain, runner, and failure-matrix checks passed |
| Normal OTA CI | PASS | Linux TypeScript, domain/API, updater, runner, release verifier, and Docker matrix passed |
| Worktree provenance | PASS | Tracked worktree was clean after only the explicit generated-Tauri normalization allowlist |

Uploaded native evidence: [artifact 10382250569](https://github.com/phcaradanai/print_ops/actions/runs/34930387984/artifacts/10382250569)
Artifact ZIP SHA-256: `08ea81a3a14df0432f17219f388edc7911b3aca6683b172c8069931825c57fee`

Provenance details from the uploaded `provenance.json`:

- Public-key SHA-256: `a636ea3285bc388c275efc8579f927d465c890ad6c6072daf70002d2e5bf481e`
- A NSIS SHA-256: `2f107e7bacef41176257e7f0217caac488440a7dc9e8e5f41180ec3e9df33931`
- B NSIS SHA-256: `d815856d28f5ea3a1324a7f1188c1ea305d43b6971f1008467f35ca4da313516`
- Broken-B NSIS SHA-256: `0add6c6df873f120c70dbcbb4e6f55a841fd539d4c11f5d3bfb2ba1f02b060a7`

## Review verdict

All Application OTA acceptance gates are satisfied by the accepted commit and
successful workflow run. No Content OTA approval is implied.

**PASS — APPLICATION OTA COMPLETE**
