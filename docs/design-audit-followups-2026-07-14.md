# PrintOps Web — Design Audit Follow-ups (2026-07-14)

Tracked after the impeccable audit + /team fix pass on `apps/web`. Full audit report: `worker-reports/impeccable-audit-printops-web-2026-07-14.md`. These three were found during the fix pass but were out of scope for the workers that found them — not blocking, not yet actioned.

## 1. Dev-account credentials leak via translations hint text

- **Location:** `apps/web/src/i18n/translations.ts:90,491`
- **Found by:** worker-harden-login, during production bundle verification for the login-defaults fix
- **Issue:** The `login.hint` translation string ("Dev accounts: sysadmin@printerops.local, ...") ships into the production bundle. Confirmed via `grep dist/assets/*.js` — 2 occurrences survive in the built output. Unlike the `useState` pre-fill (which is now gated behind `import.meta.env.DEV` and dead-code-eliminated), this is plain translated text with no dev-only gate.
- **Fix direction:** Either gate the hint string itself behind a dev-only conditional in `App.tsx`'s `LoginView`, or remove the literal dev credentials from the translation string and replace with generic guidance ("Contact your administrator for login credentials").

## 2. DESIGN.md §5 contradicts the corrected badge implementation

- **Location:** `DESIGN.md` §5 "Status Badges" (repo root), prose says "White text on semantic background"
- **Found by:** worker-tokens-badges, while computing WCAG contrast for all 10 status colors
- **Issue:** All 10 status badge background colors fail WCAG AA (4.5:1) with white text (ratios 1.27–2.82:1, verified by hand and independently re-checked). The actual fix (`apps/web/src/statusColors.ts`) now uses Deep Navy (`#1e1e2e`) text uniformly. DESIGN.md's own documented rule is now stale/wrong.
- **Fix direction:** Update DESIGN.md §5 to say navy text on semantic backgrounds, and reference `statusColors.ts` as the canonical source instead of restating hex values in prose (avoids future drift).

## 3. Status color palette has 10 colors in use vs. DESIGN.md's documented 6-color rule

- **Location:** `apps/web/src/statusColors.ts` vs. `DESIGN.md` §2 "Named Rules" → "The Five-Color Status Rule" (actually enumerates six: green/amber/rose/blue/peach/slate)
- **Found by:** worker-tokens-badges
- **Issue:** The code uses 10 distinct background colors (`ACCEPTED #74c7ec`, `VALIDATED #89dceb`, `DISPATCHED #cba6f7`, `DUPLICATE_RETURNED #bac2de` are not part of DESIGN.md's official 6-color semantic palette). DESIGN.md's rule explicitly says to group related states under the same color (e.g. ACCEPTED/VALIDATED → Info, QUEUED/DISPATCHED → Info). The current code never collapsed these.
- **Fix direction:** Either (a) update `statusColors.ts` to map all 10 statuses onto the documented 6 colors per DESIGN.md's grouping rule, or (b) if the 10-color granularity is now considered intentional/useful, update DESIGN.md to document the expanded palette. Needs a product/design decision, not just a code change — pick the direction before implementing.

## Priority

None of these are blocking. Suggested order: #1 (credential leak, security-adjacent) first, then #2 (doc accuracy, cheap), then #3 (needs a decision, do last).
