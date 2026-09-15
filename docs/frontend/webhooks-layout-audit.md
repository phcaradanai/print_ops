# Webhooks page: layout/region conformance to the standard

Scope, per user decision: bring `apps/web/src/pages/Webhooks.tsx`'s layout
into line with [`docs/frontend/LAYOUT_COMPONENT_STANDARD.md`](../frontend/LAYOUT_COMPONENT_STANDARD.md)
— not visual redesign, not the toast/message consolidation (tracked
separately as FE-02 in `docs/audits/frontend-baseline-audit.md`), not
mobile. Verified against code 2026-08-02.

## Part A — findings

### Finding 1 — the page header reimplements PageHeader with raw markup, unlike every other page

`Webhooks.tsx:710-750` passes a custom `header` to `PageLayout`:

```tsx
<PageLayout className="wh-container" width="full" header={
  <div className="wh-header">
    <div className="wh-header-title-area">
      <div className="wh-header-text">
        <h1>{t('page.webhooks.title')}</h1>
        <p>{t('page.webhooks.subtitle')}</p>
        <Freshness ... />
      </div>
    </div>
    <Toolbar label={...} align="end" className="wh-header-actions">
      {/* export, import, search, create */}
    </Toolbar>
  </div>
}>
```

Two problems, not one:

1. **Raw `<h1>`/`<p>` instead of the shared typography atoms.** Every other
   page's title goes through `PageHeader`'s `Heading level={1} size="page"`
   and `Text tone="muted"` (`PageHeader.tsx:42-51`), which carry the
   `ui-page-header__title` / `ui-page-header__description` classes. A raw
   `<h1>`/`<p>` gets none of that — Webhooks' title is visually whatever the
   browser default plus `.wh-header-text` gives it, not what every other
   route's title looks like. If "the Webhooks page looks off compared to
   the rest of the app" is the complaint behind this request, this is
   almost certainly why.
2. **The custom header exists for no reason that holds up.** Grep
   `<Freshness` across `pages/`: fourteen other pages
   (AuditLogs, LocalDiagnostics, JobDetail, PrinterDetail, Runners,
   PrintFlowBindings, UsersRoles, JobQueue, RoutePolicies, PrinterBindings,
   DiscoveredPrinters, Dashboard, Printers, Settings) all put `<Freshness
   .../>` straight into `PageLayout`'s `actions` prop —
   `actions={<Freshness ... />}` — and get the standard header for free.
   Nothing about Freshness requires a custom header; Webhooks is the only
   page (besides `Templates`, which has its own different `page-header` div
   and is out of scope here) that didn't use the pattern already proven
   fourteen times over.

The fix is mechanical: move `title`/`description` to `PageLayout`'s own
props, and move `Freshness` + the export/import/search/create `Toolbar`
into `actions`, deleting the `wh-header` / `wh-header-title-area` /
`wh-header-text` wrapper divs and their CSS.

### Finding 2 — three different hand-rolled section-heading patterns for the same job, in one file

The page body (`children`, since `detail` is unused — see Finding 3) has
three `<Card>` sections, each with its own bespoke title treatment, even
though `SectionHeading` (`title` + `description` + `actions`,
`components/molecules/SectionHeading/`) is already imported and used
*inside* Card 1 for a sub-heading (`Webhooks.tsx:837`,
`<SectionHeading level={3} title={t('page.webhooks.basicInfo')} />`):

| Card | Line | Current markup | What it needs |
|---|---|---|---|
| 1 — endpoint editor | `824-831` | `<div className="wh-card-title"><span>{title}</span>{cancel button}</div>` | `title` + `actions={cancelButton}` |
| 2 — endpoints table | `1075-1094` | `<div className="wh-table-header"><Inline><Heading level={2}>{title}</Heading><TabList>...</TabList></Inline><Toolbar>...</Toolbar></div>` | `title` + filter tabs and toolbar both fit `actions`, or `actions` plus a second row if `SectionHeading` can't hold both — check before forcing it |
| 3 — callback log | `1282-1294` | identical `wh-table-header` structure again: `<Inline><Heading level={2}>{title}</Heading><Checkbox/></Inline><IconButton/>` | `title` + `actions={checkbox + refresh button}` |

