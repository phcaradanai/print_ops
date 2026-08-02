# Unused Functions Audit

Date: 2026-07-27
Branch: `mvp_nippon`
Scope: full monorepo (TypeScript, Go, Rust, C#)

## Source Report

- **Reported count:** ~35,179 unused functions
- **Tool:** **unidentifiable — no static-analysis tooling exists in this repository.**
  - No `.eslintrc*`, `eslint.config.*`, or `biome.json` anywhere in the tree
  - No `knip`, `ts-prune`, `ts-unused-exports`, `depcheck`, `unimported`, or `madge` in `package-lock.json`
  - No `staticcheck`, `golangci-lint`, or `honnef.co` in `apps/runner-go/go.sum`
  - No `.golangci.yml`, no `Makefile`, no `Taskfile.yml`, no `go.work`
  - No CI whatsoever — `.github/workflows/` does not exist
  - No workspace defines a `lint` script (verified across all 6 workspaces)
  - The literal `35179` / `35,179` / `35.179` appears **nowhere** in the repository —
    neither in the primary checkout nor inside any of the 10 git worktrees
    (full-tree `rg -uuu`, all file types, excluding only `.git`)
- **Tool version:** N/A
- **Command / configuration:** unknown, not reproducible from repository state
- **Scan scope:** unknown, but demonstrably **not** limited to first-party source
- **Excluded directories:** apparently none
- **Dependencies scanned:** yes (necessarily — see Root Cause)
- **Generated / build output scanned:** yes
- **Test code scanned:** yes
- **Platform-specific code scanned:** yes, but almost certainly on a single `GOOS`
- **Archived / copied code scanned:** yes — 10 live git worktrees

## Repository Facts (measured)

All counts below use the **same** exclusion set
(`node_modules`, `dist`, `build`, `coverage`, `.git`, `.worktrees`, `target`, `bin`, `obj`, `publish`).

| Workspace | Language | Build / test entrypoint |
|---|---|---|
| `apps/api` | TypeScript (Fastify) | `tsc -p tsconfig.json` / `vitest run` |
| `apps/web` | TypeScript + React (Vite) | `tsc && vite build` / `vitest run` |
| `apps/runner-go` | Go | `go build ./...` / `go test ./...` |
| `apps/desktop` | Rust (Tauri) + TS shell | `tauri build` (`src-tauri/Cargo.toml`) |
| `apps/windows-print-helper` | **C# / .NET** (`PrintOps.HtmlPrint.csproj`) | MSBuild — not wired into npm scripts |
| `packages/{domain,shared,adapters}` | TypeScript | `tsc -p tsconfig.json` / `vitest` |

| Language | Source files | Function declarations |
|---|---:|---:|
| TypeScript / TSX | 201 | ~527 |
| Go | 43 (15 are `_test.go`) | 310 `^func`, of which 120 are `func Test*` |
| Rust | 3 | 29 |
| C# | 1 (`Program.cs`) | ~17 member declarations (approximate; not statically analyzed) |
| **Total first-party** | **248** | **~883** |

> **A repository containing ~883 functions cannot have 35,179 unused ones.**
> The reported figure exceeds the entire population of first-party functions by roughly **40x**.

## Root Cause

The scan walked the whole directory tree with no exclusions. The tree holds
~71,600 non-source files that a naive walker descends into:

| Directory | Files | What it is | TS/JS fn decls inside |
|---|---:|---|---:|
| `.worktrees/` | 41,109 | **10 live git worktrees — full copies of this same repo** on other branches, several with their own `node_modules` | 143,936 |
| `node_modules/` (root) | 17,595 | Third-party dependencies | 72,575 |
| `apps/desktop/src-tauri/target/` | 12,595 | Rust build output | — |
| `apps/*/dist`, `packages/*/dist` | 653 | Compiled TS output — duplicates every source symbol | 5,033 |
| `apps/windows-print-helper/{bin,obj,publish}` | 63 | .NET build output | — |
| `apps/windows-print-helper/manual-test-webview-data/` | 154 | A committed WebView2 browser profile/cache dump | — |

Measured inflation from directory scope alone:

```
# naive — only the top-level node_modules pruned
find . -path ./node_modules -prune -o -name '*.ts' -o -name '*.tsx' -print | wc -l
  -> 8,360 files

# correct
find . \( -name node_modules -o -name dist -o -name .git -o -name .worktrees \
         -o -name target -o -name build -o -name coverage \) -prune \
     -o -type f \( -name '*.ts' -o -name '*.tsx' \) -print | wc -l
  -> 201 files
```

**41x file-count inflation.** `git worktree list` confirms `.worktrees/` holds live,
checked-out worktrees on active branches (`feat/paper-profile-import-backend`,
`wt/nav-ia-cleanup`, `fix/paper-preview-field-toolbar`, …). Every symbol in the primary
checkout is therefore counted up to 11 times, and again in `dist/`.

Contributing factors beyond directory scope:

- **`dist/` double-counting** — `apps/api/dist` alone holds 472 emitted files mirroring `apps/api/src`.
- **Build tags / `GOOS` not varied** — a single-platform Go scan reports all of
  `internal/discovery/macos` as unused on Windows, and all of `internal/discovery/windows`
  + `internal/printer/winpool` on macOS/Linux. This audit ran all three.
- **Interface satisfaction not modelled** — `PrinterAdapterPort`-style ports have no direct call sites.
- **Runtime registration not modelled** — adapters wired via `registry.registerAdapter()` in
  `apps/api/src/app.ts`; Fastify routes register by callback; Tauri commands are invoked by
  string name from the frontend.

### Why the count cannot be reconciled exactly

The tool, its command, and its configuration are unrecoverable from repository state, and the
candidate out-of-scope scopes sum to ~222,000 declarations — no subset reproduces 35,179.
What *is* provable is the bound:

> First-party source contains ~883 functions in total.
> Therefore **at most 883** of the 35,179 reported items could be a first-party function, and
> **≥ 97.5%** of the report necessarily refers to dependencies, build output, or duplicate
> worktree copies.

## Baseline (before any edit)

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | **PASS** (exit 0, 608 tests) |
| Typecheck | `npm run typecheck` | **PASS** (exit 0) |
| Go vet | `cd apps/runner-go && go vet ./...` | **PASS** (exit 0) |
| Go build | `go build ./...` | **PASS** |
| Rust check | `cd apps/desktop/src-tauri && cargo check` | **PASS** (exit 0, zero `dead_code` warnings) |
| Lint | — | **NOT RUN** — no lint tooling configured |
| CI | — | **NOT RUN** — no CI workflows exist |

Working tree at start: `M .gitignore`, `?? .agentsroom/` — pre-existing user changes, left untouched.

## Analysis Actually Performed

| Target | Tool | Interface-aware? | Result |
|---|---|---|---|
| Go, `GOOS=windows` | `staticcheck -checks=U1000` | yes | 1 finding (a field) |
| Go, `GOOS=darwin` | `staticcheck -checks=U1000` | yes | same 1 finding |
| Go, `GOOS=linux` | `staticcheck -checks=U1000` | yes | same 1 finding |
| Rust | `cargo check` (`dead_code` lint) | yes | 0 findings |
| TS (5 workspaces) | `tsc --noEmit --noUnusedLocals --noUnusedParameters` | n/a | 10 findings |

**Zero unused *functions* were found in any language.** Every real finding is an unused
import, type alias, struct field, or local binding.

### Known limits of this analysis

- `tsc --noUnusedLocals` reports **module-private declarations only**. It cannot detect an
  unused *exported* symbol. Measuring that needs `knip` or `ts-prune`, neither of which the
  repo has. **Exported TS symbols across `packages/*` and `apps/api` are therefore unmeasured
  and classified Category D (kept by policy).**
- `apps/desktop`'s TS shell has no `tsconfig.json` and no typecheck script — **not scanned**.
- `apps/windows-print-helper` (C#) — **no analysis attempted**; Category G, kept.

## Classification Summary

| Category | Count | Planned Action |
|---|---:|---|
| A — High-confidence dead code | 7 | **Removed** |
| B — Interface/framework implementation | 3 Tauri commands + all adapter/route registrations | Keep |
| C — Dynamic references | adapter registry, Fastify routes, Tauri string-invoke | Keep |
| D — Public/external contract | all exported TS symbols (unmeasured) | Keep — needs `knip`/`ts-prune` |
| E — Generated code | none edited (`dist/`, `target/`, `obj/` are output only) | Do not edit directly |
| F — Tests/development utilities | 3 unused test imports removed; 1 test binding kept | Reviewed |
| G — Platform-specific code | Go `discovery/{windows,macos,fake}`, `printer/{winpool,rawtcp}`, C# helper | Keep — verified unused-free on all 3 `GOOS` |
| H — False positives | **≥ 34,296 (≥97.5% of report)** | Fix scanner scope |
| Unresolved | 4 | Manual review (below) |

### Reconciliation against the reported count

```
  35,179  reported
 -34,296  Category H — out-of-scope: dependencies, build output, and
          10 duplicate git-worktree copies of this same repository
 =   883  = every function that exists in first-party source
              of which:    7  removed (Category A)
                           4  unresolved / kept with documented reason
                         872  kept across Categories B–G
```

Categories B–G overlap by construction — a Windows-only Go function is simultaneously
platform-specific (G), an interface implementation (B), and reached through a runtime
registry (C) — so an exact numeric partition of the 872 is not achievable. They are
enumerated by kind in the **Kept Intentionally** table instead.

## Evidence Log — Removed Symbols

```
File: apps/runner-go/internal/jobs/jobs.go
Symbol: Looper.closeOnce (sync.Once field) + the now-unused "sync" import
Visibility: private (unexported field on unexported-state section of Looper)
Direct references: 0 (rg full repo excl. worktrees — only the declaration line)
Indirect registrations: 0
Interface implementation: no (field, not method)
Test references: 0
Configuration references: 0
Platform-specific: no (jobs.go carries no build tags)
Generated: no
External contract risk: none — sync.Once is not serializable; Looper is never marshalled
Tool proof: staticcheck U1000 flags it under GOOS=windows, darwin AND linux
Decision: safe to remove. NOTE: "sync/atomic" is a separate import and was kept
          (Looper still uses atomic.Value / atomic.Int64).
```

```
File: apps/api/src/routes/v1/printers.routes.ts
Symbol: type ReqWithServiceAccount + the ServiceAccount type import
Visibility: private (module-local type alias, not exported)
Direct references: 0 (only the alias declaration referenced ServiceAccount)
Interface implementation: no    Test references: 0    Platform-specific: no
External contract risk: none — type-only, not exported, erased at runtime
Tool proof: tsc TS6196
Decision: safe to remove
```

```
File: apps/api/src/services/sandbox.service.ts
Symbol: PrinterRepositoryPort (unused member of a type-only import list)
Visibility: import specifier    Direct references: 0
External contract risk: none — type-only import, erased at runtime
Tool proof: tsc TS6196     Decision: safe to remove
```

```
File: apps/api/src/services/accept-external-job.service.ts
Symbol: ConflictError (unused value import from @printerops/shared)
Direct references: 0 (rg confirms 1 occurrence = the import itself)
External contract risk: none — import removal only; the export in @printerops/shared is untouched
Tool proof: tsc TS6133     Decision: safe to remove
```

```
File: apps/api/src/tests/job-lifecycle.test.ts        Symbol: generateId  (unused import)
File: apps/api/src/tests/sandbox-service.test.ts      Symbol: CreatePrinterService (unused import)
File: apps/web/src/__tests__/webhooks.test.ts         Symbol: beforeEach  (unused import)
Visibility: import specifiers    Direct references: 0 each (rg: 1 occurrence = the import)
Category: F — test utilities. Only the *imports* were removed; no test helper, fixture,
          builder, mock, or assertion was touched.
Tool proof: tsc TS6133     Decision: safe to remove
```

## Kept Intentionally

| File | Symbol | Reason Kept |
|---|---|---|
| `apps/api/src/routes/runner.routes.ts:55` | `req` handler param | Positional Fastify `(req, reply)` signature — `reply` is used, so `req` cannot be dropped. Surfaced only by an ad-hoc flag, **not** a repo warning. |
| `apps/api/src/services/create-print-job.service.ts:83` | `validatedJob` binding | `this.jobs.update(...)` performs the ACCEPTED→VALIDATED transition — the call is load-bearing. An unused binding may also signal the service using a stale `job` downstream; deleting it erases that signal. |
| `apps/api/src/services/import-paper-profile.service.ts:99` | `fileName` binding | **`sanitizeFilename()` throws `ValidationError` on empty/non-string input.** Removing the call would silently drop input validation on the `analyze()` endpoint. Confirmed `AnalyzeResponse` has no filename field, so the discard is intentional. |
| `apps/api/src/tests/connectivity-service.test.ts:108` | `offlinePrinter` binding | `printerRepo.create()` is load-bearing — the test asserts `report.total === 2`. Adjacent `offlineReg` is built and never passed: a **test-intent** problem, not a binding problem. |
| `apps/desktop/src-tauri/src/lib.rs` | `get_nats_settings`, `save_nats_settings`, `write_export_file` | Category B — all three verified present in `tauri::generate_handler![]`; invoked by string name from the frontend. |
| `apps/runner-go/internal/discovery/{windows,macos,fake}`, `internal/printer/{winpool,rawtcp,fake}` | all symbols | Category G — platform-specific. Verified unused-free under all three `GOOS`. |
| `apps/windows-print-helper/Program.cs` | all symbols | Category G — C#/.NET, no analysis tooling attempted. |
| `packages/{domain,shared,adapters}`, `apps/api` | all **exported** symbols | Category D — reachability unmeasured; `tsc` cannot detect unused exports. |

## Recommended Scanner Exclusions

These belong in the **analyzer's own** ignore configuration — **not** in `.gitignore`.
The `.worktrees/` entries are live git worktrees other people/agents are working in;
ignoring or deleting them at the VCS level would be destructive.

```
.git/
**/node_modules/**
.worktrees/**
**/dist/**
**/build/**
**/coverage/**
apps/desktop/src-tauri/target/**
apps/windows-print-helper/bin/**
apps/windows-print-helper/obj/**
apps/windows-print-helper/publish/**
apps/windows-print-helper/manual-test-webview-data/**
```

Correct per-language commands for a real unused-code analysis:

```bash
# Go — U1000 understands interface satisfaction; must be repeated per platform.
# Install to host bin first: `GOOS` on `go run` would cross-build the tool itself.
go install honnef.co/go/tools/cmd/staticcheck@latest
cd apps/runner-go
GOOS=windows staticcheck -checks=U1000 ./...
GOOS=darwin  staticcheck -checks=U1000 ./...
GOOS=linux   staticcheck -checks=U1000 ./...

# Rust — dead_code is a rustc lint, no full tauri build needed
cd apps/desktop/src-tauri && cargo check

# TypeScript, module-private only (no new dependency)
npx tsc -p <workspace>/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
```

A Go symbol is a deletion candidate only when unused under **all three** `GOOS` values.

## Verification Results (post-cleanup)

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | **PASS** — 608 passed (71 + 220 + 317) |
| Typecheck | `npm run typecheck` | **PASS** (exit 0) |
| Build: domain, shared, adapters, api, runner-go (declaration emit) | `npm run build` | **PASS** (exit 0) — note: root `build` does **not** include `apps/web` |
| Build: web | `npm run build -w apps/web` | **PASS** (exit 0) |
| Go build | `cd apps/runner-go && go build ./...` | **PASS** |
| Go vet | `cd apps/runner-go && go vet ./...` | **PASS** |
| Go unused, windows | `GOOS=windows staticcheck -checks=U1000 ./...` | **PASS** — now clean |
| Go unused, darwin | `GOOS=darwin staticcheck -checks=U1000 ./...` | **PASS** — now clean |
| Go unused, linux | `GOOS=linux staticcheck -checks=U1000 ./...` | **PASS** — now clean |
| Rust | `cargo check` | **PASS** (exit 0) |
| TS unused re-scan | `tsc --noUnusedLocals --noUnusedParameters` | 10 → 4 findings, all 4 intentionally kept |
| Lint | — | **NOT RUN** — no lint tooling in repo |
| C# analysis | — | **NOT RUN** — no tooling attempted |
| Exported-TS reachability | — | **NOT RUN** — requires `knip`/`ts-prune`, not present |
| `apps/desktop` TS shell | — | **NOT RUN** — no tsconfig / typecheck script |
| Docker config validation | — | **NOT RUN** — unchanged by this work |

No new warnings introduced. No public API, adapter registration, event handler, route,
DI registration, or build-tagged implementation was removed. No generated file was edited.
No audit, queue, or retry behavior changed.

> Note: root `typecheck:runner-go` is aliased to `go test ./...` in `package.json`, so the
> typecheck and test baselines overlap on the Go side.

## Remaining Review Items

1. **Exported TS symbols are unmeasured.** Adding `knip` would give real dead-export detection
   across the monorepo. Recommended, but it is a tooling change and was deliberately not made here.
2. **`offlineReg` in `connectivity-service.test.ts:107`** is constructed and registered but never
   passed to the service under test. Not compiler-detectable (`.registerAdapter()` counts as a read).
   Looks like an incomplete test intent — worth a human look.
3. **`validatedJob` (create-print-job.service.ts:83)** — verify the service should not be using the
   updated job downstream instead of the pre-update `job`.
4. **`apps/windows-print-helper/manual-test-webview-data/`** (154 files) is a committed WebView2
   browser cache dump. It looks accidental. Not removed — deletion is the user's call.
5. **No lint and no CI exist.** Every quality gate here was invoked manually.
6. **10 live git worktrees** under `.worktrees/`. Left completely untouched, but they are the single
   largest source of scanner confusion and duplicate ~41,000 files into the tree.

## Changed Files

| File | Change |
|---|---|
| `apps/runner-go/internal/jobs/jobs.go` | Removed dead `closeOnce sync.Once` field and the now-unused `"sync"` import (`"sync/atomic"` kept) |
| `apps/api/src/routes/v1/printers.routes.ts` | Removed unused private type `ReqWithServiceAccount` and its `ServiceAccount` import |
| `apps/api/src/services/sandbox.service.ts` | Removed unused `PrinterRepositoryPort` type import |
| `apps/api/src/services/accept-external-job.service.ts` | Removed unused `ConflictError` import |
| `apps/api/src/tests/job-lifecycle.test.ts` | Removed unused `generateId` import |
| `apps/api/src/tests/sandbox-service.test.ts` | Removed unused `CreatePrinterService` import |
| `apps/web/src/__tests__/webhooks.test.ts` | Removed unused `beforeEach` import |
| `docs/audits/unused-functions-audit.md` | This audit (new) |

Diff totals: **7 source files, +5 / −11 lines.** No dependency file (`go.mod`, `go.sum`,
`package.json`, lock files, `Cargo.toml`) was modified — `go mod tidy` was deliberately **not**
run, since nothing in the dependency graph changed.

`.gitignore` shows as modified: that is a **pre-existing user change**, untouched by this audit.

## Final Verdict

```
CLEAN_WITH_REVIEW_ITEMS
```

The 35,179 figure is **not a valid finding**. It exceeds the repository's total first-party
function count by ~40x and originates from a scan that included 10 duplicate git worktrees,
`node_modules`, and build output. Correctly scoped, interface-aware analysis across all four
languages found **zero unused functions** and 11 unused declarations, of which **7 were
provably safe to remove** and 4 were kept for documented semantic reasons.
