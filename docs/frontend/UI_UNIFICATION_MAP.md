# UI Unification Map

Audit date: 2026-08-03. Scope: all 19 dashboard routes and the shared component
layer in `apps/web`.

The goal is one coherent product system — Dashboard, Job Queue, Templates,
Paper Profiles, Webhooks, Settings and every other route must read as the same
application. This document records what the audit found, what is already right,
and the ordered slices that close the gap.

---

## 1. What the audit found

### Already unified — do not re-litigate

| Area | Evidence |
|---|---|
| Page skeleton | All 19 routes render through `PageScaffold` (via the `PageLayout` facade) plus `PageHeader` / `PageSection` / `PageFooter`. `Templates.tsx`, `Webhooks.tsx` and `PaperProfiles.tsx` are re-exports of feature workspaces that use the same frame. |
| Interactive primitives | Radix is wrapped, not leaked: `@radix-ui/react-dialog` behind `components/Dialog.tsx`, `@radix-ui/react-dropdown-menu` behind `components/ui/RowActionMenu.tsx`. No page imports Radix directly. |
| Design language of record | `DESIGN.md` + `.impeccable/design.json` define 117 tokens, a route anatomy, and explicit do/don't rules. The system exists; the problem was pages not drawing from it. |
| Anti-pattern detector | Clean. One finding — the 28px graph-paper field behind login/splash — is the single decorative exception `DESIGN.md` sanctions by name, scoped to `.login-screen, .splash-screen`. Not a defect. |

The skeleton was never the problem. **The divergence is in the CSS layer.**

### The actual divergence

`main.tsx` imports **17 global stylesheets in a fixed order**, where later files
correct earlier ones. The rendered result depends on that import order rather
than on component ownership.

| Symptom | Measured |
|---|---|
| CSS total | 31 files, 10,343 lines |
| Stylesheets per feature | paper-profiles **6** (two named `*Hotfix`), templates **3**, webhooks **2** (one named `*.polish`) |
| `!important` declarations | 138, of which 102 sit in the paper-profiles override stack |
| Largest single file | `styles.css`, 5,072 lines |
| Colors bypassing the token system | **465** at audit → **196** after slices 1 and 3, of which 143 are deliberate `var()` fallbacks — so ~53 real ones remain |

`DESIGN.md` already forbids exactly this: *"Don't add another global override
stylesheet to correct a page. Fix the shared component, or scope the fix to the
feature that owns it."* The hotfix/closure/polish layers are that rule being
broken over time.

---

## 2. Library position

| Concern | Standard | Today |
|---|---|---|
| Interactive behavior | Radix primitives | **Installed and correctly wrapped** — dialog, dropdown-menu |
| Styling | UnoCSS + `DESIGN.md` tokens | Installed; token adoption in progress |
| Queue/history tables | TanStack Table | **Not installed** — hand-rolled `DataTable` |
| Large datasets | TanStack Virtual | Not installed; **no measured need yet** |
| Forms | React Hook Form + Zod | **Not installed** — hand-rolled `FormField` |
| Component catalog | Storybook | **Not installed** |

Slices 4–7 therefore *introduce* a dependency rather than migrate one. Each is
its own slice; the brief's rule against migrating multiple high-risk systems in
one change applies directly.

---

## 3. Slices, in order

Each slice: audit usages → define the shared component → migrate → test →
typecheck + web tests + production build → commit.

### Slice 1 — Foundation tokens ✅ done (`ae49170`)

Replaced 250 literal hex colors with the tokens already holding that exact
value. Safety rule: a literal was rewritten only when a token holds *exactly*
that value **and** that token has a single `:root` definition. Contextual
tokens (`--job-verdict-ink`, which varies per verdict) were excluded, and hex
in `var()` fallback position was preserved.

Result: 465 → 215 bypasses. Verified as a visual no-op by construction, plus
635 web tests, typecheck, and a production build.

### Slice 3 — Localized typography + duplicate tints ✅ done (`d9d1b0f`, `d44a827`)

Taken before slice 2 because it is low-risk and directly visible.

