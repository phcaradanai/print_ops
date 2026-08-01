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
  neutral-subtle: "#f0f0f0"
  neutral-border: "#e5e7eb"
  neutral-border-strong: "#d1d5db"
  neutral-text: "#374151"
  neutral-text-muted: "#6b7280"
  neutral-inverse: "#111827"
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
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
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
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.48rem 1.1rem"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-deep}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.48rem 1.1rem"
    height: "38px"
  button-danger:
    backgroundColor: "{colors.danger-action}"
    textColor: "{colors.neutral-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.48rem 1.1rem"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.48rem 1.1rem"
    height: "38px"
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
  filter-chip:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.6rem"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.status-success}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.nav-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.38rem 0.6rem 0.38rem 0.85rem"
  nav-link-active:
    backgroundColor: "rgba(30, 102, 245, 0.15)"
    textColor: "{colors.neutral-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.38rem 0.6rem 0.38rem 0.85rem"
---

# Design System: PrintOps

## Overview

**Creative North Star: "The Lab Notebook"**

PrintOps feels like a well-kept clinical notebook: precise, calm, and trustworthy. Every element is a deliberate record, placed for rapid scanning rather than decoration. The interface recedes behind the operator's task while keeping physical-output consequences unmistakable.

The system is light-first and restrained. Familiar system typography, compact controls, quiet borders, and flat reading surfaces suit long shifts under fluorescent hospital lighting. Brand character comes from disciplined blue accents, exact spacing, bilingual resilience, and honest operational states—not visual spectacle.

Motion is limited to short state feedback and spatial transitions that explain where an overlay or drawer came from. All motion has an instant reduced-motion fallback. The visual system rejects flashy SaaS gradients, terminal-dense data walls, generic component-library styling, and dark-first interfaces.

**Key Characteristics:**

- Light-first surfaces tuned for clinical workstations
- Flat-by-default depth with elevation reserved for overlays, drawers, and consequential controls
- System-native sans-serif typography with monospace reserved for technical evidence
- One action-blue family plus explicit semantic state colors
- Restrained surface corners with pills reserved for compact status and filtering
- Keyboard-complete controls, 44px touch targets, and equal English/Thai support

## Colors

The palette is clinical and low-noise: cool neutrals carry structure, action blue carries interaction, and semantic colors communicate operational meaning with text or icons as a second channel.

### Primary

