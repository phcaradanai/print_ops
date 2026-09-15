# Paper Profile runtime UX audit (FE-02A)

Baseline captured 2026-07-30 against `mvp_nippon` at `5e214c9`, before any
FE-02A fix. The editor is `apps/web/src/pages/PaperProfiles.tsx` (2,994 lines).

## How this was reproduced

`apps/web/e2e/paper-profile-ux.spec.ts`, driven by Playwright against the
**production bundle** in `apps/web/dist` — the same artifact the Desktop shell
serves through `server.exe`. Every row below that says *measured* comes from a
DOM measurement (bounding boxes, `elementFromPoint`, `scrollWidth`/`clientWidth`,
computed style), not from a screenshot read by eye. Screenshots are attached as
corroboration, under `artifacts/browser/`.

Viewports: 1440×900, 1280×800, 1100×720, 1024×768.
Fixtures: 10 mixed fields (text, two barcode symbologies, QR, date, number,
long English label, long Thai label, long profile name/code), an empty 50×25
label, A4 portrait and A4 landscape.

### Harness defect found first

The pre-existing suite `apps/web/e2e/reprint-safety.spec.ts` failed on all four
viewports and had to be repaired before anything could be observed. Its
catch-all `page.route('**/*')` matched by pathname only, so the **document**
navigation to `/jobs` was answered with the mocked `/jobs` JSON — the browser
rendered the array as the page body, and no button ever existed to click. The
static file server also has no SPA fallback, and the whole shell sits behind a
splash screen that polls `/health`. Now handled once in `apps/web/e2e/support.ts`:
navigations are served the built `index.html`, `/health` and `/me` are answered,
and the locale is pinned (the app defaults to Thai, while that suite asserts
English strings). Unmatched API calls return `501` instead of falling through to
a 404 HTML body, so a forgotten mock fails at its cause.

### What this evidence does and does not cover

Chromium via Playwright is **not** WebView2. Native `<select>` option-list
rendering — the specific thing the brief asks about for Tauri — is drawn by the
platform, and Chromium passing says nothing about it. The packaged desktop
binary on this machine predates these changes, and rebuilding it needs the Rust,
`pkg` and dotnet toolchains, so **no Tauri runtime evidence was collected**. Every
Tauri row in the final report is `NOT RUN`, and the closed/open status of D-6
below is a code-level argument only.

## Severity scale

| Severity | Meaning |
|---|---|
| BLOCKER | An operator cannot complete a required action at a supported viewport. |
| HIGH | Required information or control is hidden, unreadable or misleading. |
| MEDIUM | Usable but wrong: layout instability, inconsistent controls, poor feedback. |
| LOW | Cosmetic or convention-level. |

## Defect matrix

### D-1 — BLOCKER — saved-profile row actions are unclickable at 1024×768

- **Viewport**: 1024×768 (overlap present but harmless at 1440×900 and 1280×800)
- **Environment**: Chromium (measured). Applies to any WebView at the same size.
- **Steps**: open `/paper-profiles` with any profile saved; scroll to *Saved
  profiles*; click the ✏️ / ⤒ / 🗑️ action on a row.
- **Expected**: the edit, export and delete actions respond.
- **Actual**: nothing happens. `document.elementFromPoint` at the button's own
  centre returns `DIV.pp-form-scroll` — the editor panel is painted on top of the
  row. Playwright's click times out on the hit-target check.
- **Measured**:

  | Viewport | `.pp-main-layout` height | panel height | panel bottom | table top | overlap |
  |---|---:|---:|---:|---:|---:|
  | 1440×900 | 532 | 620 | 700 | 680 | 20px |
  | 1280×800 | 515 | 620 | 700 | 663 | 37px |
  | 1100×720 | 499 | 620 | 700 | 647 | 53px |
  | 1024×768 | 465 | 620 | 700 | 613 | **87px** |

- **Likely source**: three rules fighting. `.paper-profiles-page` is
  `height: 100%` (inline, `PaperProfiles.tsx:1981`); `.pp-main-layout` takes
  `flex: 1` of that fixed height; but `.pp-preview-panel` carries
  `min-height: 620px` (`styles.css:2087`) with `align-items: stretch`, so the grid
  row is 620px whatever the flex allotment was. Because the page height is fixed
  and nothing owns the overflow, the grid paints *over* the next sibling instead
  of growing. `.app-main` has `overflow-y: auto` but never scrolls:
  `scrollHeight === clientHeight === 800` at every viewport.
- **Evidence**: `artifacts/browser/paper-profile-editor-1024x768.png`
- **Status**: FIXED — see §Resolution.

