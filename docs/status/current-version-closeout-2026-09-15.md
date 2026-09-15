# Current Version Closeout — 2026-09-15

## Verdict

**PASS — candidate closed and ready for Web Control handoff.**

Web Control implementation is not included. The frozen release implementation candidate is:

- Implementation SHA: `c29ce1b1578ff797945ae934847dee66d321bd72`
- Branch: `mvp_nippon`
- Baseline SHA: `f66b36ff57380624f6bb44204ae26100685d6186`
- Integration PR: [#22](https://github.com/phcaradanai/print_ops/pull/22)
- Base branch/SHA: `main` / `b7a92fbec9be0d5d329aa860357bddd0879af45a`
- Implementation PR head: `mvp_nippon` / `c29ce1b1578ff797945ae934847dee66d321bd72`
- PR state: open, ready for review, `MERGEABLE`, `CLEAN`; not merged

The closeout and handoff records are documentation-only commits on top of the implementation candidate. PR #22 is the existing, explicitly scoped Webhooks integration vehicle. Its title/body are unambiguous and its final checks are green, so no duplicate PR was created. The branch comparison is diverged from `main` by one commit (`262` ahead, `1` behind; merge base `d5c7f339a7256d7cf04b6f6ca016c676b13e898d`). Formal GitHub approval and merge remain an integration-governance step; merging was not performed.


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

Only these tracked files differ from the supplied baseline:

- `apps/api/src/tests/template-system.test.ts` — correct the rotated companion-template expectation; no production behavior change.
- `apps/web/e2e/webhooks-redesign.spec.ts` — use the correct endpoint-selection controls and retain the page-overflow contract with clearer diagnostics.
- `apps/web/src/features/webhooks/webhooks.css` — prevent narrow/zoomed editor min-content overflow and wrap long guide text.

No OTA, printer, queue, NATS, callback-contract, paper-profile production, or desktop updater files changed in this closeout.

## Verification evidence

### Hosted checks

- [Web quality push run 34970880004](https://github.com/phcaradanai/print_ops/actions/runs/34970880004), job `104386592818`: typecheck, tests, and build succeeded for the implementation SHA.
- [Webhooks verification push run 34970880208](https://github.com/phcaradanai/print_ops/actions/runs/34970880208), job `104389181179`: all workflow steps succeeded, including the root workspace command, callback API contracts, builds, and browser evidence.
- Browser evidence in that job: `7 passed`.
- [Webhooks verification PR run 34971482306](https://github.com/phcaradanai/print_ops/actions/runs/34971482306), job `104388570635`: success; all steps succeeded and browser evidence was `7 passed`.
- [Final closeout-head Webhooks run 34972866466](https://github.com/phcaradanai/print_ops/actions/runs/34972866466), job `104393166310`, head `06c6e0b2906b9999f988cd286a5d08edb89fdfd3`: every step succeeded; browser evidence was `7 passed`.
- [Final closeout-head Web quality run 34973292594](https://github.com/phcaradanai/print_ops/actions/runs/34973292594), job `104394624183`, head `06c6e0b2906b9999f988cd286a5d08edb89fdfd3`: typecheck, web tests, and build succeeded.

The root workspace command hit the existing SQLite exclusive-lock test race twice during isolated reruns (`PRINTOPS_DB_LOCKED` while the test reinitialised its just-closed temporary DB). The test and production lock code were not weakened or changed. The same hosted workflow passed on the next isolated rerun, including the full root command and browser step.

### Local checks

- Full API workspace: `npm run test -w apps/api -- --reporter=verbose` — `62 passed`, `1 skipped` test file; `504 passed`, `1 skipped` tests.
- Affected callback/API contracts:
  `npm exec -w apps/api -- vitest run src/tests/webhook-callback-api.test.ts src/tests/webhook-callback.test.ts src/tests/webhook-endpoint.repo.test.ts src/tests/callback-delivery.repo.test.ts src/tests/callback-toggle.test.ts src/tests/callback-url-guard.test.ts src/tests/result-callback.test.ts`
  — `7 passed` files, `121 passed` tests.
- Targeted Webhooks browser workflow:
  `npx playwright test apps/web/e2e/webhooks-redesign.spec.ts apps/web/e2e/webhooks-final-visual.spec.ts`
  — `7 passed`.
- Web application build: `npm run build -w @printerops/web` — passed.

### OTA and production invariants

Application OTA remains closed under the existing accepted gate:

- OTA acceptance documentation records implementation commit `5647140aceb286c0579b0c5d3538704bd535d651`.
- Existing [OTA gate run 34964251184](https://github.com/phcaradanai/print_ops/actions/runs/34964251184) at the pre-closeout candidate passed the Windows packaged updater and Linux/TypeScript/manifest checks.
- OTA was not reopened or rerun for this Webhooks-only closeout, per instruction; no OTA files changed.

The printing admission/queue/NATS/callback/paper-profile invariants remain covered by the existing implementation and checks. No Web Control code was added.

## Independent review

A delegated reviewer who did not implement the changes independently returned **PASS** for `c29ce1b1578ff797945ae934847dee66d321bd72`.

The reviewer found no candidate verification blockers. They identified only the expected integration-governance follow-up: formal review/approval and eventual merge of PR #22.

## Deferred issues and next boundary

- Obtain formal GitHub review/approval and merge PR #22; it is ready for review but intentionally not merged by this closeout.
- The SQLite exclusive-lock test showed an intermittent hosted race during reruns. It passed in the successful final run; no test weakening or unrelated remediation was introduced.
- Start Web Control only from the frozen candidate SHA above (or the exact commit after PR #22 is merged). Web Control implementation is intentionally deferred to the next workstream.
