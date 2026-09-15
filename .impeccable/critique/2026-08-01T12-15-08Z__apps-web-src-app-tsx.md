---
target: apps/web/src/App.tsx
total_score: 59
max_score: 100
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-01T12-15-08Z
slug: apps-web-src-app-tsx
---
Method: dual-agent (A: independent design review · B: detector/source/browser evidence) + parent live-route verification with seeded local data

# PrintOps whole-app critique

## Overall assessment

The global refactor achieved a visibly calmer and more coherent shell: Action Blue is consistent, buttons converge on 6px corners, cards on 8px corners, surfaces are flat, and Templates/Paper Profiles now behave like library-first tools on mobile. The app is no longer a collection of unrelated page themes.

It is not yet safe or complete enough to call the system unified. One physical-output entry point bypasses the confirmed safety policy, four SPA routes collide with Vite's legacy API proxy on hard navigation, mobile Users collapses into an unreadable five-column squeeze, and bilingual coverage still exposes English copy and a raw translation key. The visual system is converging faster than the interaction and runtime contracts beneath it.

## Heuristic scorecard

| Heuristic | Score / 10 | Evidence |
| --- | ---: | --- |
| Visual hierarchy | 7 | Clear page titles, restrained surfaces, and strong library cards; detached freshness rows and dense dashboards/editors still flatten priority. |
| Information architecture | 7 | Operations/admin navigation and library → editor stages are understandable; 19 routes and expanded admin navigation remain cognitively heavy. |
| Clarity and comprehension | 6 | Domain labels and evidence panels are generally explicit, but raw acronyms, English fallbacks, a raw i18n key, and ambiguous icon-only Paper Profile actions reduce trust. |
| Task efficiency | 5 | Search, filters, paging, libraries, and focused editors work; dev hard-refresh failures, broken query proxying, non-actionable dashboard counts, and a long mobile Paper Profile editor add avoidable work. |
| Consistency and predictability | 6 | Shared color/corner/surface tokens are visible; bespoke headers, buttons, tables, modals, inline styles, and product naming still diverge. |
| System feedback | 7 | Freshness, stale/error states, retries, status regions, proof timing, and explicit print-block reasons are strong; success feedback is often short-lived. |
| Error prevention and recovery | 3 | Sandbox safeguards are excellent, but Printer Detail allows an UNKNOWN printer to receive a one-click test-print request without confirmation. Unknown routes also render an empty main area. |
| Accessibility and inclusivity | 5 | Skip link, focus-visible styles, labelled icon actions, reduced-motion support, and inert closed navigation are good foundations; mobile nav targets are 33px/18px, focus remains in the hidden inert nav after Escape, and Users mobile is unreadable. |
| Visual craft and coherence | 6 | The Lab Notebook palette is calm and workmanlike; tiny metadata, generic admin-dashboard composition, emoji controls, and CSS override strata keep it from feeling resolved. |
| Progressive disclosure | 7 | Templates/Paper Profiles separate library and editor; Sandbox correctly hides raw JSON behind expert disclosure. Some advanced engine and configuration taxonomies still arrive too early. |
| **Total** | **59 / 100** | **Strong structural progress, blocked by one P0 safety defect and several P1 runtime/mobile issues.** |

## Design specificity

The behavior is product-specific; the visual composition is still category-generic. The proof-versus-print separation, printer readiness semantics, physical paper measurements, print confidence, trace evidence, and `UNVERIFIED` handling could only belong to a serious print-operations product. By contrast, the dark left rail, blue primary action, flat white cards, metric tiles, and dense settings tables could be Retool, Grafana, or a generic fleet-management console with the labels changed.

The memorable choices are the physical proof stage, explicit paper geometry, and honest output certainty. The default-looking choices are the dashboard card grid and many route-local table/form treatments. The next design pass should express physical consequence and evidence in composition, not only in copy and state logic.

## Priority issues

### P0 — Physical Test Print safety is inconsistent across entry points

Live evidence: the seeded `LAB_LABEL_01` printer rendered with status `UNKNOWN`. Template Sandbox correctly kept “Test Print” disabled, attached the status explanation, and allowed “Generate proof” independently. Printer Detail rendered its Test Print button enabled; activating it immediately submitted the request and displayed “Test print sent” with no confirmation.

