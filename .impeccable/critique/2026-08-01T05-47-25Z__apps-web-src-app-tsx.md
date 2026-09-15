---
target: apps/web in-flight redesign (App shell, Dashboard, Job Queue, Job Detail, Printers, Printer Detail, Printer Bindings, Template Sandbox)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-08-01T05-47-25Z
slug: apps-web-src-app-tsx
---
Method: dual-agent (A: a3b87e913fb56eb1c design review · B: a3a2a057e9ac82500 detector + browser evidence). Both isolated and parallel against a live stack on localhost:3100 — seeded API, online fake runner, real jobs in SUCCESS / FAILED / QUEUED / DUPLICATE_RETURNED. Desktop 1440x900 and mobile 390x844, Thai and English.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `Freshness` is excellent; undone by Dashboard printing authoritative `0 queued / 0 unverified / 0 failed` next to a partial-failure banner. A failed fetch is indistinguishable from real zeros. |
| 2 | Match System / Real World | 3 | Verdict headlines are the best copy in the product; same screens still show `RUNNER_FAILED`, `LATENCY (MS)`, `PAPERPROFILEID`. |
| 3 | User Control and Freedom | 2 | No back link anywhere, no breadcrumbs. Printers table has zero links — Printer Detail unreachable from the page listing printers. No undo on batch reprint. |
| 4 | Consistency and Standards | 2 | Two badge systems, two table styles, two primary-button colors (#1e1e2e vs #1e66f5), two icon systems (SVG vs emoji), two date formats for the same timestamp in one viewport. |
| 5 | Error Prevention | 3 | Single-job reprint gate is strong; batch reprint bypasses all of it. |
| 6 | Recognition Rather Than Recall | 2 | Nothing explains UNVERIFIED except the detail page you must already be on. Unlabeled UUID fragments in Bindings "Paper" column. |
| 7 | Flexibility and Efficiency | 2 | Zero keyboard shortcuts. No skip link — 8 tabs through nav on every page. Batch action bar not sticky, renders below fold. |
| 8 | Aesthetic and Minimalist Design | 2 | Job Detail tiering is disciplined. Dashboard fires 9 equal-weight tiles; Sandbox has duplicated heading and leaked `<strong>` markup. |
| 9 | Error Recovery | 3 | `traceResource` distinguishing "no trace recorded" from "trace could not be loaded" is rare and correct. Operator-facing text is still developer text. |
| 10 | Help and Documentation | 3 | `lib/jobErrorAdvice.ts` is excellent, but the catch-all never returns null, so RUNNER_FAILED yields generic advice indistinguishable from real advice. |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**Partly authored, and the authored part is first-rate — but it stops at one component.**

`lib/jobVerdict.ts` + `JobVerdict.tsx` + `statusColors.ts` are the real thing: three-way mark vocabulary (check / question / cross — deliberately not a warning triangle, because UNVERIFIED is unknown not broken); a `ReprintStance` type grading reprinting `routine | caution | redundant | none`; `reprintButtonVariant()` returning danger exactly when the outcome is unknown; `statusColors.ts` measuring all eleven backgrounds against white, documenting failing ratios inline, overriding DESIGN.md, and moving UNVERIFIED off FAILED's hue family for a semantic reason.

Everything outside Job Detail is category-interchangeable, and three surfaces are worse:
- **Job Queue** — standard fixed table. `LATENCY (MS)` is SRE language on a ward screen. `Re-print` renders identically on all six rows including four SUCCESS rows; the queue knows nothing about `ReprintStance`.
- **Printer Bindings** — labels are raw DB field names uppercased by CSS (`PRINTERCODE`, `TEMPLATECODE`, `PAPERPROFILEID`), untranslated in both locales. Saturated #1e66f5 Bind button breaks the One Accent Rule and the Deep Navy primary spec. Bindings can be created but never removed.
- **Template Sandbox** — visibly broken. `⚙️ Print Options` rendered twice consecutively (TemplateSandbox.tsx:399 hardcoded English + emoji, :401 the translated one). Literal `<strong>Render Preview</strong>` leaking as text. Tofu glyph. Priority as emoji circles.

**Deterministic scan**: `detect.mjs --json apps/web/src` → `[]`, exit 0. Assessment B proved the detector functional (a probe file produced 13 findings across 5 rules), so the clean result is real but misleading by scope — rules fire on markup literals, and nearly all styling lives in styles.css. B's static analysis of that file found:
- 112 distinct off-palette hex values in 407 occurrences; a whole Tailwind slate/blue ramp (#0f172a→#f8fafc) alongside the declared Catppuccin palette. Worst: #9f1239 x22, #2563eb x19, #991b1b x18, #fee2e2 x16.
- All 11 new outlined-badge colors in statusColors.ts:64-74 are off-palette; only #374151 is sanctioned. The redesign fixed contrast by introducing a second undocumented color system.
- 12 border-radius declarations above the 8px ceiling (999px, 9999px, 24px, 20px, 12px x4, 10px x5).
- Clean on three counts: zero web fonts, zero gradient backgrounds, zero transitions over 200ms.

**No visual overlay was produced.** Assessment B worked through CDP and page-local JS rather than the live-server injection path, so there is no highlighted page to view; all findings are reported from measurements.

DESIGN.md has gone stale: it specifies white-on-semantic badges (code correctly overrides and documents why), a mobile top bar with 2-column grid (code ships a full-width slide-in drawer), 0.75rem badge type (ships at 10.4px). The visual world of record no longer describes the product.

## Overall Impression

One brilliant component in a competent-but-anonymous admin shell, with two pages untouched by the redesign and one that reads as unowned. The thinking in jobVerdict.ts is better than most shipped design systems — and it has not propagated ten pixels past the component that houses it. Biggest opportunity: push `ReprintStance` outward. It already grades every status; the queue and batch action ignore it, which is why the riskiest action has less safety scaffolding than the safest one.

## What's Working

1. **lib/jobVerdict.ts encodes consequence, not presentation.** Collapses ten statuses into three realities plus one question, then drives button variant from stance. The comment explaining why TIMEOUT and UNVERIFIED share a stance but not a wording ("nothing came back at all" vs "something came back but confirmed nothing") is specificity that only comes from understanding the job.
2. **statusColors.ts shows its work.** Browser-verified: SUCCESS renders #166534 on white at 9.61:1, FAILED #9f1239 at 9.48:1. The white-on-pastel contrast problem is genuinely solved and the source comments match what paints.
3. **PageState / Freshness treat staleness as first-class.** JobDetail.tsx:852-861 distinguishes "no trace recorded" (fact about the job) from "trace could not be loaded" (fact about the network).

## Priority Issues

### [P0] Vite proxy regex breaks every API call with a query string — Job Queue loads nothing, Dashboard reports 0 failed
**What:** apps/web/vite.config.ts:19 — `'^/(auth|health|me|jobs|printers|runners|commands|audit-logs)(/|$)'`. Vite matches req.url including the query string, so `(/|$)` matches the SPA route and misses the API call. Verified: `GET /jobs?limit=5` → 200 text/html; `GET /jobs` → 200 application/json. Both assessments hit it independently and had to shim fetch.
**Why it matters:** An operator refreshing /jobs gets a JSON blob. Worse is the design defect underneath: a stat tile whose source errored renders `0`, not `—`. "0 failed" while the fetch failed is exactly what PRODUCT.md calls failure. A zero is a claim.
**Fix:** (a) Change the proxy key to `(/|\?|$)` and give API calls a distinct prefix — the collision exists in production too, where the API serves both. (b) Independently: every stat tile whose source failed must render `—` plus the error state, never `0`.
**Suggested command:** /impeccable harden

### [P0] Batch reprint is English-only and bypasses the entire safety model
**What:** JobQueue.tsx hardcodes 'jobs selected' (:396), `Batch Reprint (n)` (:408), `Clear Selection` (:415), `Confirm Batch Reprint` (:557), `Batch reprint completed: X succeeded, Y failed.` (:222) — none through t(). The dialog lists no job IDs, statuses or printers. It never consults offersReprint(), so a DUPLICATE_RETURNED job (jobVerdict.ts:73: "never right") can be batch-reprinted. `reason: reason || 'Batch queue reprint'` silently defaults a required field.
**Why it matters:** The highest-risk action — duplicating N physical clinical labels at once — is English-only in a Thai hospital and has less scaffolding than the single-job path. Product Principle 5.
**Fix:** Route every string through t(). Gate selection and the batch button through offersReprint(getJobVerdict(status)). Render the confirm dialog as a list of selected jobs with status badge, printer and copies per row, caution-stance jobs called out separately. Replace the terminal toast with a per-job result list linking to created jobs.
**Suggested command:** /impeccable harden

### [P1] The SUCCESS verdict claims device confirmation it does not have, and UNVERIFIED looks identical to it
**What:** (a) "Printed — the printer confirmed this page came out" renders above a Printer Evidence panel where all seven fields are `—` and IPP jobs = 0. (b) `.job-verdict` (styles.css:6514) applies tone only to the 40px mark disc's color; card background, border, radius and shadow are byte-identical across confirmed, caution and negative.
**Why it matters:** (a) violates Product Principle 1 directly; the first time an operator catches a "confirmed" label that never came out, the product's best component loses authority permanently. (b) the UNVERIFIED distinction is carried by a small ring and a word — at a metre under fluorescent light it is the same white bar as SUCCESS.
**Fix:** (a) Make the SUCCESS sentence conditional on evidence; without deviceConfirmed/ippJobConfirmed say "reported complete — no device confirmation recorded", and ask whether that job is honestly SUCCESS. (b) Tone-tinted 4-6px left rail plus background wash for caution and negative — a background-color shift is the hierarchy mechanism DESIGN.md's flat-by-default rule prescribes.
**Suggested command:** /impeccable clarify then /impeccable bolder (scoped to the verdict band)

### [P1] The Job Queue table is mechanically broken at full desktop width
**What:** (1) styles.css:5330 sets `display: flex` on a `<td>` (.status-cell). The cell computes to 41.4px inside a 114px row: badge aligns with nothing, row checkbox sits ~35px below its badge, selected rows show a white rectangle artifact in the blue tint, and the cell leaves the table's row/column model for assistive tech. (2) At 1440px English, OFFICE_LASER_01 breaks as OFFICE_LASER_0 / 1 and LAB_LABEL_DEFAULT as LAB_LABEL_DEFA / ULT while COPIES and SOURCE each hold ~150px of dead space — table-layout: fixed plus over-broad overflow-wrap: anywhere. (3) At 390px it degrades to four-line stacks and the SUCCESS badge overprints the document link.
**Why it matters:** LAB_LABEL_01 vs LAB_LABEL_02 is two physical devices on two wards. Breaking a printer name after the 0 fails the identifier that decides which machine an operator walks to.
**Fix:** Move flex to an inner wrapper (.status-cell { vertical-align: middle }, .status-cell > span { display: inline-flex }). Give PRINTER and DOCUMENT proportional widths taken from COPIES/SOURCE/CREATED. Scope overflow-wrap: anywhere to genuinely unbounded values; identifier cells get normal + ellipsis with the existing hover popover. Replace the mobile table with a card list — 620px inside a 366px wrapper is not a mobile design.
**Suggested command:** /impeccable layout then /impeccable adapt

### [P1] Accessibility cluster: three measured AA failures the detector cannot see
**What:** (1) Table column headers fail AA everywhere: th computes #6b7280 on #f0f0f0 = 4.24:1 at 10.88px. Both values are sanctioned DESIGN.md tokens — the palette itself pairs to a failure. (2) The off-canvas drawer stays focusable while closed: at 390px, visibility: visible, no aria-hidden, no inert, 19 focusable links at x = -374. (3) Three infinite animations ignore prefers-reduced-motion — verified under forced emulation: status-pulse-online (2.4s infinite) and trace-pulse-ring (1.6s infinite) still run; six reduced-motion blocks exist and correctly cover .stat-card and .nav-link but miss the live-status surfaces this redesign centers. (4) No skip link, no banner landmark; every route's heading outline opens at h2 (sidebar brand) before its h1.
**Why it matters:** WCAG 2.1 AA is a stated product commitment and "high contrast under fatigue" is in PRODUCT.md. The reduced-motion misses are on the pulsing status dots — the highest-motion elements on screen.
**Fix:** Darken the th token (#4b5563 on #f0f0f0 clears 7:1) or lighten the header fill. Add inert to the closed drawer. Extend reduced-motion to status-pulse-online, status-pulse-busy, trace-pulse-ring, ppImportSpin. Add a skip link and a `<header>` landmark.
**Suggested command:** /impeccable audit

## Persona Red Flags

**Alex (impatient power user)** — No keyboard shortcuts at all: not `/` to focus search, not j/k for rows, not `g q` for the queue. Copy Debug JSON is behind a `<details>` requiring a mouse first. Selects two rows and gets no confirmation — the batch bar is not sticky, so with 6 rows at 900px it renders below the fold; he sees a blue tint and a white artifact, no count. Clicks the disabled Confirm Reprint and nothing happens: #9f1239 at opacity 0.5 still reads as a live saturated button, with no inline message naming the two missing prerequisites. The one bulk action he has is the one that duplicates clinical labels, and it accepts SUCCESS and DUPLICATE_RETURNED without protest.

**Sam (screen reader, keyboard-only, 200% zoom)** — Every table header fails AA at 4.24:1. Status badge type ships at 10.4px, below DESIGN.md's own 0.75rem spec, and is the primary status carrier for a fatigued operator. .status-cell { display: flex } removes the status column from the table model. 19 off-screen drawer links focusable at 390px. No skip link, no breadcrumb, and the Printers table has no links at all — Printer Detail unreachable from the page that lists printers. Credit where due: role="alert" on error and reprint-warning blocks, aria-labelledby on every panel, per-row aria-label="Select job 8892bc3f", decorative marks aria-hidden with meaning in adjacent text, `<dialog>` via showModal() so focus trap and Escape come from the platform, 0 unnamed controls and 0 unlabeled inputs across all five routes, all 9 th carry scope. The foundation is good; the defects are narrow.

**Riley (stress tester)** — Refresh on /jobs → raw JSON. The queue's error state leaves live-looking controls over dead data: "Could not load the job queue" appears while the status filter still reads All (0) and the search box stays enabled and focusable; changing the filter silently does nothing. Thai is the default locale but the language switcher lives only in Settings.tsx, gated to OWNER/ADMIN — an OPERATOR or VIEWER cannot change language at all. Dates never localize: fmtTime() calls toLocaleString(undefined, …) so a fully Thai UI shows "Aug 01, 12:23 PM", and the reprint dialog's bare toLocaleString() produces "8/1/2026, 12:23:12 PM" — two formats for one timestamp, one viewport apart. Server error strings pass untranslated into the Thai page. Bindings accept free-text printerCode/templateCode with no validation and offer no delete.

## Minor Observations

- `page.jobDetail.printer` is not defined in either dictionary (verified by exact-key grep); t() falls back to the key, so PAGE.JOBDETAIL.PRINTER renders uppercased in the Document panel of the most-visited operator page, in both languages. Six more missing keys in Paper Profiles and Service Accounts. TH and EN otherwise in sync at 1071 keys each. Worth a ten-line CI check asserting every t('…') literal resolves in both.
- Session card reads "Sysadmin / Role: Sysadmin" — t('session.role.OWNER') resolves to "Sysadmin", colliding with the display name.
- Dashboard dot inconsistency: printers-ready, runners-online, queued and printing carry a semantic dot; unverified and failed do not. The two tiles an operator most needs to spot are the two without a mark.
- text-transform: uppercase on stat labels does nothing to Thai but turns "เวลาเฉลี่ย (ms)" into "เวลาเฉลี่ย (MS)" — it only ever affects Latin fragments, inconsistently.
- The mobile hamburger is fixed at top .75rem/left .75rem and the open drawer's brand sits at the same coordinates — the toggle covers "PRIN", leaving the drawer titled "TEROPS".
- .status-badge classes at styles.css:847-864 are dead code (the header comment says so) and still encode the old ten-color filled system the redesign abandoned. They will be someone's source of truth eventually.
- The Job Queue's Re-print column has an empty th. LATENCY (MS) states the unit twice over 347ms values.
- Product name still split: title and login say PrinterOps, error copy says PrintOps. PRODUCT.md flags this as explicitly undecided — it should not be resolved by inference.
- Console otherwise clean: two React Router v7 future-flag warnings, zero uncaught exceptions, zero key/prop warnings.
- /printer-bindings is the one route whose table's nearest overflow container is main.app-main itself, so the entire content region scrolls sideways instead of just the table.

## Questions to Consider

1. If a job can be SUCCESS while all seven printer-evidence fields are empty, is the verdict band reporting the device or reporting the database? Should there be a fourth tone between confirmed and caution — "completed, unwitnessed" — or should evidence-free completion simply be UNVERIFIED?
2. What is the button that ends an UNVERIFIED job's life without printing anything? Right now the only action is Reprint. If UNVERIFIED is "an operator decision," the decision needs somewhere to land — "checked at device: label present" ought to be recordable, auditable, and ought to decrement the Dashboard count.
3. Why does the queue know less about safety than the detail page? What if the queue rendered no reprint control for redundant/none statuses and made the operator open the job — friction on the risky path as the default?
4. The nav is 18 items for an OWNER and 7 for an operator. Which product is this? The operator's real day is three screens: queue, job, printer. Would the Dashboard's nine tiles survive that question?
5. If Thai is the default locale, why is the language switcher behind an ADMIN-only page — and given the batch flow, the Bindings labels and the Sandbox are English-only, is Thai actually the default, or just the default for the parts that were finished?
