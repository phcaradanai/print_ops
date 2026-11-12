# Design system — working reference

`DESIGN.md` at the repo root is the specification (tokens in its front matter, rules in its body). This page is the short operational version for someone about to edit `apps/web`. If the two disagree, fix whichever is wrong in the same change; the code's `:root` in `apps/web/src/styles.css` is what ships.

## Foundations (all defined in `apps/web/src/styles.css` `:root`)

| Family | Tokens | Rule |
|---|---|---|
| Colour | `--primary*`, `--neutral-*`, `--state-*-surface/text`, `--status-*`, `--device-*`, `--canvas-*` | No literal hex in a stylesheet. New shades: `color-mix()` against a token. Text on a light surface uses `--neutral-text`, `--neutral-text-muted` or a `--state-*-text` — never a `--semantic-*` pastel. |
| Type | `--font-label-size` .75rem · `--font-mono-size` .8rem · `--font-action-size` .825rem · `--font-body-size` .875rem · `--font-subheading-size` 1rem · `--font-heading-size` 1.5rem · `--font-stat-size` 2rem | Seven rungs, nothing between. One exception: the Job Detail verdict headline clamp. |
| Spacing | `--spacing-xs` .35 · `sm` .5 · `md` .75 · `lg` 1 · `xl` 1.25 · `2xl` 1.5 · `3xl` 2 (rem) | Gaps via `Stack`/`Inline`/`Grid`, not margin chains. |
| Control size | `--control-height-compact` 34px · `--control-height-standard` 38px · 44px large/touch | Buttons render 32/38/44 only. 44px floor ≤1024px and on coarse pointers. |
| Radius | `--rounded-sm` 4 · `md` 6 · `lg` 8 · pill · 12px dialogs only | Pills for status and filter chips only. |
| Depth | `--shadow-subtle`, `--shadow-floating`, popover, drawer | Flat at rest. Shadows only for things that leave the page. |
| Layout | `--page-content-standard` 72rem · `--page-content-wide` 96rem · `--page-region-gap` · `--page-section-gap` | One `PageScaffold` skeleton per route. |
| Breakpoints | 1024 (primary) · 760 · 520 (+1100/860 for editors) | Don't add a fifth for one surface. |
| Motion | short state feedback only; global reduced-motion fallback | No entrance animations. |

## Component contracts

Every shared component is exported from `apps/web/src/components/ui/index.ts`; the inventory is `component-inventory.md`. Contracts that apply to all of them:

- **States:** default, hover, focus-visible, disabled (readable, never translucent), busy (`aria-busy`, no repeat activation), error (`aria-invalid` + `aria-describedby`).
- **Focus:** 2px `--primary` outline at 2px offset on light surfaces; fields shift border + halo; `#89b4fa` on the nav rail.
- **Overflow:** `min-width: 0` on flex/grid children, `overflow-wrap: anywhere` for operational strings, no ellipsis on identifiers.
- **Bilingual:** test the Thai string; it is usually longer and must wrap, not clip.
- **Ownership:** one stylesheet owns a component's base rule. Adding `.ui-x { … }` to a second file fails the ratchet in `designTokens.test.ts`.

## Automated enforcement

| Check | File | Catches |
|---|---|---|
| Muted text ≥4.5:1 on five light surfaces | `apps/web/src/__tests__/designTokens.test.ts` | A token edit that breaks AA |
| No literal sub-1rem `font-size` outside the scale | same | Typographic drift |
| ≤42 classes with base rules in >1 stylesheet | same | New override layering (ratchet — lower it as debt is paid) |
| No new `*Hotfix*/*Closure*/*Completion*` sheets | same | Patch-on-patch CSS |
| Route landmarks go through `PageLayout` | `__tests__/layoutContract.test.ts` | Competing page frames |
| Every route: no horizontal overflow, labelled controls | `apps/web/e2e/all-pages-state.spec.ts` | Layout and form a11y regressions |
| Impeccable detector on edit | Impeccable hook | Generic-AI patterns, banned effects |