- **Action Blue** (#1e66f5): The sole interactive accent for primary actions, links, focus indicators, selected controls, and active navigation markers.
- **Action Blue Strong / Hover / Pressed** (#2563eb / #1654d1 / #1d4ed8): A compact state family for interactive emphasis. Use the observed state token that matches the component; do not improvise another blue.

### Semantic

- **Soft Green, Pale Amber, Muted Rose, Powder Blue, Warm Peach, and Slate** (#a6e3a1 / #f9e2af / #f38ba8 / #89b4fa / #fab387 / #9399b2): Broad success, warning, error, information, in-progress, and neutral families for surfaces, device state, and supportive feedback.
- **State Surface / Text Pairs** (#fee2e2 / #991b1b, #fef3c7 / #92400e, #e6f7e6 / #2d6a2d, #eff6ff / #1e40af): Accessible pale backgrounds with dark semantic text for alerts, inline validation, and explanatory safety messages.
- **Outlined Job Status Colors** (#0e7490 / #0891b2 / #1d4ed8 / #6d28d9 / #c2410c / #166534 / #92400e / #9f1239 / #78350f / #374151 / #4b5563): Each server status keeps its literal label and a distinct, contrast-safe outline/text color. `UNVERIFIED` is amber caution, never failure rose, because a page may already exist.
- **Consequence Rose** (#9f1239, hover #830e2e): Reserved for destructive actions and actions that may produce irreversible or physical consequences.

### Neutral

- **Deep Navy** (#1e1e2e): Primary dark anchor for navigation, headings, and selected high-emphasis controls.
- **Page Gray** (#f5f5f5): Application canvas behind reading surfaces.
- **White Surface** (#ffffff): Cards, dialogs, fields, tables, and proof paper.
- **Warm Subtle Gray** (#f0f0f0): Table heads, gutters, secondary regions, and selected neutral bands.
- **Border Gray / Strong Border Gray** (#e5e7eb / #d1d5db): Structural separation and editable-control boundaries.
- **Body Gray / Muted Gray** (#374151 / #6b7280): Default and secondary text. Muted text must remain readable; never use placeholder contrast for operational information.
- **Almost Black** (#111827): Tooltips and other maximum-contrast floating surfaces.
- **Lavender Navigation Text / Dark Slate Navigation Button** (#cdd6f4 / #313244): Secondary content and controls on the dark navigation rail.

### Named Rules

**The One Accent Rule.** Action Blue is the only non-semantic accent. Its restraint makes focus, selection, and the next safe action immediately recognizable.

**The Literal Status Rule.** Never merge, rename, or imply a server status through color alone. Preserve the literal label, pair it with a contrast-safe outline or explicit text, and keep `UNVERIFIED` visually distinct from `FAILED`.

**The Consequence Color Rule.** Rose signals destructive or physically consequential action, not ordinary emphasis. Routine primary actions remain blue or neutral.

## Typography

**Display Font:** System-native sans-serif with platform fallback.
**Body Font:** System-native sans-serif with platform fallback.
**Label/Mono Font:** System-native sans-serif for labels; system monospace for identifiers, code, payloads, and trace evidence.

**Character:** Neutral, immediate, and fatigue-resistant. A single sans-serif family keeps the interface familiar in English and Thai; monospace creates a distinct evidence layer without turning the whole product into a developer console.

### Hierarchy

- **Headline** (600, 1.5rem, 1.3): One page title per surface.
- **Title** (600, 1rem, 1.4): Card, panel, dialog, and focused-workspace headings.
- **Stat** (700, 2rem, 1.2): At-a-glance dashboard values only.
- **Body** (400, 0.875rem, 1.5): Forms, tables, descriptions, and operational copy.
- **Label** (600, 0.75rem, 1.4, 0.05em tracking where the script permits): Compact metadata and column labels. Do not force uppercase or tracking on Thai text.
- **Mono** (400, 0.8rem, 1.35): Job IDs, template identifiers, URIs, payloads, printer addresses, and trace values.

### Named Rules

**The Single Family Rule.** Use system fonts only. Do not load display fonts or create a decorative headline layer.

**The Evidence Layer Rule.** Use monospace only where the exact string matters operationally; ordinary prose and labels stay sans-serif.

**The Thai Integrity Rule.** Uppercase and letter-spacing are optional Latin treatments, never global label requirements. Thai glyph clusters must remain unmodified and layouts must tolerate longer localized copy.

## Layout

The application shell uses a fixed 200px navigation rail and a scrollable main canvas with 1.25rem desktop padding. Content surfaces fill the available width, contain their own overflow, and use a 0.5–1rem rhythm for control groups and 1–2rem for sections. Dense operational tables may scroll horizontally on intermediate widths, but intentionally adapted mobile surfaces become cards or stacked regions instead of miniature tables.

Responsive behavior is progressive rather than merely compressed. Around 1100px, dense multi-column forms reduce column count. Around 860px, editor/preview workspaces become one column. At 760px and below, the navigation becomes an off-canvas drawer, main padding tightens, controls expose at least 44px touch targets, dialogs anchor toward the bottom edge, and focused tasks stop competing beside library or list views. At 520px and below, the navigation may occupy the full viewport width and page padding tightens again.

Use `minmax(0, 1fr)` for resilient grid tracks, allow action rows and bilingual labels to wrap, and protect the page from horizontal overflow. Safe-area insets are part of mobile spacing, not an afterthought.

**The One Task Per Mobile View Rule.** On narrow screens, show the list or the focused maintenance task—not both side by side. Navigation back to the parent context must remain explicit.

**The Touch Floor Rule.** Interactive targets are at least 44px on coarse pointers and mobile widths, even when their desktop visual footprint remains compact.

## Elevation & Depth

The system is flat by default. Page Gray behind White surfaces, quiet borders, and selected-state tints create most hierarchy. Shadows appear when a surface truly floats, moves above the current task, or needs consequence emphasis.

### Shadow Vocabulary

- **Subtle Surface** (`box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05)`): Rare separation for compact metrics or preview paper when a border alone is insufficient.
- **Floating Panel** (`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08)`): Dialogs, login panels, and overlays.
- **Popover** (`box-shadow: 0 8px 24px rgba(17, 24, 39, 0.14)`): Menus and anchored floating content that must remain distinct over white surfaces.
- **Drawer** (`box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12)`): Side drawers with directional depth.
- **Action Lift** (`box-shadow: 0 3px 8px rgba(30, 102, 245, 0.30)`): Hover feedback on the canonical primary button; it disappears when pressed or disabled.

### Named Rules

**The Flat-By-Default Rule.** Cards and page regions are border-defined at rest. Add a shadow only when the element floats above, moves over, or must be distinguished from the current plane.

**The Directional Depth Rule.** Drawers cast depth away from their attached edge; centered overlays use ambient depth. Shadow direction must explain spatial origin.

## Shapes

The dominant form language is gently squared: 4px for compact internal elements, 6px for controls, and 8px for cards and panels. Borders are thin and quiet, becoming stronger only for fields, selected controls, and focus. Circular geometry is reserved for avatars, reachability dots, and iconography.

Full pills are a functional exception for filter chips and outlined status badges. They distinguish compact categorical state from rectangular actions. Dialogs may use a slightly larger 12px radius when implemented through the shared native dialog primitive; do not spread that softness to ordinary cards.

**The Restrained Corner Rule.** Use 4–8px corners for ordinary surfaces and controls. Use full pills only for status or filtering, never for primary buttons or large containers.

## Components

Components feel precise and operator-grade: compact on desktop, comfortably targetable on touch devices, visibly focusable, and explicit about disabled or busy state.

### Buttons

- **Shape:** 6px corners with compact desktop height and a 44px touch target on coarse pointers.
- **Primary:** Action Blue with white text for direct task progression. The shared button adds a restrained blue lift on hover and returns to the base plane when pressed.
- **Secondary:** White surface, strong neutral border, and Deep Navy text; shifts toward Action Blue on hover.
- **Danger:** Consequence Rose fill with white text for destructive or physically consequential confirmation.
- **Ghost:** Transparent and quiet for dismissal, tertiary navigation, and low-emphasis actions.
- **Focus / Busy / Disabled:** Every variant receives a 2px Action Blue focus outline. Busy disables repeat activation and exposes `aria-busy`; disabled controls remove lift and reduce opacity.

### Chips

- **Filter chips:** White outlined pills with muted text. Selected chips use a pale blue tint, darker blue text, and `aria-pressed`.
- **Status badges:** Transparent outlined pills with the literal status as text. Border and text share a contrast-safe status color; status is never conveyed by hue alone.
- **Engine and metadata tags:** Compact 4px rectangles on a subtle neutral surface. Use these when the item is metadata rather than an interactive filter or operational status.

### Cards / Containers

- **Corner Style:** 8px with a 1px neutral border.
- **Background:** White on Page Gray.
- **Shadow Strategy:** Flat at rest; use the shadow vocabulary only for genuine elevation.
- **Internal Padding:** 1.25rem by default, reducing only in dense or narrow layouts.

### Inputs / Fields

- **Style:** White background, 6px corners, strong neutral border, and Body typography.
- **Focus:** Action Blue border plus a restrained translucent focus halo. Never remove focus without replacing it.
- **Error:** Consequence Rose border and halo, with connected help/error text through `aria-describedby` and `aria-invalid`.
- **Mobile:** Text fields, selects, and textareas use at least 16px text and 44px height to prevent browser zoom and missed taps.

### Alerts

- **Style:** Pale semantic surface, semantic border, and dark semantic text. Errors and warnings are assertive; success and information are polite status regions.
- **Actions:** Retry and dismissal remain keyboard reachable and carry explicit accessible names.

### Navigation

- **Style:** Deep Navy fixed rail with Lavender text, small line icons, and grouped administrative sections.
- **Active:** White text, a translucent blue band, and a 3px Action Blue leading marker. Color is reinforced by weight and shape.
- **Mobile:** Off-canvas drawer with overlay, Escape/close behavior, safe-area spacing, and a persistent 44px navigation trigger.

### Dialogs and Confirmations

- **Style:** White floating panel over a dark translucent backdrop. Use the native dialog primitive when possible for focus trapping, inert background, and Escape semantics.
- **Consequential actions:** Restate the target and outcome before the final action. Physical printing requires a separate confirmation that identifies printer, template, and copy count and explicitly acknowledges physical output.
- **Mobile:** Actions wrap into large targets and the panel remains within the dynamic viewport.

### Loading, Empty, and Error States

- **Style:** Reusable, localized state panels with a clear title, concise next step, and optional action.
- **Behavior:** Loading uses polite live status; errors expose recovery and technical detail without overwhelming routine operators; empty states explain whether the system is empty or filters found no match.

## Do's and Don'ts

### Do

- **Do** use White reading surfaces on Page Gray and quiet borders for primary structure.
- **Do** preserve literal operational states, especially `UNVERIFIED`, and pair every status color with text, outline, shape, or icon.
- **Do** keep proof generation and physical printing visibly separate; generating or refreshing a proof must never trigger output.
- **Do** require a distinct confirmation for every physical print and block printing while printer readiness is offline or unknown.
- **Do** use shared Button, Dialog, Alert, FormField, PageState, and StatusBadge primitives where they fit.
- **Do** maintain visible focus, keyboard operation, 44px touch targets, reduced-motion behavior, and bilingual EN/TH resilience.
- **Do** use mobile cards or focused next-step views when a dense desktop table or split workspace would compete for attention.

### Don't

- **Don't** use gradients, decorative glows, oversized display type, or animation as decoration.
- **Don't** create terminal-dense dashboards or expose expert payload controls as the default operator workflow.
- **Don't** default to dark mode in fluorescent clinical environments.
- **Don't** invent new accent colors or arbitrary one-off font sizes when a token already serves the role.
- **Don't** use color as the only communicator or lower contrast for secondary operational text.
- **Don't** place shadows on ordinary table rows, section headings, or static cards.
- **Don't** use pill-shaped primary buttons or large rounded containers; pills belong to compact status and filtering.
- **Don't** truncate critical identifiers or safety copy without a discoverable full value.