Source confirms the bypass: [PrinterDetail.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/pages/PrinterDetail.tsx:52) posts directly, and its footer button at [PrinterDetail.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/pages/PrinterDetail.tsx:115) has neither readiness gating nor confirmation. This contradicts the confirmed policy that every physical Test Print must be blocked for offline/unknown printers and must show printer, template, copies, and explicit physical-output acknowledgement.

Direction: make physical-output authorization one shared domain/UI guard used by every print entry point. Do not let each page implement its own weaker variant.

### P1 — The development web app cannot reliably reload or fetch several routes

Live evidence: hard navigation to `/printers`, `/jobs`, `/runners`, and `/audit-logs` returned API JSON/401 instead of the SPA. Client navigation rendered the pages, but `/jobs?limit=1000`, `/jobs?limit=500`, and `/audit-logs?limit=100` returned Vite's HTML shell, which the UI reported as “The server returned a malformed response.” This broke Job Queue, Audit Logs, and one Dashboard data source in the seeded local run.

The collision is between SPA paths and the legacy proxy regexp in [vite.config.ts](/Users/Projects/adm-chura3inter/print_ops/apps/web/vite.config.ts:13), plus query-bearing calls in [JobQueue.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/pages/JobQueue.tsx:102), [Dashboard.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/pages/Dashboard.tsx:36), and [AuditLogs.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/pages/AuditLogs.tsx:17).

Direction: separate API and SPA namespaces in development or implement an explicit dev rewrite that preserves hard-refresh routing and query strings. This is essential if the web build is the source of truth for desktop production.

### P1 — Mobile accessibility passes overflow checks while failing usability

Live evidence at 390×844: Templates and Paper Profiles converted cleanly to cards with no horizontal overflow. Users did not—it compressed Name, Email, Role, Status, and Actions into the viewport, causing values and buttons to overlap. The absence of horizontal scroll masked the failure.

The open mobile navigation measured 33px for every route link and 18px for the admin disclosure, below the stated 44px floor. After focusing a nav link and pressing Escape, focus remained on that now-hidden link inside the inert off-canvas nav instead of returning to the 44×44 menu button. The implementation closes state in [App.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/App.tsx:370) but does not restore focus; link padding is defined at [styles.css](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/styles.css:209). Users remains a fixed inline-styled table at [UsersRoles.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/pages/UsersRoles.tsx:126).

Direction: use mobile user cards or row-to-detail disclosure, enforce the 44px target at the shell level, and return focus to the menu toggle whenever the drawer closes.

### P1 — Localization and operator-facing terminology are not closed

Live evidence in Thai showed `PAGE.JOBDETAIL.PRINTER` in Job Detail, English table headers and actions in Users, and an English readiness explanation inside the Thai Sandbox. The shell and HTML title say “PrinterOps” while project language elsewhere uses “PrintOps.” Sandbox still mixes emoji with the newer icon system.

Source confirms the missing translation key call at [JobDetail.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/pages/JobDetail.tsx:747) and hard-coded English table copy at [UsersRoles.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/pages/UsersRoles.tsx:129).

Direction: add a zero-raw-key localization check, remove user-facing hard-coded strings, and choose one product name before the desktop bundle is treated as production-ready.

### P2 — Visual convergence is real, but the CSS/layout contract remains fragile

The shared contract in [PageLayout.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/components/PageLayout.tsx:17) and [layoutSystem.css](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/layoutSystem.css:1) successfully normalizes surfaces and controls. Yet many pages still pass bespoke headers, place freshness in the body, or maintain separate button/modal/table systems. On mobile Templates, this creates a conspicuous empty band between the title header and freshness row.

Paper Profiles is the clearest maintenance risk: [paperProfilesClosure.css](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/paperProfilesClosure.css:30) forces a flex layout, then [paperProfilesLayoutHotfix.css](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/paperProfilesLayoutHotfix.css:48) replaces it with a grid using more `!important`, with import order fixed in [main.tsx](/Users/Projects/adm-chura3inter/print_ops/apps/web/src/main.tsx:6). It renders acceptably now but is brittle under new content and localization.

Release hygiene is also incomplete: [apps/web/index.html](/Users/Projects/adm-chura3inter/print_ops/apps/web/index.html:11) still ships an Impeccable live script pointing to `localhost:8400`.

Direction: converge behavior as well as appearance—one header/freshness pattern, one table-to-card responsive primitive, one dialog system, and one owner for Paper Profile layout rules. Remove live-instrumentation markup from the build source.