### D-2 — HIGH — the preset menu is clipped by the form panel

- **Viewport**: all four (measured at 1440×900 and 1280×800)
- **Steps**: open the editor, click the 📋 presets button in the command bar.
- **Expected**: all eight paper presets are readable and clickable.
- **Actual**: the left portion of the menu is cut off. Menu box
  `x 809 … 1329`, panel box `x 990 … 1420` — 181px of the menu, including the
  start of every label in the left grid column, is outside the panel.
- **Likely source**: `.pp-presets-menu` is `position: absolute` (`styles.css:2019`)
  inside `.pp-form-panel`, which sets `overflow: hidden` inline
  (`PaperProfiles.tsx:2021`) — so the panel clips its own popup. The menu is
  `width: min(520px, 100vw - 2rem)` against a 360–430px panel, i.e. it is designed
  wider than its clipping ancestor.
- **Evidence**: `artifacts/browser/paper-profile-presets-*.png`
- **Status**: FIXED.

### D-3 — HIGH — toolbar tooltips render above the top of the viewport

- **Viewport**: all four (measured 1440×900, 1280×800)
- **Steps**: hover any icon button in the page header toolbar.
- **Expected**: the tooltip is readable.
- **Actual**: it is drawn off-screen. Box `y = -4`, height 24 — entirely above
  the viewport edge.
- **Likely source**: `.pp-icon-btn-wrapper .pp-icon-btn-tooltip` is pinned with
  `bottom: calc(100% + 6px)` (`styles.css:1988`), which is correct for controls in
  the middle of the page and wrong for the toolbar row at the very top.
- **Note**: the accessible name does not depend on the tooltip
  (`getIconButtonAriaLabel`), so this is a sighted-mouse-user defect, not a
  screen-reader one.
- **Status**: FIXED.

### D-4 — HIGH — field-row inputs are too narrow for realistic values

- **Viewport**: all four (measured 1440×900)
- **Steps**: edit a profile with a long field label; look at the label input in
  the *Fields* section.
- **Expected**: the value is readable, or visibly truncated on purpose.
- **Actual**: `196px` of box for `488px` of text, in a 430px panel that had room.
  Fixed-width controls inside `flex-wrap` rows also reflow unpredictably as the
  panel narrows.
- **Likely source**: the field row is two `display: flex; flex-wrap: wrap` strips
  (`PaperProfiles.tsx:2196`, `2205`, `2215`) of controls with hardcoded widths from
  the inline `s.smallInput` object, with no `min-width: 0` and no grid.
- **Status**: FIXED for the numeric and label controls (grid + explicit minimum
  widths). See §Resolution for what is deliberately still scroll-in-place.

### D-5 — HIGH — a failed profile list is silent

- **Environment**: measured (route mocked to `500`)
- **Steps**: open `/paper-profiles` while `GET /api/v1/paper-profiles` fails.
- **Expected**: the failure is visible with a retry.
- **Actual**: nothing. `load()` is
  `apiFetch(...).then(setProfiles).catch(() => {})` (`PaperProfiles.tsx:1400`), so
  the table renders its *"no paper profiles"* empty state — an outage is
  presented as "you have not created any profiles yet", which invites an operator
  to recreate profiles that already exist.
- **Status**: FIXED.

### D-6 — HIGH (code-level only) — select options may be unreadable in the Tauri WebView

- **Environment**: **NOT REPRODUCED** — no WebView2 evidence was collected.
- **Basis**: all 13 `<select>` elements are styled from the inline `s.sel` object,
  which sets `background: '#fff'` on the closed control but nothing on
  `<option>`. Chromium measurements confirm the closed control is opaque and
  `box-sizing: border-box` after the fix; option-list painting is the platform's,
  and a dark system theme in WebView2 is the known failure mode.
- **Status**: MITIGATED, NOT VERIFIED. Options now carry explicit
  `background-color`/`color`, which is the standard defence, but this row stays
  open until someone runs the packaged build.

### D-7 — MEDIUM — four `alert()` dialogs in the import/export path

- **Steps**: export a profile with no workspace path, or import malformed JSON.
- **Actual**: a native modal (`PaperProfiles.tsx:1498`, `1526`, `1538`, `1540`).
  It blocks the WebView, cannot be styled, is not localized by the app, and
  reports success the same way it reports failure.
- **Status**: FIXED (shared `Alert`).

### D-8 — MEDIUM — save and delete failures discard the server's reason

