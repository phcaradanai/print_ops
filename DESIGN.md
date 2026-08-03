---
name: PrintOps
description: Hospital print operations — clinical, calm, and precise.
colors:
  primary: "#1e66f5"
  primary-strong: "#2563eb"
  primary-hover: "#1654d1"
  primary-pressed: "#1d4ed8"
  neutral-deep: "#1e1e2e"
  neutral-page: "#f5f5f5"
  neutral-surface: "#ffffff"
  neutral-paper: "#f8fafc"
  neutral-subtle: "#f0f0f0"
  neutral-border: "#e5e7eb"
  neutral-border-strong: "#d1d5db"
  neutral-text: "#374151"
  neutral-text-muted: "#6b7280"
  neutral-inverse: "#111827"
  canvas-ink: "#111827"
  canvas-gutter: "#0f172a"
  canvas-edge: "#334155"
  canvas-line: "#94a3b8"
  canvas-text: "#e5e7eb"
  canvas-caret: "#93c5fd"
  semantic-success: "#a6e3a1"
  semantic-warning: "#f9e2af"
  semantic-error: "#f38ba8"
  semantic-info: "#89b4fa"
  semantic-neutral: "#9399b2"
  semantic-progress: "#fab387"
  state-danger-surface: "#fee2e2"
  state-danger-text: "#991b1b"
  state-warning-surface: "#fef3c7"
  state-warning-text: "#92400e"
  state-success-surface: "#e6f7e6"
  state-success-text: "#2d6a2d"
  state-info-surface: "#eff6ff"
  state-info-text: "#1e40af"
  danger-action: "#9f1239"
  danger-action-hover: "#830e2e"
  device-ok: "#2d6a2d"
  device-busy: "#c2410c"
  device-down: "#9f1239"
  device-unknown: "#6b7280"
  nav-bg: "#1e1e2e"
  nav-text: "#cdd6f4"
  nav-active: "#89b4fa"
  nav-button: "#313244"
  status-accepted: "#0e7490"
  status-validated: "#0891b2"
  status-queued: "#1d4ed8"
  status-dispatched: "#6d28d9"
  status-printing: "#c2410c"
  status-success: "#166534"
  status-unverified: "#92400e"
  status-failed: "#9f1239"
  status-timeout: "#78350f"
  status-cancelled: "#374151"
  status-duplicate: "#4b5563"
typography:
  headline:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.05em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.35
  stat:
    fontFamily: "system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
  action:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.825rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.012em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  pill: "9999px"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  "2xl": "1.5rem"
  "3xl": "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    typography: "{typography.action}"
    rounded: "{rounded.md}"
    padding: "0.48rem 1.15rem"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.neutral-surface}"
  button-secondary:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.action}"
    rounded: "{rounded.md}"
    padding: "0.48rem 1.15rem"
    height: "38px"
  button-danger:
    backgroundColor: "{colors.danger-action}"
    textColor: "{colors.neutral-surface}"
    typography: "{typography.action}"
    rounded: "{rounded.md}"
    padding: "0.48rem 1.15rem"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text-muted}"
    typography: "{typography.action}"
    rounded: "{rounded.md}"
    padding: "0.48rem 1.15rem"
    height: "38px"
  button-disabled:
    backgroundColor: "{colors.neutral-subtle}"
    textColor: "{colors.neutral-text-muted}"
    rounded: "{rounded.md}"
    height: "38px"
  button-touch:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "0.65rem 1.45rem"
    height: "44px"
  card-panel:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  input-standard:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.7rem"
    height: "38px"
  input-compact:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.38rem 0.6rem"
    height: "34px"
  filter-chip:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.7rem"
    height: "34px"
  filter-chip-selected:
    backgroundColor: "{colors.state-info-surface}"
    textColor: "{colors.primary-hover}"
    rounded: "{rounded.pill}"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.status-success}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
    height: "24px"
  metric-tile:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-deep}"
    typography: "{typography.stat}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  metric-tile-attention:
    backgroundColor: "{colors.state-warning-surface}"
    textColor: "{colors.state-warning-text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  table-head:
    backgroundColor: "{colors.neutral-subtle}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.label}"
    padding: "0.62rem 0.75rem"
    height: "42px"
  table-cell:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.body}"
    padding: "0.68rem 0.75rem"
  code-canvas:
    backgroundColor: "{colors.canvas-ink}"
    textColor: "{colors.canvas-text}"
    typography: "{typography.mono}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  code-canvas-gutter:
    backgroundColor: "{colors.canvas-gutter}"
    textColor: "{colors.canvas-line}"
    typography: "{typography.mono}"
    width: "2.75rem"
  code-block:
    backgroundColor: "{colors.neutral-subtle}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  dialog-panel:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.xl}"
    padding: "{spacing.2xl}"
    width: "620px"
  drawer-panel:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    padding: "{spacing.lg}"
    width: "31rem"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.nav-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.38rem 0.6rem 0.38rem 0.85rem"
    height: "38px"
  nav-link-active:
    backgroundColor: "rgba(30, 102, 245, 0.15)"
    textColor: "{colors.neutral-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.38rem 0.6rem 0.38rem 0.85rem"
    height: "38px"
