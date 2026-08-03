# Central Layout Component Standard

This document has two parts. Part A is a binding standard for anyone (human or
agent) writing a page in `apps/web`. Part B is a ready-to-run prompt for a
coding agent to audit and enforce it. Both build on the existing
[`docs/frontend/MOLECULAR_COMPONENT_PLAN.md`](./MOLECULAR_COMPONENT_PLAN.md) —
they do not replace it. This document narrows in on one thing: the page-level
region contract (header / body / detail / footer), which the plan calls
milestone M1.

## Part A — the standard

### The rule

Every top-level page/route component in `apps/web/src/pages/**` (and any
feature workspace a page re-exports, e.g. `features/paper-profiles/`) must be
composed through `PageLayout` (`apps/web/src/components/PageLayout.tsx`),
which delegates to the `PageScaffold` organism
(`apps/web/src/components/organisms/PageScaffold/PageScaffold.tsx`).
`PageScaffold` already defines the canonical anatomy every route must share:

- **header** — `PageHeader` molecule or a custom `header` slot; title,
  description, and page-level actions live here only.
- **body** — the scaffold's `children`; the page's primary task (table, form,
  editor, dashboard).
- **detail** — the `detail` prop, rendered as `<aside>`; secondary/supporting
  information — evidence, metadata rail, verdict, related record — that is
  not the primary task.
- **footer** — the `footer` prop, rendered as `<footer>`; page-level action
  bar or summary that must stay pinned below body/detail.

No page may render its own raw `<header>`, `<footer>`, or page-level
`<aside>` outside these slots. No page may reimplement a two-pane or
sidebar layout with page-local CSS when the content is really the `detail`
region — use the `detail` prop instead, even if that means giving the prop a
purpose it doesn't have today.

### Why this is the right rule, not just a preference

The four-region anatomy already exists and is already exercised by every
production route. The remaining risk isn't "pages don't use a shared
component" — they do — it's that the *region contract* inside that shared
component can be silently bypassed by building a second layout with raw
markup inside `children`. That defeats the purpose of having a shared
scaffold at all: consistent document order, consistent responsive behavior,
and a single place to fix spacing/landmark bugs for every page at once.

### What "done" looks like

- A page's `.tsx` file contains at most one `<PageLayout>` element wrapping
  everything else.
- Anything that is conceptually a side panel, evidence rail, or secondary
  record is passed via `detail`, not built inline in `children`.
- No new page ships without importing `PageLayout`.
- `PageFooter` / `PageSection` / `PageHeader` molecules are used inside the
  appropriate slot rather than hand-rolled.

## Part B — audit findings as of 2026-08-02

Verified directly against the repository (not assumed from the plan doc):

1. **Adoption at the import level is already near-complete.** All 19
   route-level page components under `apps/web/src/pages/` import
   `PageLayout`, including `PaperProfiles.tsx`, which re-exports
   `features/paper-profiles/PaperProfileWorkspace.tsx` — that workspace also
   composes through `PageLayout`. There is no page currently rendering a raw
   top-level `<header>`/`<footer>` outside the scaffold.
2. **The `detail` region is adopted by no page at all.** *(Corrected — an
   earlier revision of this document read `pages/JobDetail.tsx:690` as
   `PageLayout`'s `detail` prop. That line is `detail={t(verdictCopy.detail)}`
   on the `JobVerdictBand` component, an unrelated prop of the same name. No
   route passes `detail` to `PageLayout` or `PageScaffold`.)* Pages that
   visually have a secondary panel build it inside `children` instead — see
   the decision record in Part D, which resolves each such site.
3. **No automated guard exists.** There is no ESLint rule, lint script, or
   test that fails when a page bypasses `PageLayout` or reintroduces a raw
   landmark element. Adoption today relies entirely on convention.
   *(Resolved — see Part D.)*
