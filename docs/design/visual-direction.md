# Visual direction — PrintOps

**Status: established and in force.** This is a refinement record, not a new direction. Nothing here was redesigned; the 2026-11-12 pass tightened the existing system.

## Authority, in order

1. Explicit user requirements.
2. `DESIGN.md` (the visual world of record, "The Lab Notebook") and `PRODUCT.md`.
3. The concept boards in this folder — `printops-web-concept-v1.png`, `printops-desktop-concept-v1.png`, described in `printops-unified-uxui-concept.md`. They are *illustrative*: synthetic data, imagegen typography (Thai especially). Exact copy comes from the i18n dictionaries.
4. Usability, accessibility (WCAG 2.1 AA) and maintainability.
5. Generic skill suggestions (UI UX Pro Max styles/palettes, Impeccable defaults) — lowest.

No Figma file exists for this product. Do not claim Figma validation.

## The direction in one paragraph

Light, flat, clinical. White reading surfaces on page gray, separated by 1px rules rather than shadows. One action blue (`#1e66f5`) for interaction; rose only for consequence; job status and device condition on separate colour axes, each paired with text and shape. System sans for everything, monospace only where the exact string matters. Compact on desktop, 44px targets on touch. A single dark surface — the Evidence Canvas — for literal code and payloads. English and Thai are equal: no uppercase, no letter-spacing on localisable text, everything wraps.

## Concept vs. implementation (checked 2026-11-12 against the 1440px web board)

| Concept says | Implementation | Verdict |
|---|---|---|
| Light work surface, deep ink nav, blue primary | Page gray `#f5f5f5`, nav `#1e1e2e`, primary `#1e66f5` | Match |
| ~14px body, 24px page headings | 14px body, 24px `h1` on all 20 routes (21.6px at 390px) | Match |
| 8px rhythm, 6–8px radii | Spacing tokens on a 0.25rem grid; 6px controls, 8px panels, 12px dialogs only | Match |
| One page frame: breadcrumb, title+description, primary action, attention, toolbar, content, pagination | `PageScaffold` + `PageHeader` + `ResourceToolbar` on every route | Match |
| Status colour always with icon + label | `StatusBadge` SVG verdict icon + literal status; gap fixed this pass | Match (was visually broken) |
| Readable contrast | Muted text failed AA until this pass | Fixed |

## Rejected this pass, with reasons

- **Dark theme / Fira fonts / scroll-reveal** (UI UX Pro Max design-system output): contradicts the use scene (bright wards), Thai rendering, offline installs and the restrained-motion rule.
- **Eyebrow labels above page titles**: Impeccable bans them; `PageHeader` still accepts an `eyebrow` prop but no route passes one. Keep it that way.
