# Page Override: login

> **LOGIC:** This file overrides `MASTER.md` for the login page only.
> Source: ui-ux-pro-max skill — `--design-system --persist --page login`
> Generated: 2026-08-04 · Project: PrintOps

## Deviations from MASTER.md (deliberate)

| Master recommendation | Decision | Why |
|---|---|---|
| Palette `#0369A1` blue family | **Keep PrintOps tokens** (`--primary: #1e66f5`, neutral system) | Existing tokens are already audited for contrast (statusColors.ts, uiVocabulary tests). Re-skinning a working system for one page would break consistency across the app. |
| Fira Code / Fira Sans | **Keep `system-ui, sans-serif`** | Fira Sans has **no Thai glyphs**. PrintOps is Thai-first; the system stack resolves Thai via OS fallback. Mono stays `ui-monospace`. |
| Enterprise Gateway landing pattern | **Auth card pattern** | This is a login screen, not a marketing page. Single centered card, one primary action. |

## Applied rules (from ui-ux-pro-max search)

| Guideline | Severity | Applied |
|---|---|---|
| Inputs must have associated labels (`htmlFor`/`aria-describedby`) | High | `FormField` (FE-01.1) generates ids and wires `htmlFor`, `aria-describedby`, `aria-invalid` |
| Show/hide password toggle | Medium | Eye toggle inside the frame (44×44px target, divider, hover/active states) |
| Submit feedback: loading → success/error | High | `Button busy` → `disabled` + `aria-busy`; error via `role="alert"` |
| Touch targets ≥ 44×44px | High | `.login-panel input { min-height: 44px }`; sign-in button 44px; toggle stretches with the field |
| Active/pressed state feedback | Medium | `:active` on sign-in (scale 0.99) and eye toggle (darker bg) |
| Hover/feedback transitions 150–300ms | Medium | 0.16s button, 0.15s toggle bg |
| Visible focus states for keyboard nav | High | Solid 2px ring: inputs via `:focus-visible` (standalone) / `:focus-within` (group) |
| `prefers-reduced-motion` respected | Checklist | Media query disables transitions/transforms on login controls |
| SVG icons only (no emoji) | Checklist | `ActionIcon` (lucide-style paths) |
| `cursor-pointer` on clickable | Checklist | Button + toggle |
| Text contrast ≥ 4.5:1 (light) | Checklist | `--neutral-text #374151` on white ≈ 7.6:1; muted ≈ 4.8:1 |
| Responsive 375/768/1024/1440 | Checklist | `width: min(100%, 380px)`, `max-height: calc(100vh - 2rem)` + scroll |

## Field interaction contract

- Clicking **anywhere** in the password field (including the affix zone next to the eye) focuses the input — the framed group behaves as one control, like the plain email field.
- The eye button toggles visibility only; it must never move out of the frame or overflow its height.
- Focus shows exactly one ring around the whole field (no inner input outline floating inside the frame).

## Anti-patterns to avoid

- Removing focus rings or relying on color alone for state.
- Icon-only button without `aria-label` (toggle keeps `aria-label` + `aria-pressed`).
- Placeholder-only labels (labels are visible, above the field).
- Text running under the trailing button; fields appearing as "a small box inside a big box".