4. **M2 molecules already exist** (`Pagination`, `SelectFilter`,
   `SearchField`, `SectionHeading`, `ResourceToolbar`, `PageSection`) but this
   document does not audit their per-page adoption — that remains scoped to
   `MOLECULAR_COMPONENT_PLAN.md`.

## Part C — prompt to hand to a coding agent

Use the block below verbatim as a task prompt (e.g. paste into Claude Code or
another coding agent) to execute and enforce the standard above.

```
You are working in the PrintOps monorepo, app: apps/web (React + TypeScript).

Goal: make the header/body/detail/footer region contract in PageScaffold
(apps/web/src/components/organisms/PageScaffold/PageScaffold.tsx) and its
PageLayout facade (apps/web/src/components/PageLayout.tsx) the single way
every page composes its layout, and make deviations impossible to land
silently in the future.

Read first, in this order:
1. docs/frontend/MOLECULAR_COMPONENT_PLAN.md — overall component migration
   plan and rules (compatibility strategy, file rules, definition of done).
2. docs/frontend/LAYOUT_COMPONENT_STANDARD.md — the specific standard and
   audit findings for the header/body/detail/footer contract.
3. apps/web/src/components/PageLayout.tsx,
   apps/web/src/components/organisms/PageScaffold/PageScaffold.tsx,
   apps/web/src/components/molecules/PageHeader/PageHeader.tsx,
   apps/web/src/components/molecules/PageFooter/PageFooter.tsx.

Then do the following, each as its own small reviewable commit:

Task 1 — Re-verify adoption.
Grep every file under apps/web/src/pages/**/*.tsx and every feature
workspace a page file re-exports (follow re-exports one level) for imports
of PageLayout/PageScaffold. Confirm no route has drifted from the audit
findings in LAYOUT_COMPONENT_STANDARD.md. If any page does not import
PageLayout, migrate it following the "per-page migration loop" in
MOLECULAR_COMPONENT_PLAN.md — do not change its API behavior while moving
it.

Task 2 — Resolve the `detail` slot gap.
For each of these call sites, decide and document (one sentence per site,
in a PR description or code comment) whether the content is a `detail`
region or intentionally part of the body:
  - features/paper-profiles/PaperProfileWorkspace.tsx (`pp-main-layout`
    two-pane form + preview)
  - pages/Templates.tsx (`<aside className="tpl-vars">` variable panel)
  - any other page with a raw `<aside>`, a CSS class implying a sidebar
    (e.g. names containing "panel", "sidebar", "rail"), or a two-column
    grid built with page-local CSS instead of the `detail` prop.
Where the content is genuinely secondary/supporting (not the primary task),
refactor it to use the `detail` prop instead of page-local markup. Where it
is genuinely part of the primary task (e.g. a live preview pane next to the
form being edited), leave it in `children` but add a one-line comment
explaining why it's not a `detail` region, so the next person doesn't
"fix" it incorrectly.

Task 3 — Add an enforcement guard.
Add a lint rule, or a small Node/vitest script run in CI, that fails when:
  - a file under apps/web/src/pages/** (or any file it re-exports as a
    default page export) does not import PageLayout or PageScaffold; or
  - a page-level component renders a raw <header>, <footer>, or top-level
    <aside> JSX element instead of using PageLayout's header/footer/detail
    props.
Keep the rule scoped to page-level files only — it must not fire on
molecules/organisms that legitimately own their own <header>/<footer>
(e.g. PageHeader.tsx, PageFooter.tsx, PageScaffold.tsx themselves, or
components/ui/CardDetail.tsx). Document the rule's intent in a comment at
its definition, referencing docs/frontend/LAYOUT_COMPONENT_STANDARD.md.

Task 4 — Tests.
Extend or add to apps/web/src/components/PageLayout.test.tsx and the
PageScaffold test to cover: header/detail/footer render only when their
slot is provided (already true — confirm), and that the new lint/CI guard
actually fails on a deliberately-broken fixture (add a temporary
counter-example page in the test, not in production code, if the guard is
a script rather than an ESLint rule).

Constraints (from MOLECULAR_COMPONENT_PLAN.md, still binding):
- Do not rename or remove existing PageLayout props; this is a
  compatibility facade.
- No new page-specific selectors in shared CSS.
- No shared component may import a page, route, or API module.
- Verify Thai copy still wraps without overlap after any markup change you
  make (relevant if you touch header/detail regions with localized text).
- Keep each task to its own commit/PR so it stays reviewable; do not bundle
  Task 2's per-page refactors into Task 3's lint rule.

When you finish each task, report: which files changed, what the guard
catches (with a before/after example), and which Task 2 call sites you
moved into `detail` vs. left in `children` and why.
```

