# Refinement progress

## 2026-11-12 (later) — real-data review and concept retheme

The first pass used a mocked API and missed problems that only appear with records. This pass rendered all 18 routes against the running dev API (real data, Thai and English, 1440 and 390px) and applied the owner's concept board.

**Visual system:** indigo primary, light rail, cool page canvas, 8/12px corners, soft card lift on top-level surfaces only, separate metric cards, underline tabs, soft status pills (all through tokens; ~110 hard-coded blue/navy literals converted to tokens first).

**Consistency fixes:** one row-action pattern (bordered icon buttons, outlined danger) on Templates, Paper Profiles, Webhooks and Printer Bindings; Users moved the active switch into the Status column and put actions on one line; header actions share 44px with the freshness stamp first; table empty states are quiet; one table-head colour (feature overrides removed); the Web Control indicator joined the right-hand topbar tools; panel footers in a grid pin to the bottom (Export Center).

**Page fixes:** Route Policies subtitle (EN/TH, checked against the API's actual matching), Evidence Canvas editor, list first; Printer Bindings dropdowns instead of typing a profile UUID, no demo pre-fill, profile codes instead of ID hashes, Edit now scrolls `<main>`; Print Flow aligned copy rows, duplicate URL removed, 3-column bind form, a Default badge instead of "Enabled"; Sandbox literal `<strong>` tags; Webhooks pager and phone page-size select; Settings Reset demoted.

**Verification:** typecheck clean; 674/674 unit tests; production build OK; axe 0 violations and no overflow on 36 real-data renders; Playwright 55 pass / 25 fail, the same 25 as unmodified `main`.

**Follow-up in the same session:**
- Confirmations added: deleting a printer binding restates printer/template/paper first; Settings Reset (which clears this device's stored X-Api-Key) restates that consequence first, using the previously unused `settings.resetConfirm` string.
- Printer Bindings English form labels were raw keys (`printerCode`, …) — now "Printer / Template / Paper profile".
- Settings readiness: problems sorted first (unavailable → degraded → not configured → ready) and rendered as one ruled list instead of 13 cards.
- 1024px (the desktop window width): row actions no longer wrap into 218px-tall rows; when a table is wider than its frame, the actions column is pinned to the right edge (the legacy `.data-table { overflow: hidden }` that defeated this is now `visible`).
- Final check: 108/108 real-data renders (18 routes × 1440/1024/390 × TH/EN) with 0 axe violations, 0 overflow, 0 raw keys; typecheck clean; 674/674 unit; build OK; Playwright fails the same 25 tests as `main`.

**Second follow-up:**
- Settings readiness messages now render in Thai: `i18n/readinessMessages.ts` maps every sentence the API emits (a test reads `readiness.routes.ts` and fails if a new literal sentence is added without a translation); unknown text still shows verbatim.
- Sandbox copies stepper: the − and + buttons both announced as "Copies"; now "Decrease/Increase copies", and − is disabled at 1.
- Paper-profile field cards: the Key input gets its own row (was ~150px, under the 160px readability floor).
- E2E suite repaired: the 25 long-standing failures were stale selectors from earlier refactors (removed `.pp-icon-btn`, `.ds-modal`, `.job-queue-cards`, mobile nav now a dialog), outdated copy, a fixture that client validation correctly blocks, and a QR test that measured the quiet-zone box instead of the symbol. Selectors moved to roles/names. Result: 80/80, twice in a row; 677/677 unit.
- Two renders that failed during the 108-render sweep were 30s timeouts under 4-worker load; both passed on re-run with no findings.

**Owner decision (2026-11-12): Printer Bindings owns binding management.** Print Flow no longer has its own create form or default/enabled toggles; it shows the bindings read-only beside the API they drive, with a "Manage bindings" link. Users granted only Print Flow access can still see bindings but must be given Printer Bindings access to change them.

Also verified at 1920, 1280 and 768px (54 more renders, 0 issues), and edge-to-edge panels now inset their title row.

**Still needs the owner (not changed):**
- Native-speaker review of the Thai copy (including the new readiness translations); a Windows build to see the desktop shell.


## 2026-11-12 — cross-page audit and token pass

**Done** (details and evidence in `ux-audit.md`):

- Muted text token `#6b7280` → `#5f6673`; pastel error text → `--state-danger-text`. axe contrast violations: 20/20 routes → 0.
- 134 literal font sizes mapped onto the seven-rung scale; added `--font-action-size`. Rendered sizes outside the scale: 4 → 0 (apart from the sanctioned verdict headline).
- `StatusBadge.css` made the sole owner of `.status-badge` (two competing blocks deleted from `styles.css`).
- Job Detail: missing `page.jobDetail.printer` label (EN/TH); Copy Debug JSON moved out of `<summary>`.
- Webhooks: labelled the hidden import file input.
- Route error screen rebuilt from the shared `Button`; gradient/glow button CSS removed.
- 390px gutter 8px → 12px; selection, accent and scrollbar colours themed.
- Guards: `apps/web/src/__tests__/designTokens.test.ts` (contrast, type scale, ownership ratchet, no new hotfix sheets).
- Docs: this folder, DESIGN.md token/rule updates, `.impeccable/design.json` sidecar, AGENTS.md frontend rules.

**Verification:**

- `npm run typecheck -w apps/web`: clean. `vitest`: 674/674. Production build: OK.
- Rendered sweep, 20 routes × 1440/1024/390: 0 axe violations, 0 horizontal overflow.
- Playwright e2e: 55 pass / 25 fail, identical failing set on unmodified `main` (stash, rebuild, rerun, diff).
- Not verified: Tauri native window, physical screen reader, Thai copy review by a native speaker.

## 2026-11-12 — network printer discovery

- Added a network search form to Discovered Printers: select a Runner, enter IPv4 addresses/CIDR/ranges, then review search state and register reachable TCP 9100 candidates.
- Reused `Panel`, `Stack`, `FormField`, `Input`, `Select`, `Button`, `Alert`, and existing typography exports. No stylesheet, token, or global override was added.
- Added English/Thai copy for queued, running, completed, incomplete, expired, validation, and retry states. Search remains unavailable for viewers and explains when a Runner update is required.
- Rendered English and Thai at 1440px, 1024px, and 390px: labels and help text wrap, controls remain usable, and no horizontal page overflow was observed. Captures: `artifacts/browser/commit-network-{en,th}-{1440,1024,390}.png`.
- Unit tests: 677 web tests passed; production web build passed. The full Playwright suite passed 130 tests, including registration, newer searches from another operator, invalid inputs, status retry, permissions, and restored terminal states.
- Remaining verification: actual VPN/printer access and native Windows packaging. No additional styling debt introduced.

## Next, in order

1. **Fold the paper-profile hotfix layers** (`paperProfilesLayoutHotfix`, `Closure`, `Completion`, `LibraryGeometryHotfix`) into `paperProfilesLibrary.css` / `paperProfilesEditor.css`, deleting `!important` as you go. Gate: `paper-profile-ux` and `paper-profile-layout-regression` e2e, which first need their pre-existing failures fixed so they can detect a regression. Then delete the entries from the hotfix list in `designTokens.test.ts`.
2. **Retire `experienceSystem.css` as an override layer**: move each rule into the component stylesheet that owns the class (see `component-inventory.md`), one family per change, lowering the ratchet ceiling each time.
3. Fix the 25 pre-existing e2e failures (mostly paper-profile editor selectors and 30s timeouts).
4. Guard `Settings.tsx` against a missing `executor` in the runtime-architecture response.
5. Consider placing `RouteErrorBoundary` inside the shell so navigation survives a route crash.

## 2026-11-12 — Linux CUPS runtime diagnostics

- Settings now names the Linux CUPS executor in both English and Thai. Existing
  CardDetail primitives, typography and styles are reused; no CSS changed.
- Rendered and checked at 1440px, 1024px and 390px in both locales; no page
  overflow. Captures: `artifacts/browser/settings-linux-{en,th}-{1440,1024,390}.png`.
- Web unit tests: 677 passed. Production web build passed. Full Playwright: 136
  passed, including the six Linux diagnostics viewport/locale cases.
- Remaining operational work: validate the installed Linux driver and physical
  G2000 output against the existing template/profile. No new styling debt.
