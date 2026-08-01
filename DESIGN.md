---
name: PrintOps
description: Hospital print gateway dashboard — clinical, calm, precise.
colors:
  primary: "#1e66f5"
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
  nav-bg: "#1e1e2e"
  nav-text: "#cdd6f4"
  nav-active: "#89b4fa"
  nav-button: "#313244"
typography:
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.35
  heading:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
  stat:
    fontFamily: "system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.05em"
    textTransform: "uppercase"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
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
    backgroundColor: "{colors.neutral-deep}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "0.7rem 0.9rem"
  stat-card:
    backgroundColor: "{colors.neutral-surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.2xl}"
  status-badge:
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  nav-link:
    textColor: "{colors.nav-text}"
    typography: body
  nav-link-active:
    textColor: "{colors.nav-active}"
    typography: body
---

# Design System: PrintOps

## 1. Overview

**Creative North Star: "The Lab Notebook"**

PrintOps feels like a well-kept clinical notebook — precise, clean, and trustworthy. Nothing decorative. Every element is a deliberate record, placed with care and easy to read at a glance. The interface recedes into the background of the operator's workflow, present only when needed.

The aesthetic is quiet and restrained. Colors are muted — Catppuccin-inspired pastels tightened into a hospital-appropriate palette. Typography is system-native, fast to render, comfortable to read under fluorescent light. Cards and surfaces are flat at rest; the only shadows are the faintest lift on panels that float above the page (login, popovers). Motion is reduced to state-change fades — no choreography, no entrance animations.

This system explicitly rejects: flashy SaaS gradients, terminal-dense data walls, generic Material Design defaults, and dark interfaces that strain eyes under hospital lighting.

**Key Characteristics:**
- Light-first, dark-optional color scheme tuned for fluorescent-lit clinical environments
- Flat-by-default elevation; shadows reserved for floating surfaces
- Single system sans-serif font stack — no display/body pairing
- 6-color semantic palette for job status, down from 10 — clarity over decoration
- Restrained rounded corners (4–8px) — clinical precision, not soft-playfulness
- WCAG 2.1 AA contrast minimum; all motion respects `prefers-reduced-motion`

## 2. Colors

A muted, clinical palette derived from Catppuccin pastels, tightened for hospital readability. One accent blue carries all interactive weight; everything else is neutral or semantic.

