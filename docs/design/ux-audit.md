# UX/UI cross-page audit — 2026-11-12

Scope: all 20 operator routes of `apps/web` (the shell shared by browser and Tauri), rendered with the Playwright harness in `apps/web/e2e/support.ts` (synthetic OWNER session, mocked API, English unless noted) at 1440px, 1024px and 390px. Every metric below was read from the rendered DOM, not inferred from source.

Tools actually used: Impeccable (`context`, audit playbook, craft floor, design hook on edit), UI UX Pro Max (`search.py` design-system and UX-guideline queries), Playwright, axe-core 4.14 (WCAG 2.0/2.1 A+AA rule sets). **Not used:** Figma (no Figma integration is connected to this environment), visual-regression goldens (none committed for these routes), physical screen readers.

## Health score (Impeccable audit rubric, 0–4 per dimension)

| Dimension | Before | After | Key evidence |
|---|---|---|---|
| Accessibility | 2 | 3 | Before: axe `color-contrast` (serious) on 20/20 routes, `label` (critical) on Webhooks, `nested-interactive` on Job Detail. After: 0 axe violations on 60 route×width renders. Screen-reader and full keyboard walkthroughs not re-run. |
| Performance | 3 | 3 | Not re-audited. Vite warns the main chunk is >500 kB. |
| Theming | 2 | 3 | Before: ~30 literal font sizes, gray fallbacks on tokens, one gradient button. After: sub-1rem sizes only via tokens (enforced). |
| Responsive | 3 | 3 | No document-level horizontal overflow at any width before or after; 390px gutter was 8px, now 12px. |
| Implementation integrity | 2 | 2 | 42 component classes have base rules in >1 stylesheet; 4 hotfix-layer sheets; ~135 `!important`. Ratcheted, not yet paid down. |
| **Total** | **12/20** | **14/20** | Acceptable → Good |

## What is already consistent (keep it)

Measured on every route: one `ops-page` frame (232px left edge on full-width pages, centred 72rem on record pages), one `h1` at 24px/600 (21.6px at 390px), buttons at 32/38/44px only, inputs at 38px desktop and 44px touch, 6px control radius, 8px panel radius, and zero horizontal overflow. The skeleton is unified; the drift is underneath it.

## Findings, ranked by user impact × frequency

| # | Sev | Finding | Where | Status |
|---|---|---|---|---|
| 1 | P1 | Muted text `#6b7280` measured 4.43:1 on Page Gray and 4.24:1 on Warm Subtle Gray — below WCAG AA. Affected page descriptions, freshness stamps, ghost buttons, Back links and every empty-state title. | `--neutral-text-muted`, all routes | Fixed: token → `#5f6673` (≥5.07:1 on every light surface) |
| 2 | P1 | Error text in pastel `--semantic-error` (#f38ba8, ~2.4:1 on white) — a surface colour used as text. Route error heading and Settings field errors. | `styles.css` `.error-fallback h2`, `.settings-field .field-error` | Fixed: `--state-danger-text` |
| 3 | P1 | Webhooks import `<input type=file>` had no accessible name (axe critical). | `features/webhooks/WebhookWorkspace.tsx` | Fixed: `aria-label`, removed from tab order (the visible Import button is the control) |
| 4 | P2 | Typographic drift: rendered sizes included 10.88, 11.76, 13 and 13.6px besides the documented scale; source carried ~30 distinct literal sizes. | 134 declarations across 10 stylesheets | Fixed: mapped onto the seven-rung scale; guard added |
| 5 | P2 | Job status badge defined in four places; an `inline-block` rule in `styles.css` beat the component's flex row, gluing the verdict icon to the label. | `StatusBadge.css`, `styles.css` ×2, `experienceSystem.css` | Fixed: `StatusBadge.css` is sole owner |
| 6 | P2 | A raw i18n key (`page.jobDetail.printer`) rendered as a field label in both locales. | Job Detail, Print configuration | Fixed: EN/TH strings added |
| 7 | P2 | Copy Debug JSON button nested inside `<summary>` (control inside a control). | Job Detail technical section | Fixed: button moved beside the disclosure; visual position kept |
| 8 | P2 | Route error screen was off-system: gradient + glow button, centred text over left-aligned actions. | `RouteErrorBoundary.tsx` | Fixed: shared `Button`, centred actions, flat |
| 9 | P3 | 390px main gutter was 8px; text sat against the screen edge. | `experienceSystem.css` ≤520px | Fixed: 12px (matches the top gutter) |
| 10 | P3 | Browser surfaces (text selection, native checkbox/radio accent, scrollbars) used browser defaults. | global | Fixed: themed from palette |
| 11 | P2 | **Override layering.** 42 component classes have base rules in more than one stylesheet (`.ops-page` in 3, `.app-main` in 2, `.ui-data-table` in 2, …); `paperProfiles{LayoutHotfix,Closure,Completion,LibraryGeometryHotfix}.css` exist only to override earlier sheets with ~100 `!important`. This is why fixes regress: the winning rule depends on chunk load order. | `styles.css` (5.3k lines), `experienceSystem.css`, paper-profile sheets | **Open** — ratcheted by `designTokens.test.ts`; plan in `refinement-progress.md` |
| 12 | P2 | Settings crashes the whole route if `/v1/print-flow/runtime-architecture` returns without `executor` (`runtimeResource.data.executor.owner`). The real API always sends it, so this only bites on version skew. | `pages/Settings.tsx:444` | Open |
| 13 | P3 | The route error boundary replaces the shell (no navigation visible), so recovery is only Retry/Reload. | `App.tsx` boundary placement | Open |
| 14 | P3 | 25 Playwright e2e tests fail identically on unmodified `main` (paper-profile-ux, reprint-safety, delete-flows, mobile-interactions, paper-profile-layout-regression). Verified by stash/rebuild/rerun diff. | `apps/web/e2e` | Open, pre-existing |

## UI UX Pro Max cross-check

Its generic recommendation for "hospital operations dashboard" was a dark slate theme, Fira Sans/Code from Google Fonts, green CTA and scroll-reveal motion. All four are **rejected** under the precedence rules (approved identity > generic suggestion): PrintOps is light-first for fluorescent wards, system-font for Thai integrity and offline installs, blue-accented, and motion-restrained. Its UX guidelines that *agree* with the identity were applied: 4.5:1 text contrast, never colour alone, card layout for tables on mobile, live data labelled with update time and stale state (already present as `Freshness`).