Card 2 and Card 3 use the *exact same* bespoke structure twice — the
clearest signal in this file that a shared component is missing, not that
two different needs exist. `SectionHeading`'s `actions` slot already wraps
below the copy on narrow widths (`SectionHeading.tsx:17`), which the
current `wh-table-header` CSS may or may not do — check
`.wh-table-header`/`.wh-table-controls` in `styles.css` for the current
narrow-width behavior before assuming `SectionHeading` is a drop-in, and
note any responsive behavior it doesn't yet cover as a gap in
`SectionHeading` itself rather than working around it in Webhooks again.

### Finding 3 — the `detail` region is legitimately unused here (not a bug to fix)

`docs/frontend/LAYOUT_COMPONENT_STANDARD.md` asks every page to make a
deliberate, documented call on whether page content belongs in `detail` or
`children`. For Webhooks: all three sections (editor, endpoint list,
callback log) are full-width, primary-task content — none is a narrow
secondary/evidence rail alongside a primary task the way `JobDetail`'s
`detail` verdict panel is. Forcing the callback log into `detail` (which
`PageScaffold` renders as `<aside>`, styled for a narrower supporting
column) would be wrong for content that's a wide multi-column table.
**Conclusion: leave `detail` unused, and add a one-line comment at the
`PageLayout` call site saying so** (matching the existing comment style
already in this file at the `wh-sidebar` block, `Webhooks.tsx:1051` area,
which already documents why *that* panel isn't `detail` either) — this
satisfies the standard's requirement to record the decision rather than
leave it looking like an oversight.

### Not in scope, noted only so it isn't accidentally pulled in

- `Templates.tsx:890-892` has a similar but different bespoke
  `<div className="page-header">` wrapper around its own `<Freshness>` —
  same root pattern, different page, different CSS class. Worth the same
  fix later, but don't touch it in this pass; keep the diff reviewable.
- The toast/message system (`showToast`, `Alert` usage) is already
  substantially fixed on this page (`Webhooks.tsx:760-771` shows it now
  renders through the shared `Alert` component, not a hand-rolled div) —
  don't rework it here; that's the separate FE-02 item if it still needs
  finishing.

## Part B — prompt to hand to a coding agent

```
You are working in the PrintOps monorepo (apps/web, React + TypeScript).
Bring the Webhooks page's layout into conformance with
docs/frontend/LAYOUT_COMPONENT_STANDARD.md — no visual redesign, no
behavior change, no touching the toast/message system or the payload
template editor (both already handled separately).

Read first:
- docs/frontend/webhooks-layout-audit.md (this file).
- docs/frontend/LAYOUT_COMPONENT_STANDARD.md — the governing standard.
- apps/web/src/components/molecules/PageHeader/PageHeader.tsx and
  apps/web/src/components/molecules/SectionHeading/SectionHeading.tsx —
  the two molecules this work consolidates onto.
- Three or four OTHER pages that already put Freshness in PageLayout's
  actions prop correctly — e.g. apps/web/src/pages/JobQueue.tsx (~line
  305) or apps/web/src/pages/PrinterDetail.tsx (~line 116) — as the
  pattern to match exactly, not reinvent.
- apps/web/src/pages/Webhooks.tsx in full — it's 1470+ lines; at minimum
  read lines 700-1100 and 1270-1300 (the three Card sections) plus
  wherever `wh-header`, `wh-card-title`, `wh-table-header` classes are
  used, and search styles.css for the same class names to see what visual
  rules you're responsible for preserving or removing.

Task 1 — Convert the custom PageLayout header to standard props.
Replace the `header={<div className="wh-header">...}` block
(Webhooks.tsx:710-750) with `title={t('page.webhooks.title')}`,
`description={t('page.webhooks.subtitle')}`, and
`actions={<>...</>}` containing, in order: `<Freshness ... />` (same props
as today), then the existing `Toolbar` with export/import/search/create —
match how JobQueue.tsx or PrinterDetail.tsx compose `actions` when there's
more than one control group inside it. Delete `wh-header`,
`wh-header-title-area`, `wh-header-text`, `wh-header-actions` from
styles.css ONLY after confirming (grep) nothing else in the codebase still
references them. Do not change what the header actually contains or does
— title text, subtitle text, Freshness props, and every button/input in
the toolbar stay pixel-for-pixel the same controls with the same handlers,
just no longer wrapped in bespoke markup.

Task 2 — Consolidate the three Card section headers onto SectionHeading.
For each of Card 1 (`wh-card-title`, ~line 824), Card 2 (`wh-table-header`,
~line 1075) and Card 3 (`wh-table-header`, ~line 1282), replace the
bespoke wrapper with `<SectionHeading title={...} actions={...} />`,
preserving every control currently inside (Card 1's cancel-edit button;
Card 2's filter TabList and search/toolbar; Card 3's "failed only"
checkbox and refresh IconButton). Before assuming `actions` can hold
everything Card 2 currently splits across two rows (the `Inline` with
title+tabs, and a separate `Toolbar`), check whether `SectionHeading`
renders on one line or wraps — if fitting both groups into one `actions`
slot changes the visual layout in a way `SectionHeading`'s existing
wrapping behavior doesn't already handle correctly at narrow widths, either
compose two elements inside one `actions` node (a wrapping flex container)
or flag it as a `SectionHeading` capability gap instead of hacking around
it in Webhooks a second time — the whole point of this task is to stop
doing that. Remove `wh-card-title` and `wh-table-header` from styles.css
once both call sites are converted and nothing else references them
(`wh-table-controls` and `wh-shared-search` may still be needed inside the
toolbar — check before removing).

Task 3 — Document the `detail` decision instead of leaving it silent.
Add a one-line comment at the `PageLayout` call site (near where the
`wh-sidebar` block already explains why that panel isn't `detail`,
Webhooks.tsx:1051 area) stating that the three body sections are all
full-width primary content, so `detail` is deliberately unused on this
page — matching the existing comment style, so a future reader finds the
reasoning in the same place both times.

Task 4 — Verify, don't just compile.
- Render the page (dev server or existing component test infra) and
  confirm the title/description/actions look the same as before pixel-wise
  — this is a structural refactor, the visual result should be unchanged
  except wherever raw `<h1>`/`<p>` vs `Heading`/`Text` produced a real
  (probably minor) style difference; note any such difference you find
  rather than silently "fixing" it as a drive-by.
- Check EN and TH copy still fits without wrapping oddly in the new
  `actions` layout — Thai strings run longer than English for the same
  meaning.
- Check keyboard tab order through the header and each section heading's
  actions is unchanged.
- Run any existing Webhooks tests (apps/web/src/__tests__/webhooks.test.ts,
  PageLayout.test.tsx) and add a render-structure assertion if one doesn't
  already cover "the page header now goes through title/description/actions
  props" so this doesn't silently regress back to a custom header later.

Constraints:
- No behavior change: every button, input, filter, and toggle keeps its
  exact current handler and props.
- Don't touch the payload template editor (Webhooks.tsx ~line 949-1050) or
  the toast/Alert system (~line 760-771) — both are separately tracked
  work, already done or in progress elsewhere.
- Don't touch Templates.tsx's similar-but-different header pattern — noted
  in Part A as future work, not this change.
- Follow apps/web/src/components/ui/README.md rule 1: start with the
  shared component (PageHeader via PageLayout's props, SectionHeading) —
  don't add a new prop or variant to either molecule unless Task 2's
  wrapping check in fact finds a real capability gap, in which case fix
  the molecule once rather than working around it in Webhooks.

Report back: before/after of the header JSX, whether SectionHeading needed
a capability fix for Card 2's two-group actions or handled it natively,
and the exact CSS classes you removed vs. kept (and why, for anything kept).
```

## Part C — outcome (2026-08-02)

### Tasks 1–3 done

The header now passes `title` / `description` / `actions` and no custom
`header` node. All three Card headings go through `SectionHeading`. The
`detail` decision is recorded in a comment at the `PageLayout` call site.

### `SectionHeading` needed one capability fix

Card 2 puts filter tabs *beside* the title and a toolbar at the far end;
Card 3 has the same shape with a "failed only" checkbox. Putting both
groups into `actions` would have moved the tabs from left-of-title to the
right edge — a visual change, which this pass explicitly excludes. Two
sections having independently hand-rolled the same wrapper is the signal
the audit itself names, so the molecule gained a `scope` slot: content
rendered on the title's own row, for a control that narrows what the
section shows. `actions` still means "at the far end".

### Finding 1, refined

The audit's diagnosis was right but the mechanism was one layer deeper.
`.wh-header h1` *was* in the shared token rule (`styles.css:584` group), so
the claim that the title got "browser default plus `.wh-header-text`" is
not quite it — the problem was that `.wh-header-text h1` (`styles.css:4052`)
had identical specificity and came later, so a page-local block silently
won over the design tokens. The measured deltas, now that the title goes
through `Heading`:

| | Before (`.wh-header-text`) | After (tokens) |
|---|---|---|
| title weight | `700` | `600` (`--font-heading-weight`) |
| title colour | `#0f172a` | `#1e1e2e` (`--neutral-deep`) |
| title line-height | `1.2` | `1.3` (`--font-heading-line-height`) |
| title size | `1.5rem` | `1.5rem` — unchanged |
| description colour | `#64748b` | `#6b7280` (`--neutral-text-muted`) |
| description margin-top | `0.2rem` | `0.35rem` (`--spacing-xs`) |

These are the intended correction, not regressions: every other route
already renders at those values. `Freshness` also moves from under the
subtitle into `actions`, matching the fourteen pages that already did that.

### CSS removed vs kept

Removed (zero remaining consumers, verified by grep across `.tsx`/`.ts`):
`wh-header`, `wh-header-title-area`, `wh-header-text`, `wh-header-actions`,
`wh-card-title`, `wh-table-header` — across `styles.css`,
`experienceSystem.css` and `layoutSystem.css`, including their entries in
shared selector lists and the `@media` blocks. Kept: `wh-container` (the
`PageLayout` className), `wh-table-controls` and `wh-shared-search` (still
used inside the endpoints toolbar), `wh-form-layout`, `wh-sidebar` and the
rest of the body-level classes, which this pass does not touch.

### Noted, deliberately not fixed

- `.wh-container` still sets `background-color: #f8fafc`, a page background
  no other route has. `layoutSystem.css` overrides its padding but not its
  background. This is a plausible part of "the Webhooks page looks off",
  but it is a visual change rather than a region-contract one, so it is
  recorded here rather than folded into this diff.
- `experienceSystem.css` has a `border-radius: 12px` on `.login-panel` /
  `.splash-content` outside the DESIGN.md scale. Pre-existing, unrelated
  file region, left alone.

### Verification

Typecheck, build, and the full web suite (588 tests) pass. `SectionHeading`
gained tests for the `scope` slot's placement and omission;
`webhooks.test.ts` gained a structural guard asserting the page composes
via `title`/`description`/`actions`, passes no custom `header`, and no
longer names any retired class — so a bespoke header cannot quietly return.

**Not verified: the rendered page.** The dev stack came up, but the browser
automation lost its tab group on three consecutive attempts, so the
EN/TH-width and keyboard-tab-order checks the audit asks for were not
performed. Worth doing before merge.