- **Actual**: `save()` catches and shows the constant
  `page.paperProfiles.saveFailed` (`PaperProfiles.tsx:1432`), so a `409 code
  already exists` and a `500` are indistinguishable. `confirmDeleteProfile`
  reads `err?.message` off an `any`.
- **Status**: FIXED.

### D-9 — MEDIUM — artwork load failure is swallowed

- **Actual**: `.catch(() => {…})` on the artwork fetch (`PaperProfiles.tsx:1723`)
  cannot distinguish "this profile has no reference artwork" from "the artwork
  request failed", so the canvas silently renders without the layer the operator
  imported.
- **Status**: FIXED (404 is a fact, any other failure is surfaced) — code-level
  only, no automated case: reproducing it needs a stubbed artwork blob response.

### D-10 — MEDIUM — hardcoded English in the editor chrome

- **Actual**: `Content & output`, `Position & style`, `Label canvas`, `Drag
  fields or use arrow keys for 0.1 mm adjustments`, `Canvas controls`, `Toggle
  grid`, `Show field dimensions`, `Expand canvas`, `Add a field to start
  designing this label`, and the X/Y `mm` unit suffixes. A Thai operator gets
  English.
- **Status**: FIXED.

### D-11 — LOW — inline style objects duplicate the class layer

- **Actual**: 174 lines of `.pp-*` CSS coexist with a page-local `s` object; the
  same control is styled from both, so hover/focus/invalid/disabled states exist
  for some controls and not others.