## Part D — decision record (2026-08-02)

### Adoption

All 19 route modules reachable from `App.tsx` compose through `PageLayout`.
`pages/PaperProfiles.tsx` is a pure re-export barrel; the workspace behind it
(`features/paper-profiles/PaperProfileWorkspace.tsx`) composes through
`PageLayout`. `pages/TemplateRowMenu.tsx` lives under `pages/` but is a helper
component, not a route, and is out of scope. No page needed migrating.

### `detail` slot decisions

Every side-panel-shaped region was reviewed. **All of them stayed in
`children`**, and each now carries a comment recording why, so the next reader
does not "fix" it incorrectly:

| Call site | Verdict | Why |
| --- | --- | --- |
| `features/paper-profiles/PaperProfileWorkspace.tsx` (`pp-main-layout`) | body | Form and canvas edit the same profile; both are primary work. |
| `features/paper-profiles/components/PreviewPanel.tsx` (`pp-preview-panel`) | body | The canvas is the surface the operator drags/nudges fields on, not evidence about them. |
| `pages/Templates.tsx` (`tpl-vars`) | body | Token buttons insert at the caret of the textarea beside them; adjacency is the feature. |
| `pages/Webhooks.tsx` (`wh-sidebar`) | body | Belongs to the endpoint editor card and only exists while it is open; `detail` is page-level and would also sit beside the endpoint table. |
| `pages/JobDetail.tsx` (`job-technical` forensics) | body | Collapsed-by-default below the verdict is the deliberate tiering; a side rail puts forensics back in competition with the verdict. |

Two of these rendered a raw `<aside>` (`tpl-vars`, `pp-preview-panel`). Both are
now plain `<div>`s: the content stays exactly where it was, but a route's only
complementary landmark is once again the scaffold's `detail` slot. The
`<header>`/`<aside>` inside `FullPreviewDialog.tsx` are dialog internals, not
page regions, and were left alone.

The `detail` slot therefore has **no production consumer today**. That is
recorded rather than papered over — inventing a consumer to satisfy the slot
would be worse than an honestly unused one. M3 (`EvidencePanel`) is where a
real consumer is expected to arrive.

### Guard

`apps/web/src/__tests__/layoutContract.test.ts` runs in `npm test -w apps/web`.
It reads route modules from `App.tsx`'s `lazy(() => import('./pages/…'))`
declarations (not a glob over `pages/`, which would flag helpers like
`TemplateRowMenu.tsx`), follows one `export { default } from` hop, and fails
when a route module either does not import *and* render `PageLayout`/
`PageScaffold`, or renders a raw `<header>`, `<footer>`, or `<aside>`.
Comments are stripped first, so prose about landmarks does not trip it. Shared
components that legitimately own a landmark — `PageHeader`, `PageFooter`,
`PageScaffold`, `ui/surfaces.tsx`, `ui/Drawer.tsx` — are outside its scope.

Example failure, from adding `<aside className="drift">side</aside>` to
`Dashboard.tsx`:

```text
pages/Dashboard.tsx: renders a raw <aside> — pass it through PageLayout's
header/detail/footer slot instead
```

The guard cannot see a landmark rendered by a nested component. That limit is
accepted and documented at the rule's definition: it makes the common case
impossible to land by accident, and review covers the rest.
