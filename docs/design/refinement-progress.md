# Refinement progress

## 2026-11-12 — cross-page audit and token pass

**Done** (details and evidence in `ux-audit.md`):

- Muted text token `#6b7280` → `#5f6673`; pastel error text → `--state-danger-text`. axe contrast violations: 20/20 routes → 0.
- 134 literal font sizes mapped onto the seven-rung scale; added `--font-action-size`. Rendered sizes outside the scale: 4 → 0 (apart from the sanctioned verdict headline).
- `StatusBadge.css` made the sole owner of `.status-badge` (two competing blocks deleted from `styles.css`).
- Job Detail: missing `page.jobDetail.printer` label (EN/TH); Copy Debug JSON moved out of `<summary>`.
- Webhooks: labelled the hidden import file input.
- Route error screen rebuilt from the shared `Button`; gradient/glow button CSS removed.
- 390px gutter 8px → 12px; selection, accent and scrollbar colours themed.
- Guards: `apps/web/src/__tests__/designTokens.test.ts` (contrast, type scale, ownership ratchet, no new hotfix sheets).
- Docs: this folder, DESIGN.md token/rule updates, `.impeccable/design.json` sidecar, AGENTS.md frontend rules.

**Verification:**

- `npm run typecheck -w apps/web`: clean. `vitest`: 674/674. Production build: OK.
- Rendered sweep, 20 routes × 1440/1024/390: 0 axe violations, 0 horizontal overflow.
- Playwright e2e: 55 pass / 25 fail, identical failing set on unmodified `main` (stash, rebuild, rerun, diff).
- Not verified: Tauri native window, physical screen reader, Thai copy review by a native speaker.

## Next, in order

1. **Fold the paper-profile hotfix layers** (`paperProfilesLayoutHotfix`, `Closure`, `Completion`, `LibraryGeometryHotfix`) into `paperProfilesLibrary.css` / `paperProfilesEditor.css`, deleting `!important` as you go. Gate: `paper-profile-ux` and `paper-profile-layout-regression` e2e, which first need their pre-existing failures fixed so they can detect a regression. Then delete the entries from the hotfix list in `designTokens.test.ts`.
2. **Retire `experienceSystem.css` as an override layer**: move each rule into the component stylesheet that owns the class (see `component-inventory.md`), one family per change, lowering the ratchet ceiling each time.
3. Fix the 25 pre-existing e2e failures (mostly paper-profile editor selectors and 30s timeouts).
4. Guard `Settings.tsx` against a missing `executor` in the runtime-architecture response.
5. Consider placing `RouteErrorBoundary` inside the shell so navigation survives a route crash.
