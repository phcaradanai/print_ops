# Current Version Closeout — 2026-09-15

## Verdict

**PASS — current version closed and ready for Web Control.**

The authoritative current-version baseline is:

- Frozen implementation SHA: `c29ce1b1578ff797945ae934847dee66d321bd72`
- Pre-merge `mvp_nippon` head: `753acda7cc90addb3cda7d16a42f140a1487fbaf`
- Integration PR: [#22](https://github.com/phcaradanai/print_ops/pull/22)
- Pre-merge `main` SHA: `b7a92fbec9be0d5d329aa860357bddd0879af45a`
- Final `main` SHA / PR merge commit: `4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51`
- Merge timestamp: `2026-09-15T13:52:58Z`
- Release tag: [`v0.1.28`](https://github.com/phcaradanai/print_ops/releases/tag/v0.1.28)
- PR state: merged normally; PR #22 is closed by merge
- Web Control branch: `feature/web-control`
- Web Control base SHA: `4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51`

`mvp_nippon` remains frozen at the pre-merge release head. The merge tree differs from the frozen implementation only by the two existing closeout/handoff documents; no production feature code was added after `c29ce1b`.

PR #22 was the existing, explicitly scoped Webhooks integration vehicle. It was merged without rewriting historical commits. No Web Control implementation is present.


## Root cause and smallest fix

The original Webhooks verification run failed in the API workspace:

- Failed run: [34937269969](https://github.com/phcaradanai/print_ops/actions/runs/34937269969)
- Failed job: `104277803792`
- Failed test: `src/tests/template-system.test.ts` companion HTML profile assertion
- Cause: the test expected the pre-margin rotated coordinates `left:16mm` / `top:5.5mm`, while the production companion template correctly emitted the page-margin-adjusted `left:18mm` / `top:7.5mm`.

The production implementation was not changed. The only API change updates the stale expected values and documents the margin offset.

The final Webhooks fixes were narrow and behavior-preserving:

1. Scope batch-selection E2E selectors to `.ui-check--bare`, avoiding pointer interception by enabled endpoint switch labels.
2. Allow the responsive editor grid to shrink with `minmax(0, ...)` tracks.
3. Wrap long callback-guide text within its panel on narrow and zoomed layouts.
4. Keep the overflow assertion intact; only its failure context was made more useful.

## Files changed from baseline and why

The implementation changes from the supplied baseline are limited to these tracked files:

- `apps/api/src/tests/template-system.test.ts` — correct the rotated companion-template expectation; no production behavior change.
- `apps/web/e2e/webhooks-redesign.spec.ts` — use the correct endpoint-selection controls and retain the page-overflow contract with clearer diagnostics.
- `apps/web/src/features/webhooks/webhooks.css` — prevent narrow/zoomed editor min-content overflow and wrap long guide text.

The two closeout/handoff Markdown files were added for release evidence and the Web Control boundary. No OTA, printer, queue, NATS, callback-contract, paper-profile production, or desktop updater files changed.

## Verification evidence

### Hosted checks

- [Post-merge Web quality run 34978001348](https://github.com/phcaradanai/print_ops/actions/runs/34978001348), job `104410617761`, head `4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51`: typecheck, web tests, and build succeeded.
- [Post-merge Webhooks verification run 34978001551](https://github.com/phcaradanai/print_ops/actions/runs/34978001551), final retry job `104411529625`, head `4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51`: every workflow step succeeded, including API workspace tests, callback/Webhook API contracts, builds, and browser verification.
- The first attempt of run `34978001551` failed only at `src/tests/sqlite-persistence.test.ts` with `PRINTOPS_DB_LOCKED`; the isolated retry passed without any code or test weakening.
- Earlier pre-merge Webhooks and Web quality evidence remains available in the implementation history; this document records the authoritative post-merge gates.

### Local checks on merged `main`

- Full API workspace: `npm run test -w apps/api -- --reporter=verbose` — `62 passed`, `1 skipped` test file; `504 passed`, `1 skipped` tests.
- Affected callback/API contracts:
  `npm exec -w apps/api -- vitest run src/tests/webhook-callback-api.test.ts src/tests/webhook-callback.test.ts src/tests/webhook-endpoint.repo.test.ts src/tests/callback-delivery.repo.test.ts src/tests/callback-toggle.test.ts src/tests/callback-url-guard.test.ts src/tests/result-callback.test.ts`
  — `7 passed` files, `121 passed` tests.
- Web application build: `npm run build -w @printerops/web` — passed.

### OTA and production invariants

- The merge changed no OTA-related files. The only tracked paths added after `c29ce1b` are the two closeout/handoff Markdown documents.
- Application OTA remains closed under the existing accepted gate:
  - OTA acceptance documentation records implementation commit `5647140aceb286c0579b0c5d3538704bd535d651`.
  - Existing [OTA gate run 34964251184](https://github.com/phcaradanai/print_ops/actions/runs/34964251184) passed the Windows packaged updater and Linux/TypeScript/manifest checks.
  - OTA was not reopened or rerun for this Webhooks-only merge because no OTA implementation changed.
- Printing execution and queue lifecycle, one-runner-per-machine behavior, NATS/JetStream, HTTP intake, callback payload/status, paper-profile geometry/rotation, persisted data compatibility, and updater rollback contracts remain unchanged.

## Independent review

An independent delegated reviewer who did not implement the changes returned **PASS** for the merged release candidate `4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51`.

The reviewer found no candidate-code blockers, confirmed the post-merge Webhooks/Web quality evidence and unchanged OTA/printing scope, and identified only the bounded SQLite technical-debt item plus the requirement to keep `mvp_nippon` frozen.

## Deferred issues and next boundary

- [SQLite race technical debt #25](https://github.com/phcaradanai/print_ops/issues/25): bound the intermittent hosted `PRINTOPS_DB_LOCKED` race in `sqlite-persistence.test.ts`; production impact is currently unproven, and reproduction is required before any locking change.
- No formal branch-protection approval gate was configured for `main`; PR #22 was merged only after the required checks passed.
- Web Control starts from `feature/web-control` at final `main` SHA `4ea6cdd76f19f2f4babdc2a7de0311dd0a6fec51`. The branch currently contains no Web Control implementation.