---

# Design System: PrintOps

## Overview

**Creative North Star: "The Lab Notebook"**

PrintOps feels like a well-kept clinical notebook: precise, calm, and trustworthy. Every element is a deliberate record, placed for rapid scanning rather than decoration. The interface recedes behind the operator's task while keeping physical-output consequences unmistakable.

The system is light-first and restrained. Familiar system typography, compact controls, quiet borders, and flat reading surfaces suit long shifts under fluorescent hospital lighting. Brand character comes from disciplined blue accents, exact spacing, bilingual resilience, and honest operational states — not visual spectacle. Every route is built from the same anatomy: a bounded measure, a ruled header, a body of surfaces, and an optional detail and footer region beneath it. Two pages of the same kind should differ in content, never in skeleton.

The notebook has two papers. Most of the product is light: white surfaces on page gray, read at a glance. Where the operator authors or inspects exact machine text — a template body, a webhook payload — the surface flips to the **Evidence Canvas**, a dark, line-numbered field that says *this is literal, and whitespace counts*. Motion is limited to short state feedback and spatial transitions that explain where an overlay or drawer came from, with a global reduced-motion fallback. The visual system rejects flashy SaaS gradients, terminal-dense data walls, generic component-library styling, and dark application chrome.

**Key Characteristics:**

- Light-first surfaces tuned for clinical workstations, with one sanctioned dark canvas for authored code
- A single route anatomy — bounded measure, ruled header, body, detail, footer — shared by every page
- Flat-by-default depth with elevation reserved for overlays, drawers, and consequential controls
- System-native sans-serif typography with monospace reserved for technical evidence
- One action-blue family, plus separate axes for job status and device condition
- Restrained surface corners with pills reserved for compact status and filtering
- Keyboard-complete controls, 44px touch targets, forced-colors support, and equal English/Thai support

## Colors

The palette is clinical and low-noise: cool neutrals carry structure, action blue carries interaction, and semantic colors communicate operational meaning with text or shape as a second channel. Tints and mixes are derived from the accent with `color-mix()` rather than added as new literals — the palette grows by dilution, not by invention.

### Primary