## What works well

- All 19 registered routes use the shared route shell or render within its main landmark; live checks found no document-level horizontal overflow at 1440×900 or 390×844.
- Primary buttons rendered Action Blue (`rgb(30, 102, 245)`) with 6px corners; representative cards rendered 8px corners and no shadow.
- Templates mobile is genuinely library-first: search/actions stay above compact cards, identifier and status lead, and editing opens as a focused next stage.
- Paper Profiles mobile likewise starts with searchable cards, clearly exposes dimensions/margins/orientation/DPI/field count, and provides an explicit route back from editing.
- Sandbox keeps proof generation independent from printing, moves JSON behind expert disclosure, and blocks its own physical-print action while readiness is unknown.
- Shared freshness, partial-failure, retry, alert, status, and technical-detail patterns provide unusually honest system feedback.
- Contrast calculations for the core tokens meet WCAG AA: normal text, muted text, primary actions, navigation text, and semantic surface/text pairs all cleared the normal-text threshold.

## Persona red flags

- **Skeptical senior design lead:** the app now has consistent cosmetics, but the Paper Profile override stack and route-specific component families reveal that the system is still being normalized from the outside inward.
- **Hurried ward operator:** the Dashboard announces a data error and multiple counts but offers little direct drill-down; worse, Printer Detail allows a consequential action that Sandbox correctly forbids.
- **System administrator on mobile:** the Templates/Paper Profiles libraries feel purposeful, while Users becomes visually unusable and Settings remains a long, text-heavy inspection surface.
- **Keyboard or screen-reader user:** skip/focus semantics are promising, but Escape can strand focus in an inert hidden menu, the sidebar brand `h2` precedes each route `h1`, raw i18n output can be announced, and unknown routes provide no recovery target.

## Minor observations

- The detector found two 5px side rails on job verdicts at `styles.css:7996` and `styles.css:8003`. These may be defensible semantic markers for caution/failure rather than decorative “AI slop”; keep the text/icon status primary and validate the rail with operators.
- The live detector found a colored glow on the dark login page while the live instrumentation was injected. Because the live script remains in `index.html`, separate base-app evidence from instrumentation effects before changing the palette.
- Login email lacks native `type="email"`/`required`, Splash status is not a live region, and unknown routes render a blank main area.
- Paper Profile mobile puts a large preview before essential configuration controls. It is visually impressive, but a Preview/Settings segmented view would shorten the path to routine corrections.
- Dashboard metric cards are visually clear but non-interactive; intervention counts should lead to a prefiltered queue.
- Much operational metadata remains below 12px. Contrast is technically adequate, but long-shift legibility is not only a contrast problem.

## Questions for the next pass

1. Which product name is authoritative for UI, documentation, desktop bundle, and metadata: **PrintOps** or **PrinterOps**?
2. For mobile Users, should the canonical pattern be **compact user cards opening focused access editing** (recommended) or a horizontally scrollable administrative table?
3. Should Dashboard prioritize **intervention queues** (failed/unverified/stale), **fleet health**, or **throughput and latency** as its first visual story?

## Run notes

- Target: `apps/web/src/App.tsx`; slug: `apps-web-src-app-tsx`; no `.impeccable/critique/ignore.md` was present.
- Assessment A was isolated from detector output and used visual/source critique. Assessment B independently ran the CLI detector, token/contrast review, and mutable overlay flow. Parent verification then rendered authenticated routes with a seeded, temporary SQLite database.
- Live route coverage: login plus all 19 registered routes, including Printer Detail and a generated Job Detail, at 1440×900 and 390×844. Focused interactions covered mobile navigation, Templates editor, Paper Profiles editor, Sandbox proof generation/readiness block, unknown-route behavior, and Printer Detail test print.
- The physical-print probe used the temporary database with no runner online; the request was accepted/queued but no physical output was produced.
- CLI detector: 2 `side-tab` warnings. Live detector: 1 `dark-glow` warning during injected instrumentation; no reliable visual overlay node rendered. Detector live server was stopped by Assessment B.
- Parent Vite/API servers and ego-browser task were stopped after evidence capture. Temporary seeded database was deleted. No application source was changed by this critique.
- Snapshot persisted under `.impeccable/critique`; trend is reported in the response after persistence.
