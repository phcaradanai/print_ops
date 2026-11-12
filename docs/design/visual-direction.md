# Visual direction — PrintOps

**Status: in force since 2026-11-12.** The owner supplied a concept board (light sidebar, indigo primary, soft cards, underline tabs, soft status pills) during the 2026-11-12 review. It replaced the earlier dark-rail "Lab Notebook" look; product truth, bilingual rules, status semantics and accessibility rules carried over unchanged. The board image lives in that session's conversation, not in the repo: if you have it, save it here as `printops-concept-v2.png`.

## Authority, in order

1. Explicit user requirements.
2. `DESIGN.md` (the visual world of record; its "2026-11-12 retheme" section overrides older prose in it) and `PRODUCT.md`.
3. The owner's 2026-11-12 concept board (see the "2026-11-12 retheme" section in `DESIGN.md`), then the older boards in this folder — `printops-web-concept-v1.png`, `printops-desktop-concept-v1.png`, described in `printops-unified-uxui-concept.md`. They are *illustrative*: synthetic data, imagegen typography (Thai especially). Exact copy comes from the i18n dictionaries.
4. Usability, accessibility (WCAG 2.1 AA) and maintainability.
5. Generic skill suggestions (UI UX Pro Max styles/palettes, Impeccable defaults) — lowest.

No Figma file exists for this product. Do not claim Figma validation.

## The direction in one paragraph

Light, calm, clinical. White reading surfaces on a cool gray canvas, a white navigation rail, and top-level cards with a hairline lift (nested surfaces stay flat). One action indigo (`#4f46e5`) for interaction; rose only for consequence; job status and device condition on separate colour axes, each paired with text and shape. System sans for everything, monospace only where the exact string matters. Compact on desktop, 44px targets on touch. A single dark surface — the Evidence Canvas — for literal code and payloads. English and Thai are equal: no uppercase, no letter-spacing on localisable text, everything wraps.

## Concept vs. implementation (checked 2026-11-12 against the 1440px web board)

| Concept says | Implementation | Verdict |
|---|---|---|
| Light work surface, light sidebar, indigo primary (2026-11-12 board) | Canvas `#f6f7fb`, white rail, primary `#4f46e5` (board `#6366f1` fails AA with white text) | Match |
| ~14px body, 24px page headings | 14px body, 24px `h1` on all 20 routes (21.6px at 390px) | Match |
| 8px rhythm, 6–8px radii | Spacing tokens on a 0.25rem grid; 6px controls, 8px panels, 12px dialogs only | Match |
| One page frame: breadcrumb, title+description, primary action, attention, toolbar, content, pagination | `PageScaffold` + `PageHeader` + `ResourceToolbar` on every route | Match |
| Status colour always with icon + label | `StatusBadge` SVG verdict icon + literal status; gap fixed this pass | Match (was visually broken) |
| Readable contrast | Muted text failed AA until this pass | Fixed |

## Rejected this pass, with reasons

- **Dark theme / Fira fonts / scroll-reveal** (UI UX Pro Max design-system output): contradicts the use scene (bright wards), Thai rendering, offline installs and the restrained-motion rule.
- **Eyebrow labels above page titles**: Impeccable bans them; `PageHeader` still accepts an `eyebrow` prop but no route passes one. Keep it that way.