- **Action Blue** (#1e66f5): The sole interactive accent for primary actions, links, focus indicators, selected controls, and active navigation markers.
- **Action Blue Strong / Hover / Pressed** (#2563eb / #1654d1 / #1d4ed8): A compact state family for interactive emphasis. Use the observed state token that matches the component; do not improvise another blue.
- **Derived tints**: selection and hover washes are `color-mix(in srgb, var(--primary) N%, var(--neutral-surface))` — 3% for row hover, 4% for tinted heads, 15–40% for selected borders. Never hand-pick a pale blue when a mix expresses the same relationship.

### Semantic

- **Soft Green, Pale Amber, Muted Rose, Powder Blue, Warm Peach, and Slate** (#a6e3a1 / #f9e2af / #f38ba8 / #89b4fa / #fab387 / #9399b2): Broad success, warning, error, information, in-progress, and neutral families for surfaces, device state, and supportive feedback.
- **State Surface / Text Pairs** (#fee2e2 / #991b1b, #fef3c7 / #92400e, #e6f7e6 / #2d6a2d, #eff6ff / #1e40af): Accessible pale backgrounds with dark semantic text for alerts, inline validation, tinted metric tiles, and explanatory safety messages.
- **Consequence Rose** (#9f1239, hover #830e2e): Reserved for destructive actions and actions that may produce irreversible or physical consequences.

### Job Status

Eleven outlined statuses, each carrying its literal server string as text. Border and text share one contrast-safe color on white; the fill stays transparent.

- **Outlined Job Status Colors** (#0e7490 accepted / #0891b2 validated / #1d4ed8 queued / #6d28d9 dispatched / #c2410c printing / #166534 success / #92400e unverified / #9f1239 failed / #78350f timeout / #374151 cancelled / #4b5563 duplicate): every one clears 6:1 against white; the map in `statusColors.ts` records the measured ratio per status so a future swap is re-verified rather than assumed. `UNVERIFIED` is amber caution, never failure rose, because a page may already exist.

### Device Condition

A **separate axis** from job status, and deliberately so: a job status is a record of what happened to one print, a device condition is the live state of hardware or a service.

- **Device OK / Busy / Down / Unknown** (#2d6a2d / #c2410c / #9f1239 / #6b7280): rendered as a dot plus the condition as text. An unrecognised condition resolves to Unknown rather than being guessed.

### Evidence Canvas

The dark authoring surface, used only inside a code or payload editor.

- **Canvas Ink** (#111827): the editable field. Shares its value with Almost Black, the tooltip surface — the darkest plane in the system is one color.
- **Canvas Gutter** (#0f172a): the line-number rail, one step deeper than the field so the numbers read as furniture, not content.
- **Canvas Edge** (#334155): the rail divider and resting border.
- **Canvas Line** (#94a3b8): line numerals and placeholder text.
- **Canvas Text / Caret** (#e5e7eb / #93c5fd): authored content, and a blue caret that ties the canvas back to Action Blue.

### Neutral

- **Deep Navy** (#1e1e2e): Primary dark anchor for navigation, headings, and selected high-emphasis controls.
- **Page Gray** (#f5f5f5): Application canvas behind reading surfaces.
- **White Surface** (#ffffff): Cards, dialogs, fields, tables, and proof paper.
- **Paper White** (#f8fafc): Recessed working surfaces inside a white panel — sticky variable palettes, editor sidebars, inset reference regions. Use it where a region belongs to a panel but should not read as another card.
- **Warm Subtle Gray** (#f0f0f0): Table heads, gutters, secondary regions, disabled controls, and selected neutral bands.
- **Border Gray / Strong Border Gray** (#e5e7eb / #d1d5db): Structural separation and editable-control boundaries.
- **Body Gray / Muted Gray** (#374151 / #6b7280): Default and secondary text. Muted text must remain readable; never use placeholder contrast for operational information.
- **Almost Black** (#111827): Tooltips and other maximum-contrast floating surfaces.
- **Lavender Navigation Text / Dark Slate Navigation Button** (#cdd6f4 / #313244): Secondary content and controls on the dark navigation rail.

### Named Rules

**The One Accent Rule.** Action Blue is the only non-semantic accent. Its restraint makes focus, selection, and the next safe action immediately recognizable.

**The Dilution Rule.** New shades of an existing role are produced with `color-mix()` against `--primary`, `--neutral-surface`, or a state token — never typed as a fresh hex. A literal color in a stylesheet is a claim that no existing token could express it, and that claim is almost always false.

**The Literal Status Rule.** Never merge, rename, or imply a server status through color alone. Preserve the literal label, pair it with a contrast-safe outline or explicit text, and keep `UNVERIFIED` visually distinct from `FAILED`.

**The Two Axes Rule.** Job status and device condition are different vocabularies and must never borrow each other's colors or components. `StatusBadge` is for jobs; `StatusIndicator` and `StatusDot` are for devices and services.

**The Consequence Color Rule.** Rose signals destructive or physically consequential action, not ordinary emphasis. Routine primary actions remain blue or neutral.

## Typography

**Display Font:** System-native sans-serif with platform fallback.
**Body Font:** System-native sans-serif with platform fallback.
**Label/Mono Font:** System-native sans-serif for labels; system monospace for identifiers, code, payloads, and trace evidence.

**Character:** Neutral, immediate, and fatigue-resistant. A single sans-serif family keeps the interface familiar in English and Thai; monospace creates a distinct evidence layer without turning the whole product into a developer console. Body text sets `font-synthesis: none` and `text-rendering: optimizeLegibility` so neither script gets a faked weight.

### Hierarchy

- **Headline** (600, 1.5rem, 1.3): One page title per surface. Page titles carry `-0.015em` tracking and `text-wrap: pretty` so a two-line bilingual title breaks on sense, not on width.
- **Title** (600, 1rem, 1.4): Card, panel, dialog, and focused-workspace headings.
- **Stat** (700, 2rem, 1.2, tabular numerals): At-a-glance dashboard values only. A secondary metric row steps down to Headline size rather than inventing a rung between the two.
- **Body** (400, 0.875rem, 1.5): Forms, tables, descriptions, and operational copy. Prose measures cap at 72ch.
- **Action** (600, 0.825rem, 1.4, 0.012em): Button and control labels. The tracking is barely-there optical correction, not a style.
- **Label** (600, 0.75rem, 1.4): Compact metadata, table headers, field labels, and column names.
- **Mono** (400, 0.8rem, 1.35): Job IDs, template identifiers, URIs, payloads, printer addresses, and trace values. Inside the Evidence Canvas, line-height opens to 1.65 so line numbers stay legible against long wrapped rows.

### Named Rules

**The Single Family Rule.** Use system fonts only. Do not load display fonts or create a decorative headline layer.

**The Evidence Layer Rule.** Use monospace only where the exact string matters operationally; ordinary prose and labels stay sans-serif.

**The Thai Integrity Rule.** Uppercase and letter-spacing are Latin-only treatments and are **opt-in, never structural.** Table headers, field labels, fieldset legends, and nav group headings all render at `text-transform: none; letter-spacing: 0` — the earlier uppercase treatment was removed because it does nothing for Thai and breaks its glyph clusters. The `caps` prop on `Text` exists for Latin strings the product controls; it must never be applied to localized copy.

**The Wrapping Rule.** Operational strings wrap; they do not disappear. Cells, descriptions, and labels use `overflow-wrap: anywhere` and `text-overflow: clip` rather than an ellipsis, so a truncated identifier can never be mistaken for a complete one.

## Layout

### Route anatomy

Every page is the same skeleton, expressed by `PageScaffold` and the `.ops-page` contract. The scaffold is a grid of four named regions — **header, body, detail, footer** — separated by `--page-region-gap` (2rem, tightening to 1.25rem below 1024px). Within the body, sections are separated by `--page-section-gap` (1.25rem, tightening to 1rem). The detail and footer regions are introduced by a 1px top rule, so a page reads as ruled sheets rather than floating fragments.

Measure is bounded, not fluid. `--page-content-standard` (72rem) is the default reading width for forms, settings, and record pages; `--page-content-wide` (96rem) is for dense operational tables and split workspaces; a `full` variant exists for surfaces that genuinely own the viewport. All three center with `margin-inline: auto`. Prose inside a header, section description, or panel description caps at 72ch independently of the container.

The shell is a fixed navigation rail beside a scrolling main canvas. The rail is 200px at 1025px and above, with labels allowed to wrap rather than forcing the canvas to surrender width; `.app-main` reserves `scrollbar-gutter: stable` so content does not shift when a scrollbar appears.

### Responsive behavior

**1024px is the primary transition.** At and below it: multi-column grids collapse to one column, page headers and section headings stack their copy above their actions, resource toolbars go vertical, panels stack their header rows, drawers go full width, main padding drops to 1rem, and responsive tables become labelled record cards. Coarse pointers get the same treatment through `(pointer: coarse)`, independent of width.

Secondary steps handle the rest. 1100px reduces dense multi-column forms. 860px collapses editor/preview workspaces to one column and strips card chrome from list surfaces that have already become cards. 760px turns the navigation into an off-canvas drawer at `min(20rem, 88vw)`, tightens main padding to 0.75rem, and lets header actions grow to fill their row. 520px drops record-card cells to a single column, tightens padding again, and applies safe-area insets on all four edges. Webhooks additionally uses a container query on its workspace, which is the preferred tool for a component that must adapt to its own column rather than the viewport.

### Overflow discipline

Every flex and grid child sets `min-width: 0`; every grid track uses `minmax(0, 1fr)`. Tables scroll inside their own frame with `scrollbar-gutter: stable both-edges` and `overscroll-behavior-inline: contain`, so a horizontal table never drags the page with it. Action rows and bilingual labels wrap rather than compress.

**The One Task Per Mobile View Rule.** On narrow screens, show the list or the focused maintenance task — not both side by side. Navigation back to the parent context must remain explicit.

**The Touch Floor Rule.** Interactive targets are at least 44px on coarse pointers and below 1024px, even when their desktop visual footprint remains compact. Text inputs additionally take `font-size: max(1rem, 16px)` there, because iOS zooms anything smaller.

**The One Skeleton Rule.** A new page composes `PageScaffold`, `PageHeader`, `PageSection`, and `PageFooter`. It does not invent a competing page frame, and it does not add another global stylesheet to correct one.

## Elevation & Depth

The system is flat by default, and the shared experience layer enforces it: panels, cards, and record cards are explicitly reset to `box-shadow: none`. Page Gray behind White surfaces, quiet borders, and selected-state tints carry nearly all hierarchy. Shadows appear only when a surface truly floats above the current plane, moves over it, or must be found immediately.

### Shadow Vocabulary

- **Subtle Surface** (`box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05)`): Rare separation for a sticky action bar or preview paper when a border alone is insufficient.
- **Floating Panel** (`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08)`): Login and splash panels, drawers.
- **Popover** (`box-shadow: 0 8px 24px rgba(17, 24, 39, 0.14)`): Dialogs, menus, and anchored floating content that must remain distinct over white surfaces.
- **Drawer** (`box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12)`): Side drawers with directional depth.
- **Action Lift** (`box-shadow: 0 3px 8px rgba(30, 102, 245, 0.30)`): Hover feedback on the primary button; the danger button uses the rose equivalent at 0.24 alpha. It disappears when pressed or disabled.

Backdrops are dark translucent neutrals, not blurs: `rgba(30, 30, 46, 0.45)` for dialogs, `rgba(17, 24, 39, 0.42)` for drawers, `rgba(17, 24, 39, 0.72)` for the full-screen paper preview, which is darker because the artifact behind it is the point.

### Named Rules

**The Flat-By-Default Rule.** Cards and page regions are border-defined at rest. Add a shadow only when the element floats above, moves over, or must be distinguished from the current plane.

**The Directional Depth Rule.** Drawers cast depth away from their attached edge; centered overlays use ambient depth. Shadow direction must explain spatial origin.

**The Rule Line Rule.** Within a page, separation is a 1px border in Border Gray — under the header, above the detail and footer regions, between table rows, around every panel. Depth is for things that leave the page; rules are for things that structure it.

## Shapes

The dominant form language is gently squared: 4px for compact internal elements, 6px for controls, and 8px for cards, panels, tables, and the Evidence Canvas. Borders are thin and quiet, becoming stronger only for fields, selected controls, and focus. Circular geometry is reserved for avatars, condition dots, metric dots, and iconography.

12px is the floating-surface corner: dialogs and the login and splash panels. The larger radius is what distinguishes a surface that arrived over the page from one that belongs to it — do not spread it to ordinary cards.

Full pills are a functional exception for filter chips, outlined status badges, and count bubbles. They distinguish compact categorical state from rectangular actions.

The active navigation item is marked by a 3px Action Blue bar with a 0 2px 2px 0 radius, pinned to the rail edge and scaling in on the Y axis — the one piece of decorative geometry in the system, and it is load-bearing for orientation.

**The Restrained Corner Rule.** Use 4–8px corners for ordinary surfaces and controls, 12px for floating overlays, and full pills only for status or filtering — never for primary buttons or large containers.

## Components

Components feel precise and operator-grade: compact on desktop, comfortably targetable on touch devices, visibly focusable, and explicit about disabled or busy state.

### Shared Component Architecture

The implementation follows a composition ladder. Atoms, molecules, and composites live in `apps/web/src/components/ui`; page-frame molecules and organisms (`PageHeader`, `PageSection`, `PageFooter`, `SectionHeading`, `Pagination`, `SearchField`, `SelectFilter`, `PageScaffold`, `ResourceToolbar`) live in `components/molecules` and `components/organisms`. Everything public is re-exported from `components/ui/index.ts`; pages import from there and keep only feature-specific behavior locally.

Repeated layout uses `Stack`, `Inline`, and `Grid` token gaps rather than page-local margin chains. A responsive `DataTable` keeps one semantic DOM tree and becomes labelled record cards on narrow screens; desktop and mobile must not mount duplicate interactive forms. New shared patterns require typed props, accessible semantics, token-based styling, a representative migration, and a semantic test. The maintenance guide and component inventory live in `apps/web/src/components/ui/README.md`.

### Focus

Three idioms, chosen by surface rather than by component:

- **Controls on light surfaces** (buttons, chips, tabs, links, icon buttons, table frames): `outline: 2px solid var(--primary)` at `outline-offset: 2px`.
- **Editable fields**: the border shifts to Action Blue and a translucent halo appears — `outline: 2px solid color-mix(in srgb, var(--primary) 38%, transparent)` at `outline-offset: 1px`. The halo reads as a state change on the field itself rather than a ring around it.
- **Controls on the dark rail**: `outline: 2px solid #89b4fa`, because Action Blue does not separate from Deep Navy.

Never remove focus without replacing it. The skip link is the first focusable element and translates into view on focus.

### Buttons

- **Sizes:** 32px compact, 38px default, 44px large — and 44px minimum for every size on coarse pointers or below 1024px.
- **Primary:** Flat Action Blue with white text for direct task progression. Hover deepens to Action Blue Hover and adds the Action Lift shadow; the base state carries no shadow.
- **Secondary:** White surface, strong neutral border, and body text color; hover fills with Warm Subtle Gray.
- **Danger:** Consequence Rose fill with white text for destructive or physically consequential confirmation.
- **Ghost:** Transparent and quiet for dismissal, tertiary navigation, and low-emphasis actions; hover fills with the pale info surface.
- **Disabled:** Full opacity with a Warm Subtle Gray fill, quiet border, and muted text — a disabled control stays readable, because *why* it is disabled is often the operator's next question. It never dims to a translucent ghost.
- **Busy:** Disables repeat activation, exposes `aria-busy`, and shows the inline spinner.
- **Touch feedback:** Under `(hover: none)`, the active state drops to 0.76 opacity, since there is no hover to acknowledge the press.

### Chips and Badges

- **Filter chips:** White outlined pills with muted text, 34px tall. Selected chips take the pale info surface, deeper blue text, a mixed blue border, and `aria-pressed`.
- **Status badges:** Transparent outlined pills carrying the literal job status as text at three sizes (24 / 26 / 30px). Border and text share the status color; status is never conveyed by hue alone.
- **Metadata badges:** 6px rectangles on Warm Subtle Gray with tone variants tied to the state pairs. Use these when the item is metadata rather than an interactive filter or job status.

### Cards, Panels, and Sections

- **Corner Style:** 8px with a 1px Border Gray edge.
- **Background:** White on Page Gray; `Panel subtle` recesses to a mix of Warm Subtle Gray and white; Paper White is for inset working regions.
- **Shadow Strategy:** Flat at rest, enforced globally. Use the shadow vocabulary only for genuine elevation.
- **Internal Padding:** 1.25rem by default, dropping to 1rem below 760px. Panel footers are separated by a rule and pushed to the end.
- **`SectionHeading`** keeps a title, its optional scope control, and its description on one wrapping baseline, with actions at the far end — the title and scope read as one phrase and wrap together rather than being pushed apart.

### Data Tables

- **Head:** 42px, Warm Subtle Gray, Label typography at natural case with no tracking, closed by a Strong Border Gray rule. Header text does not hyphenate or break mid-word.
- **Cells:** 0.68rem vertical padding, wrapping text, `max-width: 28rem`, separated by Border Gray rules. Action cells shrink to content and stay on one line.
- **States:** Hover and `:focus-within` wash rows at 3% Action Blue; selected rows take the pale info surface. Layout is `auto`, so columns follow content rather than a fixed grid.
- **Responsive:** With `responsive`, at 1024px and below the head is visually hidden and each row becomes a bordered 8px card whose cells become label/value pairs from `data-label`, at a 35% / 1fr split that widens to 42% at 760px and stacks entirely at 520px. An empty table drops the card chrome so the state panel speaks for itself.

### Inputs and Fields

- **Style:** White background, 6px corners, Strong Border Gray edge, body typography, 38px standard or 34px compact.
- **Hover:** Border deepens to Muted Gray.
- **Focus:** The field focus idiom above.
- **Error:** Consequence Rose border, with help and error text connected through `aria-describedby` and `aria-invalid`.
- **Disabled:** Warm Subtle Gray fill with muted text.
- **Mobile:** At least 16px text and 44px height to prevent browser zoom and missed taps; checkboxes and radios grow to 1.25rem.
- **`FormField`** owns the label / hint / error wiring. `Input` with `leading` or `trailing` content forms an input group whose focus ring surrounds the whole group.

### Metrics

`MetricTile` and `MetricGrid` render at-a-glance counts on auto-fitting tracks (11rem primary, 9rem secondary). Values use tabular numerals so columns of digits align. Tone comes from the **value, not the concept**: a zero `UNVERIFIED` count is an ordinary tile, and only a non-zero one takes the attention treatment. Attention and critical tiles tint the whole surface rather than adding a colored edge bar, so they are findable across the room, and a dot beside the label keeps the meaning off color alone.

### The Evidence Canvas

The dark, line-numbered editor shared by the Templates workspace and the Webhooks payload editor. A `2.75rem` gutter column sits beside a monospace field on the Canvas Ink plane, divided by Canvas Edge, with numerals in Canvas Line, authored text in Canvas Text, and a blue caret. Line-height opens to 1.65 and the gutter is `user-select: none`, so copying the content never picks up the numbers. Focus moves the border to Action Blue; invalid content moves it to the danger text color, and the two states must remain distinguishable when both apply. Selection uses a 42% Action Blue mix.

Use it only for content the operator authors or inspects literally — template bodies, JSON payloads. Read-only evidence that is merely displayed uses `CodeBlock`, which stays light: Warm Subtle Gray, 6px corners, wrapping, and an optional 22rem scroll cap.

### Navigation

- **Style:** Deep Navy fixed rail with Lavender text, 16px line icons, and grouped sections. Group headings are full-strength Lavender at 700 with a hairline rule running out to the rail edge — a header, not a caption. The collapsible admin group rotates its chevron 90°.
- **Active:** White text at 600, a 15% Action Blue band, and the 3px leading marker. Color is reinforced by weight and shape.
- **Focus:** Powder Blue outline, since Action Blue disappears into the rail.
- **Mobile:** Off-canvas drawer at `min(20rem, 88vw)` with overlay, Escape and close behavior, safe-area spacing, and a persistent 44px trigger.

### Overlays

- **Dialogs:** White 12px panel at up to 620px, 1.5rem padding, over a `rgba(30, 30, 46, 0.45)` backdrop. Use the native `<dialog>` primitive for focus trapping, inert background, and Escape semantics.
- **Drawers:** `min(31rem, 100vw - 2rem)`, edge-anchored, with a ruled header and footer and a scrolling body; full width at 1024px and below.
- **Consequential actions:** Restate the target and outcome before the final action. Physical printing requires a separate confirmation that identifies printer, template, and copy count and explicitly acknowledges physical output.
- **Mobile:** Overlays anchor toward the bottom edge with safe-area padding, cap at `min(88dvh, 760px)`, and their actions wrap into targets that fill from 10rem.

### Alerts and States

- **Alerts:** Pale semantic surface, semantic border, and dark semantic text at 8px corners. Errors and warnings are assertive; success and information are polite status regions. Retry and dismissal stay keyboard reachable with explicit accessible names.
- **Sticky action bars:** A live selection or unsaved editor state pins to the bottom on a pale info surface with a mixed blue border and the Subtle Surface shadow, offset by `env(safe-area-inset-bottom)` so it never covers the last row or sits under a home indicator.
- **Loading, empty, and error:** Reusable localized state panels with a clear title, a concise next step, and an optional action. Loading uses a polite live status; errors expose recovery and technical detail without overwhelming routine operators; empty states distinguish "nothing exists yet" from "no match for these filters."

### Auth surfaces

Login and splash are the one place the notebook shows its paper. A 28px graph-paper grid — Action Blue hairlines at 3.5% opacity over Page Gray — fills the viewport behind a 380px floating panel with the Floating Panel shadow. It is the only decorative field in the product, it is scoped to the unauthenticated shell, and it never appears behind operational content.

## Do's and Don'ts

### Do

- **Do** compose new pages from `PageScaffold`, `PageHeader`, `PageSection`, and `PageFooter`, and new surfaces from the primitives exported by `components/ui/index.ts`.
- **Do** reference tokens as `var(--token)` and derive new shades with `color-mix()` against an existing token.
- **Do** use White reading surfaces on Page Gray, with 1px rules for in-page structure and shadows only for surfaces that leave the page.
- **Do** keep job status and device condition on separate components and separate color axes.
- **Do** preserve literal operational states, especially `UNVERIFIED`, and pair every status color with text, outline, shape, or icon.
- **Do** keep proof generation and physical printing visibly separate; generating or refreshing a proof must never trigger output.
- **Do** require a distinct confirmation for every physical print and block printing while printer readiness is offline or unknown.
- **Do** set `min-width: 0` on flex and grid children and `minmax(0, 1fr)` on grid tracks, and let operational strings wrap instead of truncating.
- **Do** maintain visible focus, keyboard operation, 44px touch targets, reduced-motion behavior, forced-colors support, and bilingual EN/TH resilience.
- **Do** use mobile cards or focused next-step views when a dense desktop table or split workspace would compete for attention.

### Don't

- **Don't** write a literal hex, rem, or shadow value into a stylesheet when a token expresses it. `#1e66f5` is `var(--primary)`.
- **Don't** add another global override stylesheet to correct a page. Fix the shared component, or scope the fix to the feature that owns it.
- **Don't** invent a competing page frame, a fifth breakpoint for one surface, or a one-off font size.
- **Don't** use color gradients, decorative glows, oversized display type, or animation as decoration. The auth graph-paper field is the single sanctioned exception and does not generalize.
- **Don't** extend the Evidence Canvas beyond authored code and payload editing. Application chrome, dashboards, tables, and forms stay light.
- **Don't** create terminal-dense dashboards or expose expert payload controls as the default operator workflow.
- **Don't** uppercase or letter-space anything that can hold localized copy — table headers, field labels, legends, nav headings, or badge text.
- **Don't** use color as the only communicator, or lower contrast for secondary operational text.
- **Don't** place shadows on ordinary table rows, section headings, or static cards.
- **Don't** use pill-shaped primary buttons or large rounded containers; pills belong to compact status and filtering.
- **Don't** dim a disabled control until its label is unreadable — a disabled state still has to explain itself.
- **Don't** truncate critical identifiers or safety copy without a discoverable full value.