**Typography.** Ten selectors carrying dictionary copy — table headers, field
labels, status/type badges, section and panel headings — were uppercased and
letter-spaced. Thai has no letter case, so uppercase only transformed the
English half and the two locales stopped reading as the same layout; tracking
pushed Thai combining marks off their base consonant. Both are named in
`DESIGN.md`'s don't-list. Brand wordmarks and the explicit `.ui-text--caps`
opt-in keep theirs.

Removing the tracking also retired real override debt: `.status-badge` held two
different values in two files (0.025em / 0.04em, import order deciding), and
`experienceSystem.css` already corrected `.ui-data-head` back to `0`, making the
`ui.css` declaration dead.

**Tints.** 23 literals converged onto shared tokens — most visibly the
selected-row state, which used three different pale blues across three feature
stylesheets for one meaning, now all `--state-info-surface`.

A guard (`__tests__/localizedTypography.test.ts`) walks every stylesheet and
fails on either violation outside the allowlist; it was verified against an
injected regression, not just a green run.

Deliberately untouched: job-status and device colors, which `DESIGN.md` keeps on
separate axes and which need their own decision (see slice 3c).

### Slice 3c — Status and device colors (open)

Success is drawn as `#2f732a` on job rows while `--device-ok` is `#2d6a2d` and
`--job-verdict-ink` carries `#166534`; failure is `#ba3253` against
`--danger-action` `#9f1239`; warning text spans `#9a3412`, `#854d0e` and
`--state-warning-text` `#92400e`. These are three axes bleeding into each other.
Resolving it means deciding which axis owns each surface first — a design
decision, not a mechanical replace.

### Slice 2 — Retire the override stack (next, highest impact)

Collapse the 6 paper-profile / 3 templates / 2 webhooks stylesheets into the
feature that owns them, and delete the `*Hotfix`, `*Closure`, `*Completion` and
`*.polish` layers by fixing the shared component instead.

- Remove the cascade-order dependency in `main.tsx`.
- Retire the 102 `!important` declarations in the paper-profile stack.
- Acceptance: no global stylesheet outside the design system; `!important`
  count in feature CSS is zero; Playwright layout-regression specs
  (`paper-profile-layout-regression`, `webhooks-final-visual`) still pass.

Risk: **high** — this is where visual regressions live. Needs before/after
screenshots per affected route, not just green tests.

### Slice 3 — Judgement colors

The ~72 remaining literals with no exact token (`#1553d1`, `#eef4ff`, `#93b4fb`,
…). Each is a decision: adopt an existing token, derive with `color-mix()` per
`DESIGN.md`, or promote to a new named token. Not mechanical — do it with the
palette open.

### Slice 4 — Tables → TanStack Table

Job Queue and Audit Logs first; they carry sorting, filtering and pagination
that is currently re-implemented per page. Keep `DataTable`'s visual contract
and public props; swap the internals. TanStack Virtual only after measuring a
real row-count problem — the operator queue is a working set, not a data lake.

### Slice 5 — Forms → React Hook Form + Zod

Highest-value targets: Paper Profile editor, Webhook endpoint form, Settings.
Zod schemas should mirror the server-side validation added in I-1 so a field is
rejected the same way on both sides.

### Slice 6 — Feedback and status states

`PageState`, `Alert`, `StatusBadge`, `JobVerdict`, empty/loading/error/disabled.
Mostly consolidation; the vocabulary is already correct (`uiVocabulary.test.tsx`
guards it).

### Slice 7 — Storybook

One story per shared component plus its important states. Do this *after*
slices 2–6 so stories document the settled API rather than a moving one.

### Slice 8 — Cross-page consistency pass

Route-by-route screenshots in EN and TH, desktop and mobile, against the
checklist in `DESIGN.md`.

---

## 4. Rules that hold for every slice

- Pages import PrintOps components, never Radix or TanStack directly.
- Open-source libraries supply behavior and state; PrintOps owns appearance,
  tokens, copy, spacing and responsive behavior.
- No second design system, and no new global override stylesheet.
- Preserve API contracts, routes, permissions, workflows and printing behavior.
- EN and TH stay equal citizens; layouts hold at both string lengths.
- Every slice ends green on typecheck, web tests, and a production build.
