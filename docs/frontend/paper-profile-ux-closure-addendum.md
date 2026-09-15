# Paper Profile UX closure addendum (FE-02A.1)

Date: 2026-07-30  
Branch: `mvp_nippon`

This addendum records the direct visual-interaction closure applied after the
original FE-02A audit still reported open hover, selected, drag, preview and
WebView select risks.

## Scope

The closure is intentionally isolated to Paper Profile styling. It does not
change:

- Paper Profile API contracts
- persisted profile schema
- paper geometry
- barcode or QR rendering
- import/export payloads
- drag/nudge domain calculations

The stylesheet is loaded after the main application stylesheet from
`apps/web/src/main.tsx`.

## Changes applied

### Actual-workspace responsive layout

The previous layout depended primarily on viewport breakpoints even though the
navigation rail and application padding reduce the space available to the
editor. The closure uses a wrapping flex workspace with independent panel
heights. It responds to actual available width without applying CSS containment
to the page root, because containment can alter the containing block of fixed
drawers and modals.

### Native select and control states

Paper Profile controls now have explicit light color-scheme behavior, opaque
option backgrounds, readable option text, a stable dropdown arrow and complete
hover/focus/invalid/disabled presentation. Native `<select>` semantics remain
unchanged.

### Hover, focus, selected and drag states

The closure adds distinct states for section toggles, field cards, selected
fields, keyboard focus, canvas field hover, `grab`/`grabbing`, saved-profile row
actions and destructive actions. Touch-first devices do not retain mouse-only
hover treatment.

### Tooltip and popup behavior

Tooltips receive a hover delay, immediate keyboard-focus presentation, wrapping
and edge alignment. The preset menu gains bounded internal scrolling and a
viewport-safe narrow-screen presentation.

### Preview information and clipping

Quick information is no longer silently ellipsized. Selection details wrap.
The field measurement callout is kept inside the clipped paper surface, while
the persistent selection strip retains full coordinates and dimensions.
Barcode previews, the canvas stage, drawers and full-preview toolbars have
explicit overflow ownership.

## Commits

- `94bbabc7b157637360285d114867f6a39dc18d34` — add Paper Profile visual closure stylesheet
- `6f05629801d209ee8c5d8ca4c72fb64ebe5dbf15` — load the closure stylesheet after `styles.css`
- `1d356060552f47f27aace71b7b9066d2521b5aa1` — replace query containment with non-containing flex wrapping

## Verification status

| Check | Status | Notes |
|---|---|---|
| GitHub file/commit integrity | PASS | Files and imports are present on `mvp_nippon`. |
| GitHub status checks | NOT AVAILABLE | The repository reports no status checks for the closure commit. |
| `npm test` | NOT RUN | GitHub connector cannot execute the workspace. |
| TypeScript typecheck | NOT RUN | GitHub connector cannot execute the workspace. |
| Production web build | NOT RUN | GitHub connector cannot execute the workspace. |
| Chromium interaction suite | NOT RUN after closure | Existing FE-02A evidence predates this addendum. |
| Packaged WebView2/Tauri | NOT RUN | Must be verified on the Windows build/runtime environment. |

## Closure gate

Do not start FE-02B structural modularization until the current branch is built
and checked in Browser and packaged Desktop at these viewports:

- 1440 × 900
- 1280 × 800
- 1100 × 720
- 1024 × 768

Required runtime observations:

- every native dropdown is readable and selectable in WebView2
- the two-panel editor wraps without overlap or unintended page overflow
- tooltips remain inside the viewport
- preset menu remains reachable and does not clip
- hover does not move controls
- selected and focused fields remain distinguishable
- canvas drag shows `grabbing`
- quick information and selection details remain readable
- drawer and full-preview fixed positioning remains viewport-relative

The next milestone must remain blocked until those runtime checks pass.