### Primary
- **Action Blue** (#1e66f5): Links, primary stat accent, active indicators. Used sparingly — no more than 5% of any given screen. Its rarity is the point.

### Semantic
- **Soft Green** (#a6e3a1): Success states. Job completed without error.
- **Pale Amber** (#f9e2af): Warning states. Timeout, retry pending, degraded but not failed.
- **Muted Rose** (#f38ba8): Error states. Job failed, printer unreachable, authentication rejected.
- **Powder Blue** (#89b4fa): Info/processing states. Queued, dispatched, accepted, validated — anything in-flight.
- **Warm Peach** (#fab387): Active progress. Currently printing, actively transferring — a running process, distinct from queued.
- **Slate** (#9399b2): Neutral/terminal states. Cancelled, duplicate returned — ended without success or failure.

### Neutral
- **Deep Navy** (#1e1e2e): Primary text, navigation background, primary button fill. The darkest surface — anchors the left nav and headings.
- **Page Gray** (#f5f5f5): Page background. Cool enough to feel clinical, warm enough to avoid sterility under fluorescent light.
- **White** (#ffffff): Card surfaces, login panel, table rows. The primary reading surface.
- **Warm Gray** (#f0f0f0): Table headers, subtle section dividers. Slightly warmer than page gray for gentle contrast.
- **Muted Gray** (#e5e7eb): Panel borders, section separators. Disappears at a glance, present on inspection.
- **Soft Gray** (#d1d5db): Input borders, popover borders. Strong enough to define editable regions.
- **Dark Gray** (#374151): Labels, secondary headings. One step below Deep Navy for hierarchy without going full black.
- **Medium Gray** (#6b7280): Muted text, subtitles, hints. Readable but not demanding.
- **Almost Black** (#111827): Popover backgrounds, tooltip surfaces. Maximum contrast for floating content on a light page.

### Navigation (Catppuccin Mocha-derived)
- **Lavender Tint** (#cdd6f4): Default nav link text. Soft, legible on dark background.
- **Powder Blue** (#89b4fa): Active nav link, brand title, session role. Reused from semantic info — same blue, different context.
- **Dark Slate** (#313244): Nav button background. Slightly lifted from Deep Navy for tactile affordance.

### Named Rules
**The One Accent Rule.** Action Blue (#1e66f5) is the only accent color outside the semantic palette. No secondary accent, no tertiary. Its restraint signals precision.

**The Five-Color Status Rule.** Job status uses exactly six semantic colors (green/amber/rose/blue/peach/slate), never more. The original ten-color system is prohibited. Group related states under the same color: ACCEPTED/VALIDATED → Info, QUEUED/DISPATCHED → Info, PRINTING → Progress, SUCCESS → Success, FAILED → Error, TIMEOUT → Warning, CANCELLED/DUPLICATE_RETURNED → Neutral.

## 3. Typography

**Font:** System-native sans-serif (`system-ui, sans-serif`) for all text. No display/body pairing — one family carries headings, labels, body, data, and navigation. Monospace (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`) reserved for code, job IDs, and technical data.

**Character:** Neutral, fast, comfortable. The system font renders instantly with no FOUT, and its familiarity lets operators focus on content rather than styling.

### Hierarchy
- **Heading** (600, 1.5rem, 1.3): Page titles. One per page.
- **Subheading** (1rem): Panel headings, such as a preview title, where a page heading would overstate the hierarchy.
- **Stat** (700, 2rem, 1.2): Dashboard metric values. Large enough for at-a-glance scanning, not decorative.
- **Body** (400, 0.875rem, 1.5): Table cells, list items, paragraph text. Comfortable reading size under fluorescent light.
- **Label** (600, 0.75rem, 1.4, 0.05em letter-spacing, uppercase): Stat labels, table headers, form labels. Compact but legible.
- **Mono** (400, 0.8rem, 1.35): Job IDs, URIs, code blocks, technical values. Slightly smaller than body for data density without clutter.

### Named Rules
**The Single Family Rule.** One font family for everything except code. No display/body pairing. No web font loading — system fonts render instantly and never shift layout.

## 4. Elevation

Flat-by-default. Surfaces share the same plane; hierarchy is conveyed through background color shifts (White on Page Gray), not shadows. The default state of every card and panel is shadow-free.

### Shadow Vocabulary
Only three shadows exist in the entire system, and all are reserved for surfaces that float above the page:
- **Card Rest** (`0 1px 3px rgba(0,0,0,0.1)`): Stat cards on the dashboard. Barely perceptible — just enough to separate from the page background.
- **Panel Float** (`0 8px 24px rgba(0,0,0,0.08)`): Login panel, dialog overlays. A clear but gentle lift.
- **Popover** (`0 10px 24px rgba(0,0,0,0.18)`): Hover tooltips and popovers. Darker shadow compensates for the dark background (#111827).

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to context (floating above the page). If it's not a card, popover, or overlay, it has no shadow.

## 5. Components

### Buttons
- **Shape:** Rounded corners at 6px — clinical, not playful.
- **Primary:** Deep Navy (#1e1e2e) background, White text, full-width in forms. Padding: 0.7rem 0.9rem. Font weight 700.
- **Hover/Focus:** Opacity shift, never a background color change. The button is confident enough not to transform.
- **Disabled:** Opacity 0.7, cursor wait. No color change — the dimmed state is the signal.
- **Secondary (nav):** Dark Slate (#313244) background, White text. Slightly lifted from nav background for affordance without breaking the dark surface.

### Stat Cards
- **Shape:** 8px radius, White (#ffffff) background.
- **Shadow:** Card Rest (0 1px 3px rgba(0,0,0,0.1)) — the only shadow on the page at rest.
- **Internal padding:** 1.5rem. Tight enough for grid density, loose enough to breathe.
- **Content:** Uppercase label (0.75rem, Medium Gray #6b7280) above large stat value (2rem, 700 weight). Optional color on value for semantic emphasis.

### Status Badges
- **Shape:** 4px radius, 2px 8px internal padding. Compact inline element.
- **Color:** White text on semantic background. Background is one of the six semantic colors, mapped by job status.
- **Font:** 0.75rem, system sans-serif. Small enough to sit inline in table cells.

### Tables
- **Header:** Warm Gray (#f0f0f0) background, Dark Gray (#374151) text. 0.75rem padding, 0.8rem font.
- **Rows:** White (#ffffff) background, 1px solid #eee border between rows. No zebra striping — the header provides enough structure.
- **Cell:** 0.75rem padding, 0.8rem Body font. Monospace for IDs and URIs.
- **Empty state:** Centered text in Medium Gray (#6b7280), contextual message.

### Inputs
- **Style:** 1px solid Soft Gray (#d1d5db) border, White background, 6px radius. Width 100% in forms.
- **Padding:** 0.65rem 0.75rem.
- **Focus:** Border shifts to Action Blue (#1e66f5). No glow, no ring — a single clean line.
- **Font:** Inherits body font. No custom input styling.

### Cards / Panels
- **Style:** White (#ffffff) background, 8px radius, 1px Muted Gray (#e5e7eb) border.
- **Login panel:** Card Rest shadow (0 8px 24px rgba(0,0,0,0.08)), max-width 380px, centered on page.
- **Session card:** Inline in nav, top border 1px rgba(255,255,255,0.12).

### Navigation
- **Container:** Deep Navy (#1e1e2e) background, 200px fixed width, full height. Scrollable overflow.
- **Brand:** Powder Blue (#89b4fa), 1rem font, bottom margin 1.5rem.
- **Links:** Lavender Tint (#cdd6f4) default, Powder Blue (#89b4fa) active. 0.875rem font, no underline.
- **Session area:** Pinned to bottom via `margin-top: auto`. Role label in Powder Blue, 0.75rem.
- **Mobile (<760px):** Nav collapses to top bar, max-height 35vh, links laid out in a 2-column grid.

### Login Screen
- **Background:** Page Gray (#f5f5f5), full viewport height, centered grid.
- **Panel:** White (#ffffff), 8px radius, Panel Float shadow, max-width 380px, 1.25rem padding.
- **Heading:** 1.5rem, Deep Navy (#1e1e2e), no margin-top.
- **Subtitle:** 0.9rem, Medium Gray (#6b7280), 0.35rem top margin.
- **Inputs:** Standard input style (see Inputs).
- **Error:** Muted Rose (#f38ba8) text on light rose (#fee2e2) background, 6px radius, 0.65rem 0.75rem padding.
- **Hint text:** 0.75rem, Medium Gray (#6b7280), below button.

### Error Boundary (Standalone Fallback)
- **Container:** Centered grid on Page Gray (#f5f5f5) background, 100% viewport height.
- **Card Panel:** White (#ffffff) background, 8px radius, Panel Float shadow (`0 8px 24px rgba(0,0,0,0.08)`), max-width 560px.
- **Error Text Box:** Light rose (#fee2e2) background, dark rose (#991b1b) monospace text (`0.8rem`), `white-space: pre-wrap`, `word-break: break-word`.
- **Stack Trace:** Expandable dark block (`#111827` background, `#cdd6f4` text, max-height 200px scrollable).
- **Actions:** 6px radius buttons — `Try Recovering` / `Copy Error Details` (secondary white) and `Restart App` (primary navy `#1e1e2e`).

### Status Dots (Device Reachability)
- **Shape:** 8px circle (`border-radius: 50%`), `vertical-align: middle`.
- **Colors:** Idle/Online (#a6e3a1), Busy (#fab387), Offline/Error (#f38ba8), Unknown (#9399b2).
- **Text:** Paired with explicit text label (`.text-active` / `.text-inactive`) for accessible screen reader and colorblind reachability.

## 6. Do's and Don'ts

### Do:
- **Do** use White (#ffffff) for all content surfaces (cards, tables, panels) on Page Gray (#f5f5f5) background
- **Do** use exactly six semantic colors for job status — never revert to the ten-color system
- **Do** use Action Blue (#1e66f5) as the sole accent color; ≤5% of any screen
- **Do** keep surfaces flat at rest; only stat cards, panels, and popovers get shadows
- **Do** use system fonts only — no web font imports, no display/body pairing
- **Do** respect `prefers-reduced-motion` — all transitions must have an instant fallback
- **Do** pair color with shape/text for every status indicator (badge text, not just colored dot)
- **Do** use the 4–8px rounded corner range; never exceed 8px

### Don't:
- **Don't** use flashy SaaS gradients — no purple-to-blue hero sections, no over-animated landing-page patterns, no consumer-app "delight" at the expense of clarity
- **Don't** create terminal-dense data walls — no Datadog-style dashboards, no Grafana sprawl. Hospital operators are not SREs
- **Don't** use generic Material Design defaults — no MUI/Blueprint component library look. PrintOps should feel purpose-built
- **Don't** default to dark mode — the hospital environment is lit; dark interfaces increase eye strain under fluorescent light. Light mode primary, dark mode as an option
- **Don't** add shadows to elements that don't float above the page — no shadow on table rows, inline elements, or section headers
- **Don't** introduce new accent colors beyond Action Blue — no secondary accent, no tertiary accent
- **Don't** use rounded corners above 8px — larger radii read as playful or consumer-facing, not clinical
- **Don't** animate entrance or scroll-driven sequences — motion is limited to state-change fades (opacity transitions under 200ms)
- **Don't** use display fonts, serif fonts, or web fonts — system-ui only. No FOUT, no layout shift