- **Status**: PARTIALLY FIXED — form controls moved to classes; canvas and ruler
  geometry keep inline styles on purpose (they are computed per-render from mm
  values, and belong in FE-02B's geometry extraction, not in a stylesheet).

## Checks that found nothing

Recorded so a later reader does not assume they were skipped — with what was
actually measured when, because three of these could only be measured *after*
D-1 was fixed (the blocked edit click stopped the editor from loading at
1280×800 and below):

- **No unintended horizontal page scroll**: measured green at all four
  viewports after the fixes; pre-fix, only 1440×900 could be measured
  (`documentElement.scrollWidth === clientWidth`).
- **Hover does not move the layout**: measured green at 1440×900 pre-fix and at
  all four after. Neighbouring toolbar controls stay within 1px of their offset
  inside the toolbar when a sibling is hovered.
- **Full-preview modal locks the page**: `document.body.style.overflow` is
  `hidden` while open and restored on close. The page code
  (`PaperProfiles.tsx:1783`–`1822`) already saved and replayed the previous
  value, so this is a pre-existing correct behaviour — but it was **not verified
  at baseline**: the first version of that test used the wrong selector
  (`.pp-preview-modal` instead of `.paper-preview-modal`) and only went green
  after the selector was corrected.
- **Field-row controls do not overlap**: measured green at 1440×900 pre-fix and
  at all four after.

## Not covered

- WebView2 / packaged desktop runtime (D-6, and every "Tauri" row).
- Continuous resize between viewports: Playwright sets discrete sizes. Resize
  *while a menu is open* is covered; a dragged window is not.
- Canvas drag, keyboard nudge, zoom, rulers and grid behaviour were exercised as
  pure functions by `apps/web/src/__tests__/paperProfiles.test.ts` (210 tests) and
  visually in the browser, but not as pointer-drag automation.

## Resolution

### Scroll and overflow ownership (Phase 2)

| Region | Owns | How |
|---|---|---|
| App shell `.app-main` | application scrolling | unchanged `overflow-y: auto`; the page may now exceed it |
| `.paper-profiles-page` | filling the window | `min-height: 100%` instead of `height: 100%` — fills, but may grow |
| `.pp-main-layout` | the editor row's height | `height: calc(100vh - 200px)`, `min-height: var(--pp-panel-min-h)` |
| `.pp-form-scroll` | vertical form scrolling | `overflow-y: auto`, `overflow-x: hidden`, `overscroll-behavior: contain` |
| `.pp-preview-stage` | canvas / zoom overflow | unchanged |
| `.pp-drawer__body`, modal body | their own scrolling | unchanged |
| `.pp-form-panel` | nothing — frame only | `overflow: visible`, so it stops clipping its own menu |

Both halves are needed and the first attempt at this got it wrong in an
instructive way. Making the page growable alone removed the overlap but also
removed the bound on the form panel: it expanded to its full content height
(~3,850px measured) and the *shell* scrolled the form, destroying the two-pane
workflow. Bounding the editor row alone would have reproduced D-1. The row is
sized to the window; anything below it is reached by scrolling the shell.

No z-index was raised to fix clipping. The clipping was caused by overflow
ancestors, and a documented scale (`--pp-z-canvas-guide` … `--pp-z-drawer`) now
lives on `.paper-profiles-page` so the next fix cannot be a bigger number.

### Control strategy (Phase 3)

Native `<select>` is kept everywhere — no custom combobox. Only the closed
control is styled, `appearance: none` plus a drawn arrow, and `<option>` gets an
explicit `background-color`/`color` because the option list is painted by the
platform. Keyboard behaviour is untouched and asserted
(`selectOption` + focus assertions in the suite).

The page-local inline `s` style objects are replaced by `.pp-input`,
`.pp-select`, `.pp-number`, `.pp-color`, `.pp-label`, `.pp-checkbox-label` and
`.pp-field-delete`, each with default / hover / focus-visible / invalid /
disabled / read-only states. Inline styles could not express any of those, which
is why most controls had none. Every control is `box-sizing: border-box` with
`min-width: 0`, hover changes colour only (never size), and the invalid state is
a border *plus* an inset ring rather than colour alone. The six import-drawer
inputs now carry `aria-invalid` instead of only a red border.

Canvas and ruler geometry keep their inline styles on purpose: those values are
computed per render from millimetres, and belong to FE-02B's geometry
extraction, not to a stylesheet.

### D-4, precisely

The field-card header is a grid with the label input on **its own full-width
row** (`grid-template-areas`), which raises it from 173px to the card width, and
the numeric controls have `min-width: 5.5rem` so a spinner can no longer sit on
top of the digits. A value longer than the panel is wide still scrolls inside its
input — that is what a text input does, and the alternative (truncating what the
operator is editing) would be worse. The regression test therefore asserts two
different things: a numeric value must be fully visible, and a text box must be
at least 160px.

### Closure evidence

`apps/web/e2e/paper-profile-ux.spec.ts` — 39 tests, all passing, at all four
viewports:

| Defect | Closed by | Test |
|---|---|---|
| D-1 | page may grow + bounded editor row | `no unintended horizontal page scroll`, `scroll ownership is explicit`, and every 1024×768 field-row test (each requires the previously-unclickable edit action) |
| D-2 | `.pp-form-panel { overflow: visible }` | `preset menu is not clipped by the form panel` — corner hit-testing, not containment |
| D-3 | tooltip flips below in top-of-page toolbars | `toolbar tooltip stays inside the viewport` |
| D-4 | field-card grid + control minimums | `numeric and text inputs are wide enough for their values`, `field row controls do not overlap` |
| D-5 | `useApiResource` + `ErrorState`/`ErrorBanner` | `a failed profile list is visible, not silent`, `an empty list is distinguishable from a failed one` |
| D-7 | shared `Alert` strip | no `alert(` remains in the page |
| D-8 | `errorMessage(err, …)` | `a failed save shows the backend reason`, `a failed delete shows the backend reason` |
| D-9 | 404-vs-failure split on artwork | code-level; no automated case (needs a stubbed artwork blob) |
| D-10 | 22 new keys in both locales | `i18n.test.ts` parity, `long Thai content does not push the page sideways` |
| Phase 7 | Escape / outside click / focus return / single popup | `preset menu closes on Escape, outside click and selection`, `drawers fit the viewport and scroll internally`, `full preview keeps its controls reachable and locks the page behind it` |

D-6 remains open pending WebView2 evidence. D-11 is partially closed as described
above.

## Phases of the brief NOT completed in FE-02A

Recorded here rather than implied closed by a passing suite.

- **Phase 5 (hover/active/selected), mostly open.** Toolbar hover/focus and the
  destructive-hover rule are done and tested. Not audited or changed: section
  index buttons, section toggles, field cards, canvas fields, drawer actions,
  modal tools, saved-profile table actions; the grab → grabbing drag cursor;
  sticky hover after touch/pointer interaction; and tooltip *delay* — the current
  tooltip has a 0.15s opacity transition but no open delay.
- **Phase 6 (preview stability), partial.** The scroll fix and the named panel
  minimum are in. Not exercised: orientation change leaving stale scroll
  position, refit when switching profiles, and resize-without-flicker loops.
- **Phase 8 (async foundation), partial.** The list, save, delete, import and
  export paths are on the shared surfaces with real reasons. Still open: delete
  has no pending state and does not restore focus to the row action afterwards
  (it is not on `useApiAction`), and main-form validation errors are still joined
  into one string rather than associated with their fields — only the six
  import-drawer inputs carry `aria-invalid`.
- **Phase 10**: two focused extractions were considered and not made; nothing in
  the page required one to fix a defect safely. No FE-02B decomposition started.
